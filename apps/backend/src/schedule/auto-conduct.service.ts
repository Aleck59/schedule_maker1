import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConductedStatus, LessonStatus, MakeupTaskStatus, SchedulePeriodStatus } from '@prisma/client';
import { parseDate, todayInTimezone } from '../common/utils/dates';
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

/**
 * Автозачёт часов: пара опубликованного расписания, которая закончилась и по которой никто ничего
 * не отметил (не отменена, не перенесена, нет отметки), считается проведённой — часы засчитываются.
 * Отметку можно снять или изменить вручную, как обычную.
 */
@Injectable()
export class AutoConductService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutoConductService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit() {
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
      if (total > 0) this.logger.log(`Автозачёт: отмечено проведёнными ${total} пар`);
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
        schedulePeriod: { organizationId, status: SchedulePeriodStatus.PUBLISHED },
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
      take: 2000,
    });
    const due = candidates.filter((l) => l.date.toISOString().slice(0, 10) < today || l.endTime <= time);
    for (const l of due) {
      await this.prisma.$transaction(async (tx) => {
        // Повторная проверка: за это время пару могли отметить вручную
        const fresh = await tx.scheduleLesson.findUnique({
          where: { id: l.id },
          select: { status: true, conducted: true },
        });
        if (
          !fresh ||
          fresh.conducted ||
          (fresh.status !== LessonStatus.PLANNED && fresh.status !== LessonStatus.REPLACED)
        )
          return;
        await tx.conductedLesson.create({
          data: {
            scheduleLessonId: l.id,
            status: ConductedStatus.CONDUCTED,
            actualHours: l.academicHours,
            actualTeacherId: l.substitutions[0]?.substituteTeacherId ?? l.teacherId,
            actualClassroomId: l.classroomId,
            conductedAt: now,
            notes: NOTE,
          },
        });
        await tx.scheduleLesson.update({
          where: { id: l.id },
          data: {
            status: l.status === LessonStatus.REPLACED ? LessonStatus.REPLACED : LessonStatus.CONDUCTED,
          },
        });
        await tx.makeupTask.updateMany({
          where: { resolvedLessonId: l.id },
          data: { status: MakeupTaskStatus.DONE },
        });
      });
    }
    return due.length;
  }
}
