/**
 * Наблюдение за долгими загрузками страниц.
 *
 * «Ожидание» — время, пока на странице есть данные, которые загружаются впервые (их ещё нечего
 * показать). Через 5 с показывается индикатор «Ожидание 5.3с», а ожидание дольше 15 с
 * записывается в журнал «Настройки → Долгие загрузки».
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Query, QueryClient } from '@tanstack/react-query';
import { api, tokenStore } from './api';

/** Через сколько показывать индикатор ожидания, мс */
export const WAIT_INDICATOR_MS = 5_000;
/** Ожидание дольше этого записывается в журнал, мс */
export const SLOW_LOAD_LOG_MS = 15_000;

/** Секунды ожидания в виде «3.3с» */
export function formatWait(ms: number): string {
  return `${(Math.floor(ms / 100) / 10).toFixed(1)}с`;
}

type Outcome = 'LOADED' | 'ERROR' | 'LEFT';

interface Episode {
  start: number;
  page: string;
  /** Запросы, которых ждала страница, и когда каждый из них начал ждать */
  queries: Map<Query, number>;
}

function currentPage() {
  return `${window.location.pathname}${window.location.search}`;
}

function requestOf(query: Query): string {
  const path = (query.meta as { path?: unknown } | undefined)?.path;
  return typeof path === 'string' ? path : JSON.stringify(query.queryKey).slice(0, 300);
}

/** Запрос ждёт первых данных и кому-то на странице нужен */
function isWaiting(query: Query) {
  return query.state.status === 'pending' && query.state.fetchStatus === 'fetching' && query.getObserversCount() > 0;
}

class WaitWatch {
  private episode: Episode | null = null;
  private listeners = new Set<() => void>();
  private inline = 0;
  private scheduled = false;

  /** Начало текущего ожидания (мс) или null */
  getStart = (): number | null => this.episode?.start ?? null;
  /** Сколько на странице индикаторов ожидания внутри блоков (тогда общий не нужен) */
  getInline = (): number => this.inline;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Блок загрузки на странице сам показывает ожидание */
  registerInline() {
    this.inline++;
    this.emit();
    return () => {
      this.inline--;
      this.emit();
    };
  }

  attach(client: QueryClient) {
    const cache = client.getQueryCache();
    const check = () => {
      // Несколько событий кэша подряд обрабатываем один раз
      if (this.scheduled) return;
      this.scheduled = true;
      queueMicrotask(() => {
        this.scheduled = false;
        this.update(cache.getAll());
      });
    };
    const unsubscribe = cache.subscribe(check);
    const onHide = () => {
      if (this.episode) this.finish('LEFT', true);
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      unsubscribe();
      window.removeEventListener('pagehide', onHide);
    };
  }

  private update(all: Query[]) {
    const waiting = all.filter(isWaiting);
    if (waiting.length > 0) {
      if (!this.episode) {
        this.episode = { start: Date.now(), page: currentPage(), queries: new Map() };
        this.emit();
      }
      for (const q of waiting) if (!this.episode.queries.has(q)) this.episode.queries.set(q, Date.now());
      return;
    }
    if (!this.episode) return;
    const queries = [...this.episode.queries.keys()];
    const outcome: Outcome =
      // Данные ещё грузятся, но страница их уже не ждёт — пользователь ушёл
      queries.some((q) => q.state.status === 'pending')
        ? 'LEFT'
        : queries.some((q) => q.state.status === 'error')
          ? 'ERROR'
          : 'LOADED';
    this.finish(outcome, false);
  }

  private finish(outcome: Outcome, closing: boolean) {
    const ep = this.episode!;
    this.episode = null;
    this.emit();
    const now = Date.now();
    const durationMs = now - ep.start;
    if (durationMs < SLOW_LOAD_LOG_MS || !tokenStore.access) return;
    // В журнал — только запросы, которые сами шли дольше 5 с (быстрые служебные не нужны)
    const took = (q: Query, since: number) => (q.state.dataUpdatedAt || q.state.errorUpdatedAt || now) - since;
    const slow = [...ep.queries].filter(([q, since]) => took(q, since) >= WAIT_INDICATOR_MS);
    const requests = [...new Set((slow.length ? slow : [...ep.queries]).map(([q]) => requestOf(q)))];
    api
      .post(
        '/slow-loads',
        { page: ep.page.slice(0, 500), requests: requests.slice(0, 20), durationMs: Math.round(durationMs), outcome },
        { keepalive: closing },
      )
      .catch(() => {
        /* журнал не должен мешать работе */
      });
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }
}

export const waitWatch = new WaitWatch();

/** Сколько миллисекунд прошло с `start` (обновляется 10 раз в секунду) */
export function useElapsed(start: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (start === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [start]);
  return start === null ? 0 : Math.max(0, now - start);
}

/** Начало текущего ожидания страницы и число встроенных индикаторов */
export function usePageWait() {
  const start = useSyncExternalStore(waitWatch.subscribe, waitWatch.getStart);
  const inline = useSyncExternalStore(waitWatch.subscribe, waitWatch.getInline);
  return { start, inline };
}
