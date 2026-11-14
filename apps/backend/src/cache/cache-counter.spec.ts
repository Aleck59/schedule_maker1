import { CacheService } from './cache.service';

describe('CacheService: счётчик попыток без Redis', () => {
  const realUrl = process.env.REDIS_URL;
  beforeAll(() => delete process.env.REDIS_URL);
  afterAll(() => {
    if (realUrl !== undefined) process.env.REDIS_URL = realUrl;
  });

  it('считает в памяти, сбрасывается и истекает по окну', async () => {
    const cache = new CacheService();
    cache.onModuleInit();
    expect(await cache.peek('k')).toBe(0);
    expect(await cache.hit('k', 60)).toBe(1);
    expect(await cache.hit('k', 60)).toBe(2);
    expect(await cache.peek('k')).toBe(2);
    await cache.del('k');
    expect(await cache.peek('k')).toBe(0);

    jest.useFakeTimers();
    await cache.hit('t', 1);
    jest.advanceTimersByTime(1500);
    expect(await cache.peek('t')).toBe(0);
    jest.useRealTimers();
  });
});
