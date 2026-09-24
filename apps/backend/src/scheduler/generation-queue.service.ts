import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { GenerationJobStatus } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import { loadConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { GenerationRunnerService } from './generation-runner.service';

export const GENERATION_QUEUE = 'schedule-generation';

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

/**
 * Очередь фоновой генерации (Redis + BullMQ). Если Redis не настроен или недоступен,
 * задания выполняются в процессе API (режим разработки / тестов).
 */
@Injectable()
export class GenerationQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GenerationQueueService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private inlineRunning: Promise<void> = Promise.resolve();

  constructor(
    private readonly runner: GenerationRunnerService,
    private readonly prisma: PrismaService,
  ) {}

  get mode(): 'bullmq' | 'inline' {
    return this.queue ? 'bullmq' : 'inline';
  }

  async onModuleInit() {
    // Задания, прерванные перезапуском сервера
    await this.prisma.scheduleGenerationJob
      .updateMany({
        where: { status: { in: [GenerationJobStatus.GENERATING, GenerationJobStatus.VALIDATING] } },
        data: { status: GenerationJobStatus.FAILED, error: 'Генерация прервана перезапуском сервера', finishedAt: new Date() },
      })
      .catch(() => undefined);

    const url = loadConfig().redisUrl;
    if (!url || process.env.QUEUE_MODE === 'inline') {
      this.logger.log('Очередь генерации: выполнение в процессе API (Redis не используется)');
      return;
    }
    try {
      const connection = redisConnectionOptions(url);
      const queue = new Queue(GENERATION_QUEUE, { connection });
      await Promise.race([
        queue.waitUntilReady(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('таймаут подключения')), 3000)),
      ]);
      this.queue = queue;
      this.worker = new Worker(
        GENERATION_QUEUE,
        async (job) => {
          await this.runner.run(job.data.jobId as string);
        },
        { connection, concurrency: Number(process.env.GENERATION_CONCURRENCY ?? 1) },
      );
      this.worker.on('failed', (job, err) => this.logger.error(`Задание ${job?.id} завершилось ошибкой: ${err.message}`));
      this.logger.log(`Очередь генерации BullMQ подключена к ${connection.host}:${connection.port}`);
      // Задания, оставшиеся в статусе «ожидание», повторно ставятся в очередь
      const pending = await this.prisma.scheduleGenerationJob.findMany({ where: { status: GenerationJobStatus.QUEUED } });
      for (const p of pending) await this.enqueue(p.id);
    } catch (e) {
      this.logger.warn(`Redis недоступен (${(e as Error).message}) — генерация выполняется в процессе API`);
      this.queue = null;
    }
  }

  async onModuleDestroy() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }

  async enqueue(jobId: string): Promise<void> {
    if (this.queue) {
      await this.queue.add('generate', { jobId }, { jobId, removeOnComplete: 200, removeOnFail: 200, attempts: 1 });
      return;
    }
    // Последовательное выполнение в процессе
    this.inlineRunning = this.inlineRunning.then(() => this.runner.run(jobId)).catch(() => undefined);
  }

  /** Ожидание завершения внутренних заданий (для тестов) */
  async drain(): Promise<void> {
    await this.inlineRunning;
  }
}
