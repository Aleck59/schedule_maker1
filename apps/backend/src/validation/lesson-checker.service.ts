import { Injectable } from '@nestjs/common';
import { CalendarEventType, ClassroomType, LessonType, Severity } from '@prisma/client';
import { addDaysStr, formatDateRu, isoWeekday, parseDate, toDateStr, weekStart } from '../common/utils/dates';
import { CALENDAR_EVENT_LABELS, CLASSROOM_TYPE_LABELS } from '../common/utils/labels';
import { effectiveRoomTypes } from '../common/utils/rooms';
import { PRACTICE_EVENT_TYPES, practiceEventTypeFor } from '../planning/calendar-context';
import { ACTIVE_STATUSES, computeStreamHours, matchLessonsToStreams } from '../planning/hours-calculator';
import { PlanningService, streamKeyOf } from '../planning/planning.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ValidationIssue } from './validation.types';

export interface LessonCandidate {
  organizationId: string;
  /** Редактируемое занятие — исключается из поиска конфликтов */
  lessonId?: string | null;
  excludeIds?: string[];
  schedulePeriodId: string;
  date: string;
  lessonNumber: number;
  studentGroupId: string;
  subgroupNumber: number | null;
  semesterCurriculumItemId: string;
  lessonType: LessonType;
  teacherId: string | null;
  classroomId: string | null;
  academicHours: number;
  streamKey?: string | null;
  allowHoursExcess?: boolean;
  /** Пропустить проверку превышения часов (например, при переносе) */
  skipHoursCheck?: boolean;
}

function issue(
  severity: Severity,
  validationType: string,
  message: string,
  details?: Record<string, unknown>,
): ValidationIssue {
  return { severity, validationType, entityType: 'ScheduleLesson', entityId: null, message, details };
}

/**
 * Мгновенная проверка одного занятия при ручном изменении расписания:
 * пересечения, доступность, календарный график, аудитория, часы.
 */
@Injectable()
export class LessonCheckerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planning: PlanningService,
    private readonly settings: SettingsService,
  ) {}

  async check(c: LessonCandidate): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    const settings = await this.settings.getEffective(c.organizationId);
    const exclude = new Set([...(c.excludeIds ?? []), ...(c.lessonId ? [c.lessonId] : [])]);
    const date = c.date;
    const weekday = isoWeekday(date);

    const [period, group, item, teacher, room] = await Promise.all([
      this.prisma.schedulePeriod.findFirst({
        where: { id: c.schedulePeriodId, organizationId: c.organizationId },
      }),
      this.prisma.studentGroup.findFirst({ where: { id: c.studentGroupId }, include: { subgroups: true } }),
      this.prisma.semesterCurriculumItem.findFirst({
        where: { id: c.semesterCurriculumItemId },
        include: { semester: true, curriculumItem: true },
      }),
      c.teacherId
        ? this.prisma.teacher.findFirst({ where: { id: c.teacherId }, include: { availability: true } })
        : Promise.resolve(null),
      c.classroomId
        ? this.prisma.classroom.findFirst({ where: { id: c.classroomId }, include: { availability: true } })
        : Promise.resolve(null),
    ]);
    if (!period || !group || !item) {
      issues.push(
        issue(Severity.ERROR, 'INVALID_REFERENCE', 'Не найдены период, группа или дисциплина занятия'),
      );
      return issues;
    }

    // --- Даты периода и семестра
    if (date < toDateStr(period.startDate) || date > toDateStr(period.endDate)) {
      issues.push(
        issue(
          Severity.ERROR,
          'LESSON_OUTSIDE_PERIOD',
          `Дата ${formatDateRu(date)} вне периода расписания (${formatDateRu(period.startDate)} — ${formatDateRu(period.endDate)})`,
        ),
      );
    }
    if (date < toDateStr(item.semester.startDate) || date > toDateStr(item.semester.endDate)) {
      issues.push(
        issue(
          Severity.ERROR,
          'LESSON_OUTSIDE_SEMESTER',
          `Дата ${formatDateRu(date)} вне дат ${item.semester.number}-го семестра`,
        ),
      );
    }
    if (c.lessonNumber > settings.lessonsPerDay) {
      issues.push(
        issue(
          Severity.WARNING,
          'LESSON_NUMBER_EXCEEDS',
          `Пара №${c.lessonNumber} вне основной сетки (${settings.lessonsPerDay} пар в день)`,
        ),
      );
    }
    if (c.lessonNumber >= settings.lateLessonNumber) {
      issues.push(issue(Severity.WARNING, 'LATE_LESSONS', `Поздняя пара (№${c.lessonNumber})`));
    }

    // --- Календарный график
    const ctx = await this.planning.buildCalendarContext(c.organizationId, date, date, [c.studentGroupId]);
    const day = ctx.groupDay(c.studentGroupId, date);
    if (!day.isWorkingDay) {
      issues.push(
        issue(
          Severity.WARNING,
          'LESSON_ON_DAY_OFF',
          `${formatDateRu(date)} — выходной день по настройкам учебной недели`,
        ),
      );
    }
    const practiceType = practiceEventTypeFor(item.curriculumItem.itemType);
    for (const b of day.blocks) {
      const type = b.eventType as CalendarEventType;
      if (c.lessonType === LessonType.PRACTICE && practiceType && type === practiceType) continue;
      const code =
        type === CalendarEventType.VACATION
          ? 'LESSON_IN_VACATION'
          : type === CalendarEventType.HOLIDAY
            ? 'LESSON_ON_HOLIDAY'
            : PRACTICE_EVENT_TYPES.includes(type)
              ? 'LESSON_IN_PRACTICE'
              : 'LESSON_IN_BLOCKED_PERIOD';
      issues.push(
        issue(
          Severity.ERROR,
          code,
          `${formatDateRu(date)}: ${CALENDAR_EVENT_LABELS[type] ?? type} — «${b.title}»`,
          {
            eventId: b.eventId,
          },
        ),
      );
    }
    if (c.lessonType === LessonType.PRACTICE && practiceType && !day.practiceTypes.includes(practiceType)) {
      issues.push(
        issue(
          Severity.WARNING,
          'PRACTICE_OUTSIDE_PERIOD',
          'Занятие практики вне периода практики группы в календарном графике',
        ),
      );
    }

    // --- Занятия в этот слот и в этот день
    const dayLessons = await this.prisma.scheduleLesson.findMany({
      where: {
        schedulePeriod: { organizationId: c.organizationId },
        date: parseDate(date),
        status: { in: ACTIVE_STATUSES },
        id: exclude.size ? { notIn: [...exclude] } : undefined,
      },
      include: {
        studentGroup: { select: { code: true } },
        teacher: { select: { fullName: true } },
        classroom: { select: { code: true } },
        semesterItem: { include: { curriculumItem: { select: { name: true } } } },
      },
    });
    const slotLessons = dayLessons.filter((l) => l.lessonNumber === c.lessonNumber);
    const sameStream = (l: { streamKey: string | null }) => !!c.streamKey && l.streamKey === c.streamKey;
    const describe = (l: (typeof dayLessons)[number]) =>
      `${l.studentGroup.code}${l.subgroupNumber ? ` (п/г ${l.subgroupNumber})` : ''}, ${l.semesterItem.curriculumItem.name}`;

    for (const l of slotLessons.filter((x) => x.studentGroupId === c.studentGroupId)) {
      const overlap =
        c.subgroupNumber === null || l.subgroupNumber === null || l.subgroupNumber === c.subgroupNumber;
      if (overlap) {
        issues.push(
          issue(Severity.ERROR, 'GROUP_CONFLICT', `У группы уже есть занятие в это время: ${describe(l)}`, {
            lessonId: l.id,
          }),
        );
      }
    }

    if (!c.teacherId) {
      issues.push(issue(Severity.ERROR, 'NO_TEACHER', 'Не указан преподаватель'));
    } else if (teacher) {
      if (!teacher.isActive)
        issues.push(
          issue(Severity.ERROR, 'TEACHER_UNAVAILABLE', `Преподаватель ${teacher.fullName} неактивен`),
        );
      const slot = teacher.availability.find(
        (a) => a.weekday === weekday && a.lessonNumber === c.lessonNumber,
      );
      if (slot && !slot.isAvailable) {
        issues.push(
          issue(
            Severity.ERROR,
            'TEACHER_UNAVAILABLE',
            `Преподаватель ${teacher.fullName} недоступен в это время${slot.reason ? ` (${slot.reason})` : ''}`,
          ),
        );
      }
      if (c.lessonNumber < teacher.preferredStartLesson || c.lessonNumber > teacher.preferredEndLesson) {
        issues.push(
          issue(
            Severity.INFO,
            'TEACHER_PREFERENCE',
            `Пара вне предпочтительного времени преподавателя ${teacher.fullName}`,
          ),
        );
      }
      for (const b of ctx.teacherBlocks(teacher.id, date)) {
        issues.push(
          issue(
            Severity.ERROR,
            'TEACHER_UNAVAILABLE',
            `Преподаватель ${teacher.fullName} недоступен: ${b.title}`,
          ),
        );
      }
      for (const l of slotLessons.filter((x) => x.teacherId === c.teacherId && !sameStream(x))) {
        issues.push(
          issue(
            Severity.ERROR,
            'TEACHER_CONFLICT',
            `Преподаватель ${teacher.fullName} уже ведёт занятие в это время: ${describe(l)}`,
            {
              lessonId: l.id,
            },
          ),
        );
      }
      const teacherDay = new Set(
        dayLessons.filter((x) => x.teacherId === c.teacherId).map((x) => x.lessonNumber),
      );
      teacherDay.add(c.lessonNumber);
      if (teacherDay.size > teacher.maxDailyLessons) {
        issues.push(
          issue(
            Severity.WARNING,
            'TEACHER_OVERLOAD',
            `У преподавателя ${teacher.fullName} ${teacherDay.size} пар в день (лимит ${teacher.maxDailyLessons})`,
          ),
        );
      }
      const ws = weekStart(date);
      const weekCount = await this.prisma.scheduleLesson.count({
        where: {
          teacherId: c.teacherId,
          status: { in: ACTIVE_STATUSES },
          date: { gte: parseDate(ws), lte: parseDate(addDaysStr(ws, 6)) },
          id: exclude.size ? { notIn: [...exclude] } : undefined,
        },
      });
      if (weekCount + 1 > teacher.maxWeeklyLessons) {
        issues.push(
          issue(
            Severity.WARNING,
            'TEACHER_OVERLOAD',
            `У преподавателя ${teacher.fullName} ${weekCount + 1} пар в неделю (лимит ${teacher.maxWeeklyLessons})`,
          ),
        );
      }
    }

    // --- Аудитория
    const subgroup = c.subgroupNumber
      ? group.subgroups.find((s) => s.number === c.subgroupNumber)
      : undefined;
    let size = c.subgroupNumber
      ? subgroup && subgroup.studentCount > 0
        ? subgroup.studentCount
        : Math.ceil(group.studentCount / Math.max(1, group.subgroupCount))
      : group.studentCount;
    if (c.streamKey) {
      // Для потока учитываем все группы, занимающиеся одновременно
      const streamGroups = slotLessons.filter(
        (l) => l.streamKey === c.streamKey && l.studentGroupId !== c.studentGroupId,
      );
      for (const l of streamGroups) {
        const g = await this.prisma.studentGroup.findUnique({ where: { id: l.studentGroupId } });
        size += g?.studentCount ?? 0;
      }
    }
    if (!c.classroomId) {
      issues.push(issue(Severity.ERROR, 'NO_CLASSROOM', 'Не указана аудитория'));
    } else if (room) {
      if (!room.isActive)
        issues.push(issue(Severity.ERROR, 'CLASSROOM_UNAVAILABLE', `Аудитория ${room.code} неактивна`));
      const slot = room.availability.find((a) => a.weekday === weekday && a.lessonNumber === c.lessonNumber);
      if (slot && !slot.isAvailable) {
        issues.push(
          issue(
            Severity.ERROR,
            'CLASSROOM_UNAVAILABLE',
            `Аудитория ${room.code} недоступна в это время${slot.reason ? ` (${slot.reason})` : ''}`,
          ),
        );
      }
      if (room.classroomType !== ClassroomType.ONLINE) {
        for (const l of slotLessons.filter((x) => x.classroomId === c.classroomId && !sameStream(x))) {
          issues.push(
            issue(Severity.ERROR, 'CLASSROOM_CONFLICT', `Аудитория ${room.code} уже занята: ${describe(l)}`, {
              lessonId: l.id,
            }),
          );
        }
        if (room.capacity < size) {
          issues.push(
            issue(
              Severity.ERROR,
              'CAPACITY_EXCEEDED',
              `Вместимость аудитории ${room.code} (${room.capacity}) меньше численности (${size})`,
            ),
          );
        }
      }
      const assignment = await this.prisma.groupCurriculumAssignment.findFirst({
        where: {
          studentGroupId: c.studentGroupId,
          semesterCurriculumItemId: c.semesterCurriculumItemId,
          OR: [{ lessonType: c.lessonType }, { lessonType: null }],
          subgroupNumber: c.subgroupNumber,
        },
        orderBy: { lessonType: 'asc' },
      });
      const allowed = effectiveRoomTypes(c.lessonType, item, assignment?.classroomTypes);
      if (!allowed.includes(room.classroomType)) {
        issues.push(
          issue(
            Severity.ERROR,
            'WRONG_CLASSROOM_TYPE',
            `Тип аудитории ${room.code} «${CLASSROOM_TYPE_LABELS[room.classroomType]}» не подходит: требуется ${allowed
              .map((t) => `«${CLASSROOM_TYPE_LABELS[t]}»`)
              .join(' или ')}`,
          ),
        );
      }
    }

    // --- Лимит пар группы в день (мягкое ограничение)
    const groupDay = new Set(
      dayLessons
        .filter(
          (l) =>
            l.studentGroupId === c.studentGroupId &&
            (c.subgroupNumber === null || l.subgroupNumber === null || l.subgroupNumber === c.subgroupNumber),
        )
        .map((l) => l.lessonNumber),
    );
    groupDay.add(c.lessonNumber);
    if (groupDay.size > settings.maxGroupLessonsPerDay) {
      issues.push(
        issue(
          Severity.WARNING,
          'GROUP_DAILY_LIMIT',
          `У группы ${group.code} ${groupDay.size} пар в этот день (рекомендуемый максимум ${settings.maxGroupLessonsPerDay})`,
        ),
      );
    }

    if (c.academicHours < settings.academicHoursPerLesson && settings.warnOnPartialLessons) {
      issues.push(issue(Severity.WARNING, 'PARTIAL_LESSON', `Неполная пара: ${c.academicHours} ак. ч.`));
    }

    // --- Превышение плановых часов
    if (!c.skipHoursCheck && c.lessonType !== LessonType.OTHER) {
      const streams = await this.planning.getStreams({
        organizationId: c.organizationId,
        semesterItemId: c.semesterCurriculumItemId,
        groupIds: [c.studentGroupId],
      });
      const key = streamKeyOf(c.studentGroupId, c.semesterCurriculumItemId, c.lessonType, c.subgroupNumber);
      const stream =
        streams.find((s) => s.key === key) ??
        streams.find(
          (s) => s.key === streamKeyOf(c.studentGroupId, c.semesterCurriculumItemId, c.lessonType, null),
        );
      if (!stream) {
        issues.push(
          issue(
            Severity.ERROR,
            'HOURS_EXCEEDED',
            'По учебному плану у дисциплины нет часов этого вида занятий',
          ),
        );
      } else {
        const lessons = await this.prisma.scheduleLesson.findMany({
          where: {
            studentGroupId: c.studentGroupId,
            semesterCurriculumItemId: c.semesterCurriculumItemId,
            lessonType: c.lessonType,
            id: exclude.size ? { notIn: [...exclude] } : undefined,
          },
          include: { conducted: true },
        });
        const { matched } = matchLessonsToStreams(
          streams,
          lessons.map((l) => ({
            id: l.id,
            studentGroupId: l.studentGroupId,
            semesterCurriculumItemId: l.semesterCurriculumItemId,
            lessonType: l.lessonType,
            subgroupNumber: l.subgroupNumber,
            status: l.status,
            academicHours: l.academicHours,
            date: toDateStr(l.date),
            teacherId: l.teacherId,
            allowHoursExcess: l.allowHoursExcess,
            conducted: l.conducted,
          })),
        );
        const hours = computeStreamHours(stream, matched.get(stream.key) ?? [], date);
        const after = hours.scheduled + c.academicHours;
        if (after > stream.plannedHours) {
          const allowed = c.allowHoursExcess || hours.excessApproved;
          issues.push(
            issue(
              allowed ? Severity.WARNING : Severity.ERROR,
              allowed ? 'HOURS_EXCESS_APPROVED' : 'HOURS_EXCEEDED',
              `Превышение плана: будет ${after} ч при плане ${stream.plannedHours} ч${allowed ? ' (разрешено вручную)' : ''}`,
            ),
          );
        }
      }
    }
    return issues;
  }
}
