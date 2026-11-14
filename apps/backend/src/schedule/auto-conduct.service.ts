import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConductedStatus, LessonStatus, MakeupTaskStatus, SchedulePeriodStatus } from '@prisma/client';
import { parseDate, todayInTimezone } from '../common/utils/dates';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

/** Текущее время «ЧЧ:ММ» в часовом поясе организации */
export function nowTimeInTimezone(timezone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(now);
  } catch {
    return now.toISOString().slice(11, 16);
  }
}

const NOTE = 'Проведено: отмечено автоматически по окончании пары';

/** Пар за одну транзакцию */
const BATCH = 500;

/**
 * Автозачёт часов: пара расписания (черновик, составленное или опубликованное — кроме архива),
 * которая закончилась и по которой никто ничего не отметил (не отменена, не перенесена, нет
 * отметки), считается проведённой — часы засчитываются. Отметку можно снять или изменить вручную.
 */
@Injectable()
export class AutoConductService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutoConductService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly cache: CacheService,
  ) {}

  onModuleInit() {
    // Настройку только что включили — засчитать уже закончившиеся пары сразу
    this.settings.onAutoConductEnabled(async (organizationId) => {
      const marked = await this.run(organizationId);
      if (marked > 0) await this.cache.invalidate();
    });
    const minutes = Number(
      process.env.AUTO_CONDUCT_INTERVAL_MINUTES ?? (process.env.NODE_ENV === 'test' ? 0 : 10),
    );
    if (!minutes || minutes <= 0) return;
    const tick = () => void this.runAll().catch((e) => this.logger.warn(`Автозачёт пар: ${String(e)}`));
    setTimeout(tick, 15_000).unref();
    this.timer = setInterval(tick, minutes * 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runAll(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const orgs = await this.prisma.organizationSettings.findMany({
        where: { autoMarkConducted: true },
        select: { organizationId: true },
      });
      let total = 0;
      for (const o of orgs) total += await this.run(o.organizationId);
      if (total > 0) {
        this.logger.log(`Автозачёт: отмечено проведёнными ${total} пар`);
        // Фоновое изменение данных без HTTP-запроса — кэш сбрасывается явно
        await this.cache.invalidate();
      }
      return total;
    } finally {
      this.running = false;
    }
  }

  /** Отметить проведёнными закончившиеся пары организации; возвращает число отмеченных */
  async run(organizationId: string, now: Date = new Date()): Promise<number> {
    const settings = await this.settings.getEffective(organizationId);
    const today = todayInTimezone(settings.timezone, now);
    const time = nowTimeInTimezone(settings.timezone, now);
    const candidates = await this.prisma.scheduleLesson.findMany({
      where: {
        schedulePeriod: { organizationId, status: { not: SchedulePeriodStatus.ARCHIVED } },
        status: { in: [LessonStatus.PLANNED, LessonStatus.REPLACED] },
        conducted: null,
        date: { lte: parseDate(today) },
      },
      select: {
        id: true,
        date: true,
        endTime: true,
        status: true,
        teacherId: true,
        classroomId: true,
        academicHours: true,
        substitutions: { select: { substituteTeacherId: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: [{ date: 'asc' }, { lessonNumber: 'asc' }],
    });
    const due = candidates.filter((l) => l.date.toISOString().slice(0, 10) < today || l.endTime <= time);
    let marked = 0;
    for (let i = 0; i < due.length; i += BATCH) {
      const chunk = due.slice(i, i + BATCH);
      marked += await this.prisma.$transaction(async (tx) => {
        // Повторная проверка: за это время пары могли отметить вручную
        const fresh = await tx.scheduleLesson.findMany({
          where: {
            id: { in: chunk.map((l) => l.id) },
            conducted: null,
            status: { in: [LessonStatus.PLANNED, LessonStatus.REPLACED] },
          },
          select: { id: true },
        });
        const ok = new Set(fresh.map((f) => f.id));
        const rows = chunk.filter((l) => ok.has(l.id));
        if (rows.length === 0) return 0;
        await tx.conductedLesson.createMany({
          data: rows.map((l) => ({
            scheduleLessonId: l.id,
            status: ConductedStatus.CONDUCTED,
            actualHours: l.academicHours,
            actualTeacherId: l.substitutions[0]?.substituteTeacherId ?? l.teacherId,
            actualClassroomId: l.classroomId,
            conductedAt: now,
            notes: NOTE,
          })),
          skipDuplicates: true,
        });
        // Замена остаётся заменой (часы засчитаны), обычная пара становится проведённой
        await tx.scheduleLesson.updateMany({
          where: { id: { in: rows.filter((l) => l.status === LessonStatus.PLANNED).map((l) => l.id) } },
          data: { status: LessonStatus.CONDUCTED },
        });
        await tx.makeupTask.updateMany({
          where: { resolvedLessonId: { in: rows.map((l) => l.id) } },
          data: { status: MakeupTaskStatus.DONE },
        });
        return rows.length;
      });
    }
    return marked;
  }
}
