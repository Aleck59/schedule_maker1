import { Logger } from '@nestjs/common';

/**
 * Сторож основного потока: если сервер был занят синхронной работой и не обрабатывал запросы
 * дольше порога, в лог пишется предупреждение. Без него «зависание» интерфейса не оставляет следов.
 */
export function startEventLoopWatchdog(thresholdMs = Number(process.env.EVENT_LOOP_WARN_MS ?? 1000)) {
  const logger = new Logger('EventLoop');
  const intervalMs = 250;
  let expected = Date.now() + intervalMs;
  const timer = setInterval(() => {
    const now = Date.now();
    const lag = now - expected;
    expected = now + intervalMs;
    if (lag >= thresholdMs) {
      logger.warn(`Сервер не отвечал на запросы ${lag} мс: основной поток был занят`);
    }
  }, intervalMs);
  timer.unref();
  return timer;
}
