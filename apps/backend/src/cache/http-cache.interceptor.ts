import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { from, Observable, of, switchMap, tap, finalize } from 'rxjs';
import { AuthUser } from '../common/types/auth-user';
import { CACHE_RESPONSE_KEY, CacheResponseOptions, NO_CACHE_INVALIDATE_KEY } from './cache.decorators';
import { CacheService } from './cache.service';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function scopeKey(user: AuthUser, scope: CacheResponseOptions['scope']): string {
  if (scope === 'user') return `u:${user.id}`;
  return `v:${user.organizationId}:${user.role}:${user.teacherId ?? ''}:${user.studentGroupId ?? ''}`;
}

/**
 * Глобальный перехватчик:
 *  - GET с @CacheResponse отдаёт ответ из Redis, если данные не менялись;
 *  - любой изменяющий запрос (кроме помеченных @NoCacheInvalidate) после выполнения сбрасывает кэш.
 */
@Injectable()
export class HttpCacheInterceptor implements NestInterceptor {
  constructor(
    private readonly cache: CacheService,
    private readonly reflector: Reflector,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http' || !this.cache.enabled) return next.handle();
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const targets = [ctx.getHandler(), ctx.getClass()];

    if (!READ_METHODS.has(req.method)) {
      if (this.reflector.getAllAndOverride<boolean>(NO_CACHE_INVALIDATE_KEY, targets)) return next.handle();
      // И при ошибке: часть изменений могла успеть записаться
      return next.handle().pipe(finalize(() => void this.cache.invalidate()));
    }

    const opts = this.reflector.getAllAndOverride<CacheResponseOptions | undefined>(
      CACHE_RESPONSE_KEY,
      targets,
    );
    if (!opts || !req.user || req.method !== 'GET') return next.handle();
    const res = ctx.switchToHttp().getResponse<Response>();
    const key = `http:${scopeKey(req.user, opts.scope)}:${req.originalUrl}`;
    return from(this.cache.getVersioned<unknown>(key)).pipe(
      switchMap(({ value, version }) => {
        if (value !== undefined) {
          res.setHeader('X-Cache', 'HIT');
          return of(value);
        }
        res.setHeader('X-Cache', 'MISS');
        return next.handle().pipe(tap((body) => void this.cache.setVersioned(key, version, body, opts.ttl)));
      }),
    );
  }
}
