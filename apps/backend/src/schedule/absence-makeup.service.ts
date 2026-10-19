import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CancellationReason, LessonStatus, SchedulePeriodStatus } from '@prisma/client';
import { AuthUser } from '../common/types/auth-user';
import {
  addDaysStr,
  formatDateRu,
  maxDate,
  parseDate,
  toDateStr,
  todayInTimezone,
} from '../common/utils/dates';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ScheduleLessonsService } from './schedule-lessons.service';
import { SlotFinderService } from './slot-finder.service';

export interface AbsenceMakeupResult {
  total: number;
  moved: Array<{ lessonId: string; label: string; to: string }>;
  cancelled: Array<{ lessonId: string; label: string }>;
}

/**
 * Отработка пар, попавших на отсутствие преподавателя (больничный, отпуск, курсы): каждая пара
 * переносится на ближайшее свободное время после выхода — сверх недельного лимита и с одной лишней
 * парой в день. Если места до конца семестра нет — пара отменяется с задачей «требуется отработка».
 */
@Injectable()
export class AbsenceMakeupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lessons: ScheduleLessonsService,
    private readonly slots: SlotFinderService,
    private readonly settings: SettingsService,
  ) {}

  async run(eventId: string, actor: AuthUser): Promise<AbsenceMakeupResult> {
    const event = await this.prisma.calendarEvent.findFirst({
      where: { id: eventId, organizationId: actor.organizationId, teacherId: { not: null } },
    });
    if (!event) throw new NotFoundException('Отсутствие преподавателя не найдено');
    const settings = await this.settings.getEffective(actor.organizationId);
    const today = todayInTimezone(settings.timezone);
    const start = toDateStr(event.startDate);
    const end = toDateStr(event.endDate);
    const affected = await this.prisma.scheduleLesson.findMany({
      where: {
        teacherId: event.teacherId,
        date: { gte: parseDate(maxDate(start, today)), lte: parseDate(end) },
        status: { in: [LessonStatus.PLANNED, LessonStatus.REPLACED] },
        conducted: null,
        isLocked: false,
        schedulePeriod: {
          organizationId: actor.organizationId,
          status: { not: SchedulePeriodStatus.ARCHIVED },
        },
      },
      include: {
        studentGroup: { select: { code: true } },
        semesterItem: { select: { curriculumItem: { select: { name: true } } } },
      },
      orderBy: [{ date: 'asc' }, { lessonNumber: 'asc' }],
    });
    const result: AbsenceMakeupResult = { total: affected.length, moved: [], cancelled: [] };
    const done = new Set<string>();
    const from = maxDate(addDaysStr(end, 1), today);
    for (const l of affected) {
      if (done.has(l.id)) continue;
      const label = `${l.studentGroup.code}: «${l.semesterItem.curriculumItem.name}», ${formatDateRu(l.date)}, ${l.lessonNumber} пара`;
      const free = await this.slots.find({
        organizationId: actor.organizationId,
        studentGroupId: l.studentGroupId,
        subgroupNumber: l.subgroupNumber,
        semesterCurriculumItemId: l.semesterCurriculumItemId,
        lessonType: l.lessonType,
        teacherId: l.teacherId,
        from,
        limit: 40,
        extraDailyLessons: 1,
      });
      // Сначала ближайшие даты после выхода, среди них — лучшие по оценке
      free.sort((a, b) => a.date.localeCompare(b.date) || a.score - b.score);
      let movedTo: string | null = null;
      for (const slot of free) {
        try {
          await this.lessons.move(
            l.id,
            {
              date: slot.date,
              lessonNumber: slot.lessonNumber,
              classroomId: slot.classroomId ?? undefined,
              reason: `${event.title}: отработка после выхода`,
            },
            actor,
          );
          movedTo = `${formatDateRu(slot.date)}, ${slot.lessonNumber} пара`;
          break;
        } catch (e) {
          if (e instanceof ConflictException) continue;
          throw e;
        }
      }
      if (l.streamKey) {
        // Пары потока переносятся вместе — сами они уже обработаны
        for (const s of affected) {
          if (
            s.streamKey === l.streamKey &&
            s.lessonNumber === l.lessonNumber &&
            toDateStr(s.date) === toDateStr(l.date)
          )
            done.add(s.id);
        }
      }
      if (movedTo) {
        result.moved.push({ lessonId: l.id, label, to: movedTo });
        continue;
      }
      await this.lessons.cancel(
        l.id,
        {
          reason: CancellationReason.TEACHER_ABSENT,
          notes: `${event.title}: нет свободного времени до конца семестра`,
          createMakeupTask: true,
        },
        actor,
      );
      result.cancelled.push({ lessonId: l.id, label });
    }
    return result;
  }
}
