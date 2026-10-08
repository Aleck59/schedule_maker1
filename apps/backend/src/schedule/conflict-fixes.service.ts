import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConductedStatus, LessonStatus, Prisma, Severity } from '@prisma/client';
import { AuthUser } from '../common/types/auth-user';
import {
  addDaysStr,
  formatDateRu,
  isoWeekday,
  maxDate,
  minDate,
  toDateStr,
  todayInTimezone,
  weekStart,
} from '../common/utils/dates';
import { CLASSROOM_TYPE_LABELS, WEEKDAY_SHORT_LABELS } from '../common/utils/labels';
import { ACTIVE_STATUSES } from '../planning/hours-calculator';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { LessonCandidate, LessonCheckerService } from '../validation/lesson-checker.service';
import { ScheduleValidatorService } from '../validation/schedule-validator.service';
import { ValidationIssue, VALIDATION_TYPE_LABELS } from '../validation/validation.types';
import { ScheduleLessonsService } from './schedule-lessons.service';
import { SlotFinderService } from './slot-finder.service';

export type FixAction = 'MOVE' | 'CHANGE_ROOM' | 'CHANGE_TEACHER' | 'DELETE';

export interface FixOption {
  action: FixAction;
  lessonId: string;
  title: string;
  params: {
    date?: string;
    lessonNumber?: number;
    classroomId?: string;
    teacherId?: string;
    lessonIds?: string[];
  };
}

export interface IssueFix {
  key: string;
  issue: ValidationIssue;
  typeLabel: string;
  /** Занятия, к которым относится проблема */
  lessons: Array<{ id: string; label: string; movable: boolean }>;
  options: FixOption[];
  /** Почему нет вариантов или что учесть */
  note: string | null;
}

const lessonInclude = {
  studentGroup: { select: { id: true, code: true } },
  semesterItem: { select: { id: true, curriculumItem: { select: { code: true, name: true } } } },
  teacher: { select: { id: true, fullName: true, department: true } },
  classroom: { select: { id: true, code: true } },
  conducted: true,
} satisfies Prisma.ScheduleLessonInclude;
type FixLesson = Prisma.ScheduleLessonGetPayload<{ include: typeof lessonInclude }>;

/** Предупреждения, для которых тоже предлагаются исправления */
const FIXABLE_WARNINGS = new Set(['ONLINE_EXPECTED', 'LESSON_ON_DAY_OFF', 'LESSON_NUMBER_EXCEEDS']);
const MAX_ISSUES = 40;

/**
 * Предложения по устранению конфликтов расписания: для каждой ошибки проверки —
 * конкретные действия (перенос в свободный слот, другая аудитория, замена
 * преподавателя, удаление дубликата или лишних занятий), применение в один клик
 * и автоматическое исправление всех ошибок.
 */
@Injectable()
export class ConflictFixesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validator: ScheduleValidatorService,
    private readonly checker: LessonCheckerService,
    private readonly slots: SlotFinderService,
    private readonly lessons: ScheduleLessonsService,
    private readonly settings: SettingsService,
  ) {}

  private label(l: FixLesson): string {
    const date = toDateStr(l.date);
    return `${l.studentGroup.code}${l.subgroupNumber ? ` (п/г ${l.subgroupNumber})` : ''}: «${l.semesterItem.curriculumItem.name}», ${formatDateRu(date)} (${WEEKDAY_SHORT_LABELS[isoWeekday(date)]}), ${l.lessonNumber} пара`;
  }

  private movable(l: FixLesson): boolean {
    return (
      l.status === LessonStatus.PLANNED &&
      !l.isLocked &&
      !(l.conducted && l.conducted.status === ConductedStatus.CONDUCTED)
    );
  }

  private candidate(
    l: FixLesson,
    organizationId: string,
    patch: Partial<LessonCandidate> = {},
  ): LessonCandidate {
    return {
      organizationId,
      lessonId: l.id,
      schedulePeriodId: l.schedulePeriodId,
      date: toDateStr(l.date),
      lessonNumber: l.lessonNumber,
      studentGroupId: l.studentGroupId,
      subgroupNumber: l.subgroupNumber,
      semesterCurriculumItemId: l.semesterCurriculumItemId,
      lessonType: l.lessonType,
      teacherId: l.teacherId,
      classroomId: l.classroomId,
      academicHours: l.academicHours,
      streamKey: l.streamKey,
      skipHoursCheck: true,
      ...patch,
    };
  }

  private async passes(c: LessonCandidate): Promise<boolean> {
    const issues = await this.checker.check(c);
    return !issues.some((i) => i.severity === Severity.ERROR);
  }

  /** Свободные слоты для переноса: та же неделя и три следующие, не раньше сегодняшнего дня */
  private async moveOptions(
    l: FixLesson,
    period: { startDate: Date; endDate: Date },
    organizationId: string,
    limit: number,
  ) {
    const settings = await this.settings.getEffective(organizationId);
    const today = todayInTimezone(settings.timezone);
    const date = toDateStr(l.date);
    const periodStart = toDateStr(period.startDate);
    const periodEnd = toDateStr(period.endDate);
    // Будущее занятие не переносится в прошлое; для прошедших дат — в пределах той же недели и далее
    const from = maxDate(date >= today ? maxDate(weekStart(date), today) : weekStart(date), periodStart);
    let to = minDate(addDaysStr(from, 27), periodEnd);
    if (from > to) to = from;
    const slots = await this.slots.find({
      organizationId,
      studentGroupId: l.studentGroupId,
      subgroupNumber: l.subgroupNumber,
      semesterCurriculumItemId: l.semesterCurriculumItemId,
      lessonType: l.lessonType,
      teacherId: l.teacherId,
      from,
      to,
      excludeLessonIds: [l.id],
      limit: limit * 3,
    });
    const options: FixOption[] = [];
    for (const s of slots) {
      if (options.length >= limit) break;
      if (s.date === date && s.lessonNumber === l.lessonNumber) continue;
      const ok = await this.passes(
        this.candidate(l, organizationId, {
          date: s.date,
          lessonNumber: s.lessonNumber,
          classroomId: s.classroomId ?? l.classroomId,
        }),
      );
      if (!ok) continue;
      options.push({
        action: 'MOVE',
        lessonId: l.id,
        title: `Перенести на ${formatDateRu(s.date)} (${WEEKDAY_SHORT_LABELS[s.weekday]}), ${s.lessonNumber} пара${s.classroomCode ? `, ауд. ${s.classroomCode}` : ''}${s.note && s.note !== 'подходит' ? ` — ${s.note}` : ''}`,
        params: { date: s.date, lessonNumber: s.lessonNumber, classroomId: s.classroomId ?? undefined },
      });
    }
    return options;
  }

  /** Свободные подходящие аудитории в том же слоте */
  private async roomOptions(l: FixLesson, organizationId: string, limit: number) {
    const rooms = await this.prisma.classroom.findMany({
      where: { organizationId, isActive: true, id: l.classroomId ? { not: l.classroomId } : undefined },
      orderBy: [{ capacity: 'asc' }, { code: 'asc' }],
    });
    const options: FixOption[] = [];
    for (const r of rooms) {
      if (options.length >= limit) break;
      if (!(await this.passes(this.candidate(l, organizationId, { classroomId: r.id })))) continue;
      options.push({
        action: 'CHANGE_ROOM',
        lessonId: l.id,
        title: `Поставить в аудиторию ${r.code} (${CLASSROOM_TYPE_LABELS[r.classroomType].toLowerCase()}, ${r.capacity} мест)`,
        params: { classroomId: r.id },
      });
    }
    return options;
  }

  /** Замена преподавателя: ведущие ту же дисциплину, затем коллеги по цикловой комиссии */
  private async teacherOptions(l: FixLesson, organizationId: string, limit: number) {
    const sameItem = await this.prisma.groupCurriculumAssignment.findMany({
      where: {
        teacherId: { not: null },
        semesterItem: { curriculumItem: { code: l.semesterItem.curriculumItem.code } },
      },
      select: { teacherId: true },
    });
    const qualified = new Set(sameItem.map((a) => a.teacherId!));
    const teachers = await this.prisma.teacher.findMany({
      where: { organizationId, isActive: true, id: l.teacherId ? { not: l.teacherId } : undefined },
      orderBy: { fullName: 'asc' },
    });
    const ranked = teachers
      .map((t) => ({
        t,
        rank: qualified.has(t.id)
          ? 0
          : l.teacher?.department && t.department === l.teacher.department
            ? 1
            : 2,
      }))
      .filter((x) => x.rank < 2)
      .sort((a, b) => a.rank - b.rank);
    const options: FixOption[] = [];
    for (const { t, rank } of ranked) {
      if (options.length >= limit) break;
      if (!(await this.passes(this.candidate(l, organizationId, { teacherId: t.id })))) continue;
      options.push({
        action: 'CHANGE_TEACHER',
        lessonId: l.id,
        title: `Заменить преподавателя на ${t.fullName} (${rank === 0 ? 'ведёт эту дисциплину' : 'та же цикловая комиссия'})`,
        params: { teacherId: t.id },
      });
    }
    return options;
  }

  async suggest(periodId: string, actor: AuthUser) {
    const period = await this.prisma.schedulePeriod.findFirst({
      where: { id: periodId, organizationId: actor.organizationId },
    });
    if (!period) throw new NotFoundException('Период расписания не найден');
    const summary = await this.validator.validatePeriod(periodId, actor.organizationId, false);
    const relevant = summary.items.filter(
      (i) => i.severity === Severity.ERROR || FIXABLE_WARNINGS.has(i.validationType),
    );
    const ids = new Set<string>();
    for (const i of relevant) {
      if (i.entityType === 'ScheduleLesson' && i.entityId) ids.add(i.entityId);
      for (const id of [
        ...((i.details?.lessonIds as string[]) ?? []),
        ...((i.details?.excessLessonIds as string[]) ?? []),
      ])
        ids.add(id);
    }
    const lessons = await this.prisma.scheduleLesson.findMany({
      where: { id: { in: [...ids] } },
      include: lessonInclude,
    });
    const byId = new Map(lessons.map((l) => [l.id, l]));
    const onlineRoom = await this.prisma.classroom.findFirst({
      where: { organizationId: actor.organizationId, isActive: true, classroomType: 'ONLINE' },
    });

    const fixes: IssueFix[] = [];
    for (const [index, issue] of relevant.slice(0, MAX_ISSUES).entries()) {
      const fix: IssueFix = {
        key: `${issue.validationType}#${issue.entityId ?? ''}#${index}`,
        issue,
        typeLabel: VALIDATION_TYPE_LABELS[issue.validationType] ?? issue.validationType,
        lessons: [],
        options: [],
        note: null,
      };
      const lessonIds =
        issue.entityType === 'ScheduleLesson' && issue.entityId
          ? [issue.entityId]
          : ((issue.details?.lessonIds as string[]) ?? []);
      const involved = lessonIds.map((id) => byId.get(id)).filter((l): l is FixLesson => !!l);
      fix.lessons = involved.map((l) => ({ id: l.id, label: this.label(l), movable: this.movable(l) }));
      const own = involved.filter((l) => l.schedulePeriodId === periodId);
      // Переставляем занятие, которое можно менять: последнее добавленное, не закреплённое и не проведённое
      const target = [...own].reverse().find((l) => this.movable(l)) ?? null;
      const stream = target?.streamKey
        ? involved.filter((l) => l.streamKey === target.streamKey).length > 1 ||
          (await this.prisma.scheduleLesson.count({
            where: {
              streamKey: target.streamKey,
              date: target.date,
              lessonNumber: target.lessonNumber,
              status: { in: ACTIVE_STATUSES },
            },
          })) > 1
        : false;

      switch (issue.validationType) {
        case 'GROUP_CONFLICT':
        case 'TEACHER_CONFLICT':
        case 'CLASSROOM_CONFLICT': {
          if (!target) {
            fix.note = 'Все занятия в этом слоте проведены или закреплены — измените их вручную';
            break;
          }
          // Дубликат: то же занятие (дисциплина, вид, подгруппа) дважды в одном слоте
          const duplicate = own.find(
            (l) =>
              l.id !== target.id &&
              l.studentGroupId === target.studentGroupId &&
              l.semesterCurriculumItemId === target.semesterCurriculumItemId &&
              l.lessonType === target.lessonType &&
              l.subgroupNumber === target.subgroupNumber,
          );
          if (duplicate) {
            fix.options.push({
              action: 'DELETE',
              lessonId: target.id,
              title: 'Удалить дублирующее занятие',
              params: { lessonIds: [target.id] },
            });
          }
          if (issue.validationType === 'CLASSROOM_CONFLICT') {
            fix.options.push(...(await this.roomOptions(target, actor.organizationId, 3)));
          }
          if (!stream) fix.options.push(...(await this.moveOptions(target, period, actor.organizationId, 3)));
          if (issue.validationType === 'TEACHER_CONFLICT') {
            fix.options.push(...(await this.teacherOptions(target, actor.organizationId, 2)));
          }
          break;
        }
        case 'CAPACITY_EXCEEDED':
        case 'WRONG_CLASSROOM_TYPE':
        case 'CLASSROOM_UNAVAILABLE':
        case 'NO_CLASSROOM': {
          if (!target) break;
          fix.options.push(...(await this.roomOptions(target, actor.organizationId, 3)));
          if (!stream) fix.options.push(...(await this.moveOptions(target, period, actor.organizationId, 2)));
          break;
        }
        case 'TEACHER_UNAVAILABLE': {
          if (!target) break;
          if (!stream) fix.options.push(...(await this.moveOptions(target, period, actor.organizationId, 3)));
          fix.options.push(...(await this.teacherOptions(target, actor.organizationId, 2)));
          break;
        }
        case 'NO_TEACHER': {
          if (!target) break;
          const assignment = await this.prisma.groupCurriculumAssignment.findFirst({
            where: {
              studentGroupId: target.studentGroupId,
              semesterCurriculumItemId: target.semesterCurriculumItemId,
              teacherId: { not: null },
            },
            include: { teacher: true },
          });
          if (
            assignment?.teacher &&
            (await this.passes(
              this.candidate(target, actor.organizationId, { teacherId: assignment.teacher.id }),
            ))
          ) {
            fix.options.push({
              action: 'CHANGE_TEACHER',
              lessonId: target.id,
              title: `Назначить преподавателя по нагрузке: ${assignment.teacher.fullName}`,
              params: { teacherId: assignment.teacher.id },
            });
          }
          fix.options.push(...(await this.teacherOptions(target, actor.organizationId, 2)));
          break;
        }
        case 'LESSON_IN_VACATION':
        case 'LESSON_IN_PRACTICE':
        case 'LESSON_ON_HOLIDAY':
        case 'LESSON_IN_BLOCKED_PERIOD':
        case 'LESSON_OUTSIDE_SEMESTER':
        case 'LESSON_OUTSIDE_PERIOD':
        case 'PRACTICE_OUTSIDE_PERIOD':
        case 'LESSON_ON_DAY_OFF':
        case 'LESSON_NUMBER_EXCEEDS': {
          if (!target) break;
          if (!stream) fix.options.push(...(await this.moveOptions(target, period, actor.organizationId, 3)));
          fix.options.push({
            action: 'DELETE',
            lessonId: target.id,
            title: 'Удалить занятие (часы останутся невыполненными — их покажет контроль часов)',
            params: { lessonIds: [target.id] },
          });
          break;
        }
        case 'HOURS_EXCEEDED': {
          const excess = ((issue.details?.excessLessonIds as string[]) ?? []).filter((id) => byId.has(id));
          if (excess.length) {
            const first = byId.get(excess[excess.length - 1])!;
            fix.lessons = excess.map((id) => {
              const l = byId.get(id)!;
              return { id, label: this.label(l), movable: this.movable(l) };
            });
            fix.options.push({
              action: 'DELETE',
              lessonId: first.id,
              title: `Удалить ${excess.length} последних занятий сверх плана`,
              params: { lessonIds: excess },
            });
          } else {
            fix.note = 'Лишние занятия уже проведены — разрешите превышение часов или скорректируйте план';
          }
          break;
        }
        case 'ONLINE_EXPECTED': {
          if (target && onlineRoom) {
            fix.options.push({
              action: 'CHANGE_ROOM',
              lessonId: target.id,
              title: `Поставить в онлайн-аудиторию ${onlineRoom.code}`,
              params: { classroomId: onlineRoom.id },
            });
          } else if (!onlineRoom) {
            fix.note = 'Добавьте в справочник аудиторию с типом «Онлайн»';
          }
          break;
        }
        default:
          break;
      }
      if (!fix.options.length && !fix.note) {
        fix.note = target
          ? stream
            ? 'Занятие потока: переносите все группы потока вручную'
            : 'Подходящих вариантов не найдено — измените занятие вручную или ослабьте ограничения'
          : 'Исправляется вне расписания (нагрузка, план, справочники)';
      }
      fixes.push(fix);
    }
    return {
      errors: summary.errors,
      warnings: summary.warnings,
      canPublish: summary.canPublish,
      total: relevant.length,
      shown: fixes.length,
      fixes,
    };
  }

  async apply(periodId: string, option: Pick<FixOption, 'action' | 'lessonId' | 'params'>, actor: AuthUser) {
    const lesson = await this.prisma.scheduleLesson.findFirst({
      where: {
        id: option.lessonId,
        schedulePeriodId: periodId,
        schedulePeriod: { organizationId: actor.organizationId },
      },
    });
    if (!lesson) throw new NotFoundException('Занятие не найдено в этом периоде');
    switch (option.action) {
      case 'MOVE':
        if (!option.params.date || !option.params.lessonNumber) {
          throw new BadRequestException('Не указаны дата и пара переноса');
        }
        return this.lessons.move(
          lesson.id,
          {
            date: option.params.date,
            lessonNumber: option.params.lessonNumber,
            classroomId: option.params.classroomId,
            reason: 'Устранение конфликта расписания',
          },
          actor,
        );
      case 'CHANGE_ROOM':
        if (!option.params.classroomId) throw new BadRequestException('Не указана аудитория');
        return this.lessons.update(lesson.id, { classroomId: option.params.classroomId }, actor);
      case 'CHANGE_TEACHER':
        if (!option.params.teacherId) throw new BadRequestException('Не указан преподаватель');
        return this.lessons.update(lesson.id, { teacherId: option.params.teacherId }, actor);
      case 'DELETE': {
        const ids = option.params.lessonIds?.length ? option.params.lessonIds : [lesson.id];
        const own = await this.prisma.scheduleLesson.count({
          where: { id: { in: ids }, schedulePeriodId: periodId },
        });
        if (own !== ids.length) throw new BadRequestException('Часть занятий не относится к этому периоду');
        for (const id of ids) await this.lessons.remove(id, actor);
        return { deleted: ids.length };
      }
      default:
        throw new BadRequestException('Неизвестное действие');
    }
  }

  /** Автоматическое исправление: для каждой ошибки применяется первый подходящий вариант */
  async autoFix(periodId: string, actor: AuthUser, maxSteps = 30) {
    const applied: Array<{ issue: string; fix: string }> = [];
    const failed: Array<{ issue: string; reason: string }> = [];
    const tried = new Set<string>();
    for (let step = 0; step < maxSteps; step++) {
      const { fixes } = await this.suggest(periodId, actor);
      const next = fixes.find(
        (f) => f.issue.severity === Severity.ERROR && f.options.length > 0 && !tried.has(f.issue.message),
      );
      if (!next) break;
      tried.add(next.issue.message);
      let done = false;
      for (const option of next.options) {
        try {
          await this.apply(periodId, option, actor);
          applied.push({ issue: next.issue.message, fix: option.title });
          done = true;
          break;
        } catch (e) {
          failed.push({ issue: next.issue.message, reason: (e as Error).message });
        }
      }
      if (!done) continue;
    }
    const summary = await this.validator.validatePeriod(periodId, actor.organizationId, true);
    return {
      applied,
      failed: failed.filter((f) => !applied.some((a) => a.issue === f.issue)),
      errors: summary.errors,
      warnings: summary.warnings,
      canPublish: summary.canPublish,
    };
  }
}
