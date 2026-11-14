import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { loadConfig } from '../config/configuration';
import { redisConnectionOptions } from './redis-options';

/**
 * Разделы данных со своей версией. «data» — всё, кроме доступности преподавателей: её меняют
 * сами преподаватели (сотни правок в день), и раньше каждая правка сбрасывала кэш расписания всем.
 */
export const CACHE_SECTIONS = ['data', 'availability'] as const;
export type CacheSection = (typeof CACHE_SECTIONS)[number];
const versionKey = (section: CacheSection) => (section === 'data' ? 'data-version' : `${section}-version`);

/**
 * Общий кэш в Redis.
 *
 * Данные, которые зависят от расписания и справочников, хранятся «под версией»: любой изменяющий
 * запрос (POST/PATCH/PUT/DELETE) увеличивает общую версию данных, и все такие записи сразу
 * становятся недействительными — на всех экземплярах API. Это проще и надёжнее, чем точечный сброс,
 * а чтение (просмотр расписания студентами и преподавателями) происходит намного чаще записи.
 *
 * Без Redis (REDIS_URL не задан, HTTP_CACHE=off или сервер недоступен) кэш выключен:
 * все методы безопасно ничего не делают, и запросы идут в базу как раньше.
 */
@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private redis: Redis | null = null;
  private ready = false;
  private warned = false;

  onModuleInit() {
    const url = loadConfig().redisUrl;
    if (!url || process.env.HTTP_CACHE === 'off') return;
    this.redis = new Redis({
      ...redisConnectionOptions(url),
      keyPrefix: 'sm:cache:',
      // Кэш не должен задерживать запросы: если Redis недоступен — сразу промах
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2000,
    });
    this.redis.on('ready', () => {
      this.ready = true;
      this.warned = false;
      this.logger.log('Кэш Redis подключён');
    });
    this.redis.on('close', () => (this.ready = false));
    this.redis.on('error', (e) => {
      if (!this.warned) this.logger.warn(`Кэш Redis недоступен: ${e.message} — запросы идут в базу`);
      this.warned = true;
    });
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }

  get enabled(): boolean {
    return this.ready && this.redis !== null;
  }

  /** Значение, сохранённое для текущей версии данных; undefined — промах */
  async getVersioned<T>(
    key: string,
    sections: readonly CacheSection[] = ['data'],
  ): Promise<{ value: T | undefined; version: string }> {
    if (!this.enabled) return { value: undefined, version: '' };
    try {
      const values = await this.redis!.mget(...sections.map(versionKey), key);
      const raw = values.pop();
      // Версия записи — версии всех разделов, от которых она зависит
      const ver = values.map((v) => v ?? '0').join('.');
      if (raw) {
        const nl = raw.indexOf('\n');
        if (nl > 0 && raw.slice(0, nl) === ver)
          return { value: JSON.parse(raw.slice(nl + 1)) as T, version: ver };
      }
      return { value: undefined, version: ver };
    } catch {
      return { value: undefined, version: '' };
    }
  }

  /** Сохранить значение для версии данных, прочитанной до выполнения запроса */
  async setVersioned(key: string, version: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.enabled || !version || value === undefined) return;
    try {
      await this.redis!.set(key, `${version}\n${JSON.stringify(value)}`, 'EX', ttlSeconds);
    } catch {
      /* кэш необязателен */
    }
  }

  /** Данные изменились: записи, зависящие от этих разделов (по умолчанию — все), становятся недействительными */
  async invalidate(sections: readonly CacheSection[] = CACHE_SECTIONS): Promise<void> {
    if (!this.enabled) return;
    try {
      const tx = this.redis!.multi();
      for (const s of sections) tx.incr(versionKey(s));
      await tx.exec();
    } catch {
      /* кэш необязателен */
    }
  }

  /**
   * Счётчик в окне ttlSeconds (для ограничения попыток входа).
   * Без Redis (или при его сбое) считает в памяти процесса, чтобы ограничение действовало всегда.
   */
  async hit(key: string, ttlSeconds: number): Promise<number> {
    if (this.enabled) {
      try {
        const [[, count]] = (await this.redis!.multi().incr(key).expire(key, ttlSeconds, 'NX').exec()) as [
          [Error | null, number],
        ];
        return count;
      } catch {
        /* ниже — счётчик в памяти */
      }
    }
    return this.memoryHit(key, ttlSeconds);
  }

  async peek(key: string): Promise<number> {
    if (this.enabled) {
      try {
        return Math.max(Number((await this.redis!.get(key)) ?? 0), this.memoryPeek(key));
      } catch {
        /* ниже — счётчик в памяти */
      }
    }
    return this.memoryPeek(key);
  }

  async del(key: string): Promise<void> {
    this.counters.delete(key);
    if (!this.enabled) return;
    await this.redis!.del(key).catch(() => undefined);
  }

  /** Счётчики в памяти: ключ → число и момент истечения окна */
  private readonly counters = new Map<string, { count: number; expiresAt: number }>();

  private memoryHit(key: string, ttlSeconds: number): number {
    const now = Date.now();
    if (this.counters.size > 10_000) {
      for (const [k, v] of this.counters) if (v.expiresAt <= now) this.counters.delete(k);
    }
    const cur = this.counters.get(key);
    if (!cur || cur.expiresAt <= now) {
      this.counters.set(key, { count: 1, expiresAt: now + ttlSeconds * 1000 });
      return 1;
    }
    cur.count += 1;
    return cur.count;
  }

  private memoryPeek(key: string): number {
    const cur = this.counters.get(key);
    if (!cur) return 0;
    if (cur.expiresAt <= Date.now()) {
      this.counters.delete(key);
      return 0;
    }
    return cur.count;
  }
}
