import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CacheService } from './cache.service';
import { HttpCacheInterceptor } from './http-cache.interceptor';

@Global()
@Module({
  providers: [CacheService, { provide: APP_INTERCEPTOR, useClass: HttpCacheInterceptor }],
  exports: [CacheService],
})
export class CacheModule {}
