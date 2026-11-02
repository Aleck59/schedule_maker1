import { SetMetadata } from '@nestjs/common';

export const CACHE_RESPONSE_KEY = 'cacheResponse';
export const NO_CACHE_INVALIDATE_KEY = 'noCacheInvalidate';

/**
 * Чья это выдача:
 *  - viewer — одинакова для всех с той же ролью, организацией, преподавателем и группой
 *    (два студента одной группы получат одну запись кэша);
 *  - user — личная выдача пользователя (уведомления, профиль).
 */
export type CacheScope = 'viewer' | 'user';

export interface CacheResponseOptions {
  ttl: number;
  scope: CacheScope;
}

/**
 * Кэшировать ответ GET-запроса в Redis на ttl секунд (не дольше — до первого изменения данных).
 * Ключ — адрес запроса с параметрами и область видимости пользователя.
 */
export const CacheResponse = (ttl: number, scope: CacheScope = 'viewer') =>
  SetMetadata(CACHE_RESPONSE_KEY, { ttl, scope } satisfies CacheResponseOptions);

/** Изменяющий запрос, после которого кэш сбрасывать не нужно (вход, проверка слота и т. п.) */
export const NoCacheInvalidate = () => SetMetadata(NO_CACHE_INVALIDATE_KEY, true);
