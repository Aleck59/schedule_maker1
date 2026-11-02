/** Параметры подключения ioredis из REDIS_URL (redis://user:pass@host:port/db, rediss:// — TLS) */
export function redisConnectionOptions(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) || 0 : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}
