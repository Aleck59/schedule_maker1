import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ConductedStatus,
  LessonStatus,
  MakeupTaskStatus,
  NotificationType,
  Prisma,
  SchedulePeriodStatus,
  Severity,
  UserRole,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/types/auth-user';
import {
  addDaysStr,
  formatDateRu,
  isoWeekday,
  parseDate,
  toDateStr,
  todayInTimezone,
} from '../common/utils/dates';
import { CANCELLATION_REASON_LABELS, LESSON_TYPE_LABELS } from '../common/utils/labels';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { LessonCandidate, LessonCheckerService } from '../validation/lesson-checker.service';
import { ValidationIssue } from '../validation/validation.types';
import {
  BulkLessonsDto,
  CancelLessonDto,
  CheckLessonDto,
  CopyLessonDto,
  CreateLessonDto,
  LessonQueryDto,
  MarkConductedDto,
  MoveLessonDto,
  SubstituteDto,
  UpdateLessonDto,
} from './dto/schedule.dto';
import { SlotFinderService } from './slot-finder.service';

export const LESSON_INCLUDE = {
  studentGroup: { select: { id: true, code: true, studentCount: true } },
  semesterItem: {
    select: {
      id: true,
      semesterId: true,
      curriculumItem: { select: { id: true, code: true, name: true, itemType: true, isDifficult: true } },
    },
  },
  teacher: { select: { id: true, fullName: true } },
  classroom: {
    select: { id: true, code: true, name: true, building: true, classroomType: true, capacity: true },
  },
  conducted: { include: { actualTeacher: { select: { id: true, fullName: true } } } },
  schedulePeriod: { select: { id: true, title: true, status: true } },
  originalLesson: { select: { id: true, date: true, lessonNumber: true, status: true } },
  derivedLessons: { select: { id: true, date: true, lessonNumber: true, status: true } },
  substitutions: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    include: {
      originalTeacher: { select: { id: true, fullName: true } },
      substituteTeacher: { select: { id: true, fullName: true } },
    },
  },
} satisfies Prisma.ScheduleLessonInclude;

export type LessonWithRelations = Prisma.ScheduleLessonGetPayload<{ include: typeof LESSON_INCLUDE }>;

export function presentLesson(l: LessonWithRelations) {
  return {
    ...l,
    date: toDateStr(l.date),
    originalLesson: l.originalLesson ? { ...l.originalLesson, date: toDateStr(l.originalLesson.date) } : null,
    derivedLessons: l.derivedLessons.map((d) => ({ ...d, date: toDateStr(d.date) })),
    substitution: l.substitutions[0] ?? null,
    substitutions: undefined,
  };
}

const EDITOR: UserRole[] = [UserRole.ADMIN, UserRole.DISPATCHER];

@Injectable()
export class ScheduleLessonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly checker: LessonCheckerService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly slots: SlotFinderService,
  ) {}

  // ---------------------------------------------------------------- чтение

  async list(query: LessonQueryDto, actor: AuthUser) {
    const where: Prisma.ScheduleLessonWhereInput = {
      schedulePeriod: { organizationId: actor.organizationId },
      schedulePeriodId: query.periodId || undefined,
      studentGroupId: query.groupId || undefined,
      classroomId: query.classroomId || undefined,
      semesterCurriculumItemId: query.semesterItemId || undefined,
      date: {
        gte: query.from ? parseDate(query.from) : undefined,
        lte: query.to ? parseDate(query.to) : undefined,
      },
    };
    if (query.teacherId) {
      where.OR = [
        { teacherId: query.teacherId },
        { substitutions: { some: { originalTeacherId: query.teacherId } } },
      ];
    }
    const statuses = query.status ? (Array.isArray(query.status) ? query.status : [query.status]) : undefined;
    if (statuses?.length) where.status = { in: statuses };
    else if (query.activeOnly === 'true')
      where.status = { notIn: [LessonStatus.CANCELLED, LessonStatus.MOVED] };
    this.applyRoleScope(where, actor);
    const lessons = await this.prisma.scheduleLesson.findMany({
      where,
      include: LESSON_INCLUDE,
      orderBy: [
        { date: 'asc' },
        { lessonNumber: 'asc' },
        { studentGroup: { code: 'asc' } },
        { subgroupNumber: 'asc' },
      ],
      take: 5000,
    });
    return lessons.map(presentLesson);
  }

  private applyRoleScope(where: Prisma.ScheduleLessonWhereInput, actor: AuthUser) {
    if (actor.role === UserRole.STUDENT) {
      where.studentGroupId = actor.studentGroupId ?? '00000000-0000-0000-0000-000000000000';
      where.schedulePeriod = { organizationId: actor.organizationId, status: SchedulePeriodStatus.PUBLISHED };
    } else if (actor.role === UserRole.TEACHER) {
      where.schedulePeriod = { organizationId: actor.organizationId, status: SchedulePeriodStatus.PUBLISHED };
    }
  }

  async get(id: string, actor: AuthUser) {
    const where: Prisma.ScheduleLessonWhereInput = {
      id,
      schedulePeriod: { organizationId: actor.organizationId },
    };
    this.applyRoleScope(where, actor);
    const lesson = await this.prisma.scheduleLesson.findFirst({ where, include: LESSON_INCLUDE });
    if (!lesson) throw new NotFoundException('Занятие не найдено');
    return lesson;
  }

  /** Лента изменений расписания (для студентов и преподавателей) */
  async changes(
    actor: AuthUser,
    params: { groupId?: string; teacherId?: string; from?: string; to?: string },
  ) {
    const settings = await this.settings.getEffective(actor.organizationId);
    const today = todayInTimezone(settings.timezone);
    const from = params.from ?? addDaysStr(today, -7);
    const to = params.to ?? addDaysStr(today, 30);
    const where: Prisma.ScheduleLessonWhereInput = {
      schedulePeriod: { organizationId: actor.organizationId },
      studentGroupId: params.groupId || undefined,
      date: { gte: parseDate(from), lte: parseDate(to) },
      OR: [
        { status: { in: [LessonStatus.CANCELLED, LessonStatus.MOVED, LessonStatus.REPLACED] } },
        { originalLessonId: { not: null } },
        { isManual: true },
      ],
    };
    if (params.teacherId) {
      where.AND = [
        {
          OR: [
            { teacherId: params.teacherId },
            { substitutions: { some: { originalTeacherId: params.teacherId } } },
          ],
        },
      ];
    }
    this.applyRoleScope(where, actor);
    const lessons = await this.prisma.scheduleLesson.findMany({
      where,
      include: LESSON_INCLUDE,
      orderBy: [{ updatedAt: 'desc' }],
      take: 300,
    });
    return lessons.map(presentLesson);
  }

  // ---------------------------------------------------------------- доступ

  private async loadForChange(id: string, actor: AuthUser) {
    const lesson = await this.prisma.scheduleLesson.findFirst({
      where: { id, schedulePeriod: { organizationId: actor.organizationId } },
      include: { ...LESSON_INCLUDE, schedulePeriod: true },
    });
    if (!lesson) throw new NotFoundException('Занятие не найдено');
    if (lesson.schedulePeriod.status === SchedulePeriodStatus.ARCHIVED) {
      throw new ConflictException('Период расписания находится в архиве — изменения запрещены');
    }
    if (actor.role === UserRole.TEACHER) {
      const own =
        lesson.teacherId === actor.teacherId ||
        lesson.substitutions.some(
          (s) => s.originalTeacherId === actor.teacherId || s.substituteTeacherId === actor.teacherId,
        );
      if (!own) throw new ForbiddenException('Преподаватель может изменять только свои занятия');
      if (lesson.schedulePeriod.status !== SchedulePeriodStatus.PUBLISHED) {
        throw new ForbiddenException('Расписание ещё не опубликовано');
      }
    } else if (!EDITOR.includes(actor.role)) {
      throw new ForbiddenException('Недостаточно прав для изменения расписания');
    }
    return lesson;
  }

  private canForce(actor: AuthUser, force?: boolean) {
    return !!force && EDITOR.includes(actor.role);
  }

  /** Проверка конфликтов: ошибки блокируют сохранение, если не указан force */
  private async ensureNoConflicts(
    candidate: LessonCandidate,
    actor: AuthUser,
    force?: boolean,
  ): Promise<ValidationIssue[]> {
    const issues = await this.checker.check(candidate);
    const errors = issues.filter((i) => i.severity === Severity.ERROR);
    if (errors.length > 0 && !this.canForce(actor, force)) {
      throw new ConflictException({
        message: `Обнаружены конфликты: ${errors[0].message}`,
        errors: errors.map((e) => e.message),
        details: { issues },
      });
    }
    return issues;
  }

  private async times(organizationId: string, lessonNumber: number) {
    const settings = await this.settings.getEffective(organizationId);
    return this.settings.lessonTime(settings, lessonNumber);
  }

  private describe(l: {
    date: Date | string;
    lessonNumber: number;
    studentGroup: { code: string };
    semesterItem: { curriculumItem: { name: string } };
  }) {
    return `${l.studentGroup.code}: «${l.semesterItem.curriculumItem.name}» ${formatDateRu(l.date)}, ${l.lessonNumber} пара`;
  }

  // ---------------------------------------------------------------- создание / изменение / удаление

  async check(dto: CheckLessonDto, actor: AuthUser) {
    let base: Partial<LessonCandidate> = {};
    if (dto.lessonId) {
      const l = await this.prisma.scheduleLesson.findFirst({
        where: { id: dto.lessonId, schedulePeriod: { organizationId: actor.organizationId } },
      });
      if (!l) throw new NotFoundException('Занятие не найдено');
      base = {
        schedulePeriodId: l.schedulePeriodId,
        studentGroupId: l.studentGroupId,
        subgroupNumber: l.subgroupNumber,
        semesterCurriculumItemId: l.semesterCurriculumItemId,
        lessonType: l.lessonType,
        teacherId: l.teacherId,
        classroomId: l.classroomId,
        academicHours: l.academicHours,
        streamKey: l.streamKey,
        allowHoursExcess: l.allowHoursExcess,
      };
    }
    const candidate: LessonCandidate = {
      organizationId: actor.organizationId,
      lessonId: dto.lessonId,
      schedulePeriodId: dto.schedulePeriodId ?? base.schedulePeriodId!,
      date: dto.date,
      lessonNumber: dto.lessonNumber,
      studentGroupId: dto.studentGroupId ?? base.studentGroupId!,
      subgroupNumber: dto.subgroupNumber !== undefined ? dto.subgroupNumber : (base.subgroupNumber ?? null),
      semesterCurriculumItemId: dto.semesterCurriculumItemId ?? base.semesterCurriculumItemId!,
      lessonType: dto.lessonType ?? base.lessonType!,
      teacherId: dto.teacherId !== undefined ? dto.teacherId : (base.teacherId ?? null),
      classroomId: dto.classroomId !== undefined ? dto.classroomId : (base.classroomId ?? null),
      academicHours: dto.academicHours ?? base.academicHours ?? 2,
      streamKey: base.streamKey ?? null,
      allowHoursExcess: base.allowHoursExcess,
      skipHoursCheck: !!dto.lessonId,
    };
    if (
      !candidate.schedulePeriodId ||
      !candidate.studentGroupId ||
      !candidate.semesterCurriculumItemId ||
      !candidate.lessonType
    ) {
      throw new BadRequestException(
        'Недостаточно данных для проверки: укажите период, группу, дисциплину и вид занятия',
      );
    }
    const issues = await this.checker.check(candidate);
    return {
      ok: !issues.some((i) => i.severity === Severity.ERROR),
      errors: issues.filter((i) => i.severity === Severity.ERROR).length,
      warnings: issues.filter((i) => i.severity === Severity.WARNING).length,
      issues,
    };
  }

  async create(dto: CreateLessonDto, actor: AuthUser) {
    const period = await this.prisma.schedulePeriod.findFirst({
      where: { id: dto.schedulePeriodId, organizationId: actor.organizationId },
    });
    if (!period) throw new NotFoundException('Период расписания не найден');
    if (period.status === SchedulePeriodStatus.ARCHIVED) {
      throw new ConflictException('Период расписания находится в архиве');
    }
    const settings = await this.settings.getEffective(actor.organizationId);
    let makeupTask = null;
    if (dto.makeupTaskId) {
      makeupTask = await this.prisma.makeupTask.findFirst({
        where: { id: dto.makeupTaskId, group: { program: { organizationId: actor.organizationId } } },
      });
      if (!makeupTask) throw new BadRequestException('Задача отработки не найдена');
    }
    const academicHours = dto.academicHours ?? makeupTask?.academicHours ?? settings.academicHoursPerLesson;
    const issues = await this.ensureNoConflicts(
      {
        organizationId: actor.organizationId,
        schedulePeriodId: dto.schedulePeriodId,
        date: dto.date,
        lessonNumber: dto.lessonNumber,
        studentGroupId: dto.studentGroupId,
        subgroupNumber: dto.subgroupNumber ?? null,
        semesterCurriculumItemId: dto.semesterCurriculumItemId,
        lessonType: dto.lessonType,
        teacherId: dto.teacherId ?? null,
        classroomId: dto.classroomId ?? null,
        academicHours,
        streamKey: dto.streamKey ?? null,
        allowHoursExcess: dto.allowHoursExcess,
        // Отработка восполняет отменённые часы — превышения нет
        skipHoursCheck: !!makeupTask,
      },
      actor,
      dto.force,
    );
    const time = this.settings.lessonTime(settings, dto.lessonNumber);
    const assignment = await this.prisma.groupCurriculumAssignment.findFirst({
      where: {
        studentGroupId: dto.studentGroupId,
        semesterCurriculumItemId: dto.semesterCurriculumItemId,
        subgroupNumber: dto.subgroupNumber ?? null,
        OR: [{ lessonType: dto.lessonType }, { lessonType: null }],
      },
      orderBy: { lessonType: 'asc' },
    });
    const lesson = await this.prisma.$transaction(async (tx) => {
      const created = await tx.scheduleLesson.create({
        data: {
          schedulePeriodId: dto.schedulePeriodId,
          date: parseDate(dto.date),
          weekday: isoWeekday(dto.date),
          lessonNumber: dto.lessonNumber,
          startTime: time.startTime,
          endTime: time.endTime,
          studentGroupId: dto.studentGroupId,
          subgroupNumber: dto.subgroupNumber ?? null,
          semesterCurriculumItemId: dto.semesterCurriculumItemId,
          assignmentId: assignment?.id ?? null,
          teacherId: dto.teacherId ?? null,
          classroomId: dto.classroomId ?? null,
          lessonType: dto.lessonType,
          academicHours,
          topic: dto.topic,
          notes: dto.notes,
          allowHoursExcess: dto.allowHoursExcess ?? false,
          streamKey: dto.streamKey ?? null,
          isLocked: dto.isLocked ?? false,
          isManual: true,
          originalLessonId: makeupTask?.sourceLessonId ?? null,
        },
        include: LESSON_INCLUDE,
      });
      if (makeupTask) {
        await tx.makeupTask.update({
          where: { id: makeupTask.id },
          data: { status: MakeupTaskStatus.SCHEDULED, resolvedLessonId: created.id },
        });
      }
      return created;
    });
    await this.audit.log(actor.id, 'CREATE', 'ScheduleLesson', lesson.id, null, presentLesson(lesson));
    if (period.status === SchedulePeriodStatus.PUBLISHED) {
      await this.notifications.notify({
        type: NotificationType.LESSON_CREATED,
        title: makeupTask ? 'Назначена отработка' : 'Добавлено занятие',
        message: `${this.describe(lesson)} (${LESSON_TYPE_LABELS[lesson.lessonType].toLowerCase()}, ауд. ${lesson.classroom?.code ?? '—'})`,
        groupIds: [lesson.studentGroupId],
        teacherIds: [lesson.teacherId],
        lessonId: lesson.id,
      });
    }
    return { lesson: presentLesson(lesson), issues };
  }

  async update(id: string, dto: UpdateLessonDto, actor: AuthUser) {
    const before = await this.loadForChange(id, actor);
    if (actor.role === UserRole.TEACHER) {
      throw new ForbiddenException(
        'Преподаватель может изменять занятие только через перенос, отмену или замену',
      );
    }
    if (
      [LessonStatus.CANCELLED, LessonStatus.MOVED].includes(before.status as 'CANCELLED' | 'MOVED') &&
      (dto.date || dto.lessonNumber)
    ) {
      throw new ConflictException('Отменённое или перенесённое занятие нельзя переставить');
    }
    const date = dto.date ?? toDateStr(before.date);
    const lessonNumber = dto.lessonNumber ?? before.lessonNumber;
    const issues = await this.ensureNoConflicts(
      {
        organizationId: actor.organizationId,
        lessonId: id,
        schedulePeriodId: before.schedulePeriodId,
        date,
        lessonNumber,
        studentGroupId: before.studentGroupId,
        subgroupNumber: dto.subgroupNumber !== undefined ? dto.subgroupNumber : before.subgroupNumber,
        semesterCurriculumItemId: before.semesterCurriculumItemId,
        lessonType: dto.lessonType ?? before.lessonType,
        teacherId: dto.teacherId !== undefined ? dto.teacherId : before.teacherId,
        classroomId: dto.classroomId !== undefined ? dto.classroomId : before.classroomId,
        academicHours: dto.academicHours ?? before.academicHours,
        streamKey: before.streamKey,
        allowHoursExcess: dto.allowHoursExcess ?? before.allowHoursExcess,
        skipHoursCheck:
          dto.academicHours === undefined && dto.lessonType === undefined && dto.subgroupNumber === undefined,
      },
      actor,
      dto.force,
    );
    const time = await this.times(actor.organizationId, lessonNumber);
    const updated = await this.prisma.scheduleLesson.update({
      where: { id },
      data: {
        date: dto.date ? parseDate(dto.date) : undefined,
        weekday: dto.date ? isoWeekday(dto.date) : undefined,
        lessonNumber: dto.lessonNumber,
        startTime: dto.lessonNumber ? time.startTime : undefined,
        endTime: dto.lessonNumber ? time.endTime : undefined,
        subgroupNumber: dto.subgroupNumber,
        lessonType: dto.lessonType,
        teacherId: dto.teacherId,
        classroomId: dto.classroomId,
        academicHours: dto.academicHours,
        topic: dto.topic,
        notes: dto.notes,
        allowHoursExcess: dto.allowHoursExcess,
        isLocked: dto.isLocked,
        isManual: true,
      },
      include: LESSON_INCLUDE,
    });
    await this.audit.log(
      actor.id,
      'UPDATE',
      'ScheduleLesson',
      id,
      presentLesson(before),
      presentLesson(updated),
    );
    const visibleChange =
      dto.date !== undefined ||
      dto.lessonNumber !== undefined ||
      dto.teacherId !== undefined ||
      dto.classroomId !== undefined;
    if (before.schedulePeriod.status === SchedulePeriodStatus.PUBLISHED && visibleChange) {
      await this.notifications.notify({
        type: NotificationType.LESSON_UPDATED,
        title: 'Изменение в расписании',
        message: `${this.describe(updated)}: ${updated.startTime}–${updated.endTime}, ауд. ${updated.classroom?.code ?? '—'}, ${updated.teacher?.fullName ?? 'преподаватель не назначен'}`,
        groupIds: [updated.studentGroupId],
        teacherIds: [updated.teacherId, before.teacherId],
        lessonId: id,
      });
    }
    return { lesson: presentLesson(updated), issues };
  }

  async remove(id: string, actor: AuthUser) {
    const lesson = await this.loadForChange(id, actor);
    if (actor.role === UserRole.TEACHER)
      throw new ForbiddenException('Преподаватель не может удалять занятия');
    if (lesson.conducted && lesson.conducted.status === ConductedStatus.CONDUCTED) {
      throw new ConflictException(
        'Нельзя удалить проведённое занятие — сначала снимите отметку о проведении',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      // Отмена переноса: исходное занятие возвращается в статус «запланировано»
      if (lesson.originalLessonId) {
        const original = await tx.scheduleLesson.findUnique({ where: { id: lesson.originalLessonId } });
        if (original?.status === LessonStatus.MOVED) {
          await tx.scheduleLesson.update({
            where: { id: original.id },
            data: { status: LessonStatus.PLANNED },
          });
          await tx.conductedLesson.deleteMany({
            where: { scheduleLessonId: original.id, status: ConductedStatus.POSTPONED },
          });
        }
      }
      await tx.makeupTask.updateMany({
        where: { resolvedLessonId: id },
        data: { status: MakeupTaskStatus.OPEN, resolvedLessonId: null },
      });
      await tx.scheduleLesson.delete({ where: { id } });
    });
    await this.audit.log(actor.id, 'DELETE', 'ScheduleLesson', id, presentLesson(lesson), null);
    if (
      lesson.schedulePeriod.status === SchedulePeriodStatus.PUBLISHED &&
      lesson.status === LessonStatus.PLANNED
    ) {
      await this.notifications.notify({
        type: NotificationType.LESSON_CANCELLED,
        title: 'Занятие удалено из расписания',
        message: this.describe(lesson),
        groupIds: [lesson.studentGroupId],
        teacherIds: [lesson.teacherId],
      });
    }
    return { success: true };
  }

  // ---------------------------------------------------------------- перенос

  async move(id: string, dto: MoveLessonDto, actor: AuthUser) {
    const lesson = await this.loadForChange(id, actor);
    if (lesson.status === LessonStatus.CANCELLED || lesson.status === LessonStatus.MOVED) {
      throw new ConflictException('Занятие уже отменено или перенесено');
    }
    if (lesson.conducted?.status === ConductedStatus.CONDUCTED) {
      throw new ConflictException('Проведённое занятие нельзя перенести');
    }
    const settings = await this.settings.getEffective(actor.organizationId);
    const today = todayInTimezone(settings.timezone);
    const mode =
      dto.mode && dto.mode !== 'auto'
        ? dto.mode
        : lesson.schedulePeriod.status === SchedulePeriodStatus.PUBLISHED || toDateStr(lesson.date) < today
          ? 'history'
          : 'inplace';
    const classroomId = dto.classroomId ?? lesson.classroomId;
    const issues = await this.ensureNoConflicts(
      {
        organizationId: actor.organizationId,
        lessonId: id,
        schedulePeriodId: lesson.schedulePeriodId,
        date: dto.date,
        lessonNumber: dto.lessonNumber,
        studentGroupId: lesson.studentGroupId,
        subgroupNumber: lesson.subgroupNumber,
        semesterCurriculumItemId: lesson.semesterCurriculumItemId,
        lessonType: lesson.lessonType,
        teacherId: lesson.teacherId,
        classroomId,
        academicHours: lesson.academicHours,
        streamKey: lesson.streamKey,
        skipHoursCheck: true,
      },
      actor,
      dto.force,
    );
    const time = this.settings.lessonTime(settings, dto.lessonNumber);
    let result: LessonWithRelations;
    if (mode === 'inplace') {
      result = await this.prisma.scheduleLesson.update({
        where: { id },
        data: {
          date: parseDate(dto.date),
          weekday: isoWeekday(dto.date),
          lessonNumber: dto.lessonNumber,
          startTime: time.startTime,
          endTime: time.endTime,
          classroomId,
          isManual: true,
          notes: dto.reason
            ? [lesson.notes, `Перенос: ${dto.reason}`].filter(Boolean).join('\n')
            : lesson.notes,
        },
        include: LESSON_INCLUDE,
      });
    } else {
      result = await this.prisma.$transaction(async (tx) => {
        const created = await tx.scheduleLesson.create({
          data: {
            schedulePeriodId: lesson.schedulePeriodId,
            date: parseDate(dto.date),
            weekday: isoWeekday(dto.date),
            lessonNumber: dto.lessonNumber,
            startTime: time.startTime,
            endTime: time.endTime,
            studentGroupId: lesson.studentGroupId,
            subgroupNumber: lesson.subgroupNumber,
            semesterCurriculumItemId: lesson.semesterCurriculumItemId,
            assignmentId: lesson.assignmentId,
            teacherId: lesson.teacherId,
            classroomId,
            lessonType: lesson.lessonType,
            academicHours: lesson.academicHours,
            streamKey: lesson.streamKey,
            allowHoursExcess: lesson.allowHoursExcess,
            topic: lesson.topic,
            notes: dto.reason
              ? `Перенос с ${formatDateRu(lesson.date)}: ${dto.reason}`
              : `Перенос с ${formatDateRu(lesson.date)}`,
            originalLessonId: lesson.id,
            isManual: true,
            status: lesson.status === LessonStatus.REPLACED ? LessonStatus.REPLACED : LessonStatus.PLANNED,
          },
          include: LESSON_INCLUDE,
        });
        await tx.scheduleLesson.update({ where: { id }, data: { status: LessonStatus.MOVED } });
        await tx.conductedLesson.upsert({
          where: { scheduleLessonId: id },
          create: {
            scheduleLessonId: id,
            status: ConductedStatus.POSTPONED,
            actualHours: 0,
            conductedAt: new Date(),
            replacementLessonId: created.id,
            notes: dto.reason,
            markedByUserId: actor.id,
          },
          update: {
            status: ConductedStatus.POSTPONED,
            actualHours: 0,
            replacementLessonId: created.id,
            notes: dto.reason,
          },
        });
        await tx.makeupTask.updateMany({
          where: { resolvedLessonId: id },
          data: { resolvedLessonId: created.id },
        });
        return created;
      });
    }
    await this.audit.log(actor.id, 'MOVE', 'ScheduleLesson', id, presentLesson(lesson), {
      ...presentLesson(result),
      mode,
    });
    if (lesson.schedulePeriod.status === SchedulePeriodStatus.PUBLISHED) {
      await this.notifications.notify({
        type: NotificationType.LESSON_MOVED,
        title: 'Перенос занятия',
        message: `${lesson.studentGroup.code}: «${lesson.semesterItem.curriculumItem.name}» перенесено с ${formatDateRu(lesson.date)} (${lesson.lessonNumber} пара) на ${formatDateRu(dto.date)} (${dto.lessonNumber} пара, ${time.startTime})${dto.reason ? `. Причина: ${dto.reason}` : ''}`,
        groupIds: [lesson.studentGroupId],
        teacherIds: [lesson.teacherId],
        lessonId: result.id,
      });
    }
    return { lesson: presentLesson(result), mode, issues };
  }

  // ---------------------------------------------------------------- отмена

  async cancel(id: string, dto: CancelLessonDto, actor: AuthUser) {
    const lesson = await this.loadForChange(id, actor);
    if (lesson.status === LessonStatus.CANCELLED) throw new ConflictException('Занятие уже отменено');
    if (lesson.status === LessonStatus.MOVED)
      throw new ConflictException('Занятие перенесено — отмените новое занятие');
    if (lesson.conducted?.status === ConductedStatus.CONDUCTED) {
      throw new ConflictException('Занятие уже отмечено как проведённое');
    }
    const createTask = dto.createMakeupTask !== false;
    const { updated, task } = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.scheduleLesson.update({
        where: { id },
        data: { status: LessonStatus.CANCELLED },
        include: LESSON_INCLUDE,
      });
      await tx.conductedLesson.upsert({
        where: { scheduleLessonId: id },
        create: {
          scheduleLessonId: id,
          status: ConductedStatus.CANCELLED,
          actualHours: 0,
          conductedAt: new Date(),
          cancellationReason: dto.reason,
          notes: dto.notes,
          markedByUserId: actor.id,
        },
        update: {
          status: ConductedStatus.CANCELLED,
          actualHours: 0,
          cancellationReason: dto.reason,
          notes: dto.notes,
        },
      });
      // Если отменяется сама отработка — её задача снова открыта, новая не нужна
      const reopened = await tx.makeupTask.updateMany({
        where: { resolvedLessonId: id },
        data: { status: MakeupTaskStatus.OPEN, resolvedLessonId: null },
      });
      let task = null;
      if (createTask && reopened.count === 0) {
        task =
          (await tx.makeupTask.findFirst({ where: { sourceLessonId: id } })) ??
          (await tx.makeupTask.create({
            data: {
              sourceLessonId: id,
              studentGroupId: lesson.studentGroupId,
              subgroupNumber: lesson.subgroupNumber,
              semesterCurriculumItemId: lesson.semesterCurriculumItemId,
              teacherId: lesson.teacherId,
              lessonType: lesson.lessonType,
              academicHours: lesson.academicHours,
              dueDate: parseDate(addDaysStr(toDateStr(lesson.date), 21)),
              notes: `Отмена: ${CANCELLATION_REASON_LABELS[dto.reason]}${dto.notes ? `. ${dto.notes}` : ''}`,
            },
          }));
      }
      return { updated, task };
    });
    await this.audit.log(actor.id, 'CANCEL', 'ScheduleLesson', id, presentLesson(lesson), {
      reason: dto.reason,
      notes: dto.notes,
    });
    await this.notifications.notify({
      type: NotificationType.LESSON_CANCELLED,
      title: 'Отмена занятия',
      message: `${this.describe(lesson)} отменено. Причина: ${CANCELLATION_REASON_LABELS[dto.reason]}${dto.notes ? ` (${dto.notes})` : ''}`,
      groupIds:
        lesson.schedulePeriod.status === SchedulePeriodStatus.PUBLISHED ? [lesson.studentGroupId] : [],
      teacherIds: [lesson.teacherId],
      lessonId: id,
    });
    const suggestedSlots = task
      ? await this.slots.find({
          organizationId: actor.organizationId,
          studentGroupId: lesson.studentGroupId,
          subgroupNumber: lesson.subgroupNumber,
          semesterCurriculumItemId: lesson.semesterCurriculumItemId,
          lessonType: lesson.lessonType,
          teacherId: lesson.teacherId,
          from: addDaysStr(toDateStr(lesson.date), 1),
          limit: 5,
        })
      : [];
    return { lesson: presentLesson(updated), makeupTask: task, suggestedSlots };
  }

  // ---------------------------------------------------------------- замена преподавателя

  async substitute(id: string, dto: SubstituteDto, actor: AuthUser) {
    const lesson = await this.loadForChange(id, actor);
    if (lesson.status === LessonStatus.CANCELLED || lesson.status === LessonStatus.MOVED) {
      throw new ConflictException('Нельзя назначить замену на отменённое или перенесённое занятие');
    }
    if (lesson.teacherId === dto.substituteTeacherId) {
      throw new BadRequestException('Заменяющий преподаватель совпадает с текущим');
    }
    const substitute = await this.prisma.teacher.findFirst({
      where: { id: dto.substituteTeacherId, organizationId: actor.organizationId },
    });
    if (!substitute) throw new BadRequestException('Заменяющий преподаватель не найден');
    const issues = await this.ensureNoConflicts(
      {
        organizationId: actor.organizationId,
        lessonId: id,
        schedulePeriodId: lesson.schedulePeriodId,
        date: toDateStr(lesson.date),
        lessonNumber: lesson.lessonNumber,
        studentGroupId: lesson.studentGroupId,
        subgroupNumber: lesson.subgroupNumber,
        semesterCurriculumItemId: lesson.semesterCurriculumItemId,
        lessonType: lesson.lessonType,
        teacherId: dto.substituteTeacherId,
        classroomId: lesson.classroomId,
        academicHours: lesson.academicHours,
        streamKey: lesson.streamKey,
        skipHoursCheck: true,
      },
      actor,
      dto.force,
    );
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.teacherSubstitution.create({
        data: {
          scheduleLessonId: id,
          originalTeacherId: lesson.teacherId,
          substituteTeacherId: dto.substituteTeacherId,
          reason: dto.reason,
          approvedByUserId: actor.id,
        },
      });
      return tx.scheduleLesson.update({
        where: { id },
        data: {
          teacherId: dto.substituteTeacherId,
          status: lesson.status === LessonStatus.CONDUCTED ? LessonStatus.CONDUCTED : LessonStatus.REPLACED,
          isManual: true,
        },
        include: LESSON_INCLUDE,
      });
    });
    await this.audit.log(
      actor.id,
      'SUBSTITUTE',
      'ScheduleLesson',
      id,
      presentLesson(lesson),
      presentLesson(updated),
    );
    await this.notifications.notify({
      type: NotificationType.TEACHER_SUBSTITUTED,
      title: 'Замена преподавателя',
      message: `${this.describe(lesson)}: занятие проведёт ${substitute.fullName} вместо ${lesson.teacher?.fullName ?? '—'}${dto.reason ? `. Причина: ${dto.reason}` : ''}`,
      groupIds:
        lesson.schedulePeriod.status === SchedulePeriodStatus.PUBLISHED ? [lesson.studentGroupId] : [],
      teacherIds: [lesson.teacherId, dto.substituteTeacherId],
      lessonId: id,
    });
    return { lesson: presentLesson(updated), issues };
  }

  // ---------------------------------------------------------------- отметка о проведении

  async markConducted(id: string, dto: MarkConductedDto, actor: AuthUser) {
    const lesson = await this.loadForChange(id, actor);
    const status = dto.status ?? ConductedStatus.CONDUCTED;
    if (status === ConductedStatus.CANCELLED) {
      return this.cancel(id, { reason: dto.cancellationReason ?? 'OTHER', notes: dto.notes }, actor);
    }
    if (status === ConductedStatus.POSTPONED) {
      if (!dto.newDate || !dto.newLessonNumber) {
        // Без новой даты — отмена с задачей отработки
        return this.cancel(
          id,
          { reason: dto.cancellationReason ?? 'OTHER', notes: dto.notes ?? 'Перенос без даты' },
          actor,
        );
      }
      return this.move(
        id,
        { date: dto.newDate, lessonNumber: dto.newLessonNumber, reason: dto.notes, mode: 'history' },
        actor,
      );
    }
    if (lesson.status === LessonStatus.MOVED) {
      throw new ConflictException(
        'Занятие перенесено — отметьте проведение нового занятия (двойное списание часов недопустимо)',
      );
    }
    if (lesson.status === LessonStatus.CANCELLED) {
      throw new ConflictException('Занятие отменено — для компенсации поставьте отработку');
    }
    const settings = await this.settings.getEffective(actor.organizationId);
    const today = todayInTimezone(settings.timezone);
    if (toDateStr(lesson.date) > today) {
      throw new BadRequestException('Нельзя отметить проведение занятия, дата которого ещё не наступила');
    }

    if (status === ConductedStatus.REPLACED) {
      const record = await this.prisma.$transaction(async (tx) => {
        await tx.scheduleLesson.update({ where: { id }, data: { status: LessonStatus.CANCELLED } });
        const r = await tx.conductedLesson.upsert({
          where: { scheduleLessonId: id },
          create: {
            scheduleLessonId: id,
            status: ConductedStatus.REPLACED,
            actualHours: 0,
            conductedAt: new Date(),
            replacementLessonId: dto.replacementLessonId,
            notes: dto.notes,
            markedByUserId: actor.id,
          },
          update: {
            status: ConductedStatus.REPLACED,
            actualHours: 0,
            replacementLessonId: dto.replacementLessonId,
            notes: dto.notes,
          },
        });
        await tx.makeupTask.create({
          data: {
            sourceLessonId: id,
            studentGroupId: lesson.studentGroupId,
            subgroupNumber: lesson.subgroupNumber,
            semesterCurriculumItemId: lesson.semesterCurriculumItemId,
            teacherId: lesson.teacherId,
            lessonType: lesson.lessonType,
            academicHours: lesson.academicHours,
            notes: 'Занятие заменено другим — требуется отработка',
          },
        });
        return r;
      });
      await this.audit.log(actor.id, 'MARK_REPLACED', 'ScheduleLesson', id, null, record);
      return { lesson: presentLesson(await this.get(id, actor)), conducted: record };
    }

    // CONDUCTED — проведено (полностью или частично)
    const actualHours = dto.actualHours ?? lesson.academicHours;
    if (actualHours > lesson.academicHours) {
      throw new BadRequestException(
        `Фактические часы (${actualHours}) не могут превышать продолжительность занятия (${lesson.academicHours})`,
      );
    }
    if (actualHours <= 0) {
      throw new BadRequestException('Для непроведённого занятия используйте статус «Отменено»');
    }
    const actualTeacherId = dto.actualTeacherId ?? lesson.teacherId;
    if (
      actor.role === UserRole.TEACHER &&
      actualTeacherId !== actor.teacherId &&
      lesson.teacherId !== actor.teacherId
    ) {
      throw new ForbiddenException('Преподаватель может отметить только собственное занятие');
    }
    const replaced = !!actualTeacherId && !!lesson.teacherId && actualTeacherId !== lesson.teacherId;
    const record = await this.prisma.$transaction(async (tx) => {
      if (replaced) {
        const exists = await tx.teacherSubstitution.findFirst({
          where: { scheduleLessonId: id, substituteTeacherId: actualTeacherId! },
        });
        if (!exists) {
          await tx.teacherSubstitution.create({
            data: {
              scheduleLessonId: id,
              originalTeacherId: lesson.teacherId,
              substituteTeacherId: actualTeacherId!,
              reason: dto.notes ?? 'Проведено заменяющим преподавателем',
              approvedByUserId: actor.id,
            },
          });
        }
      }
      await tx.scheduleLesson.update({
        where: { id },
        data: {
          status:
            replaced || lesson.status === LessonStatus.REPLACED
              ? LessonStatus.REPLACED
              : LessonStatus.CONDUCTED,
          topic: dto.topic ?? lesson.topic,
        },
      });
      const r = await tx.conductedLesson.upsert({
        where: { scheduleLessonId: id },
        create: {
          scheduleLessonId: id,
          status: ConductedStatus.CONDUCTED,
          actualHours,
          actualTeacherId,
          actualClassroomId: dto.actualClassroomId ?? lesson.classroomId,
          conductedAt: new Date(),
          notes: dto.notes,
          markedByUserId: actor.id,
        },
        update: {
          status: ConductedStatus.CONDUCTED,
          actualHours,
          actualTeacherId,
          actualClassroomId: dto.actualClassroomId ?? lesson.classroomId,
          cancellationReason: null,
          notes: dto.notes,
          markedByUserId: actor.id,
        },
      });
      // Проведённая отработка закрывает задачу
      await tx.makeupTask.updateMany({
        where: { resolvedLessonId: id },
        data: { status: MakeupTaskStatus.DONE },
      });
      return r;
    });
    await this.audit.log(actor.id, 'MARK_CONDUCTED', 'ScheduleLesson', id, lesson.conducted, record);
    return { lesson: presentLesson(await this.get(id, actor)), conducted: record };
  }

  /** Снятие отметки о проведении (исправление ошибки) */
  async unmark(id: string, actor: AuthUser) {
    const lesson = await this.loadForChange(id, actor);
    if (!lesson.conducted) throw new BadRequestException('У занятия нет отметки о проведении');
    if (lesson.status === LessonStatus.MOVED) {
      throw new ConflictException('Для перенесённого занятия удалите новое занятие, чтобы отменить перенос');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.conductedLesson.delete({ where: { scheduleLessonId: id } });
      await tx.scheduleLesson.update({
        where: { id },
        data: { status: lesson.substitutions.length > 0 ? LessonStatus.REPLACED : LessonStatus.PLANNED },
      });
      if (
        lesson.conducted?.status === ConductedStatus.CANCELLED ||
        lesson.conducted?.status === ConductedStatus.REPLACED
      ) {
        await tx.makeupTask.deleteMany({ where: { sourceLessonId: id, status: MakeupTaskStatus.OPEN } });
      }
      await tx.makeupTask.updateMany({
        where: { resolvedLessonId: id, status: MakeupTaskStatus.DONE },
        data: { status: MakeupTaskStatus.SCHEDULED },
      });
    });
    await this.audit.log(actor.id, 'UNMARK', 'ScheduleLesson', id, lesson.conducted, null);
    return { lesson: presentLesson(await this.get(id, actor)) };
  }

  // ---------------------------------------------------------------- копирование и массовые операции

  async copy(id: string, dto: CopyLessonDto, actor: AuthUser) {
    const lesson = await this.loadForChange(id, actor);
    if (actor.role === UserRole.TEACHER)
      throw new ForbiddenException('Преподаватель не может создавать занятия');
    return this.create(
      {
        schedulePeriodId: lesson.schedulePeriodId,
        date: dto.date,
        lessonNumber: dto.lessonNumber,
        studentGroupId: lesson.studentGroupId,
        subgroupNumber: lesson.subgroupNumber,
        semesterCurriculumItemId: lesson.semesterCurriculumItemId,
        lessonType: lesson.lessonType,
        teacherId: lesson.teacherId,
        classroomId: dto.classroomId ?? lesson.classroomId,
        academicHours: lesson.academicHours,
        topic: lesson.topic ?? undefined,
        streamKey: lesson.streamKey ?? undefined,
        force: dto.force,
      },
      actor,
    );
  }

  async bulk(dto: BulkLessonsDto, actor: AuthUser) {
    if (!EDITOR.includes(actor.role))
      throw new ForbiddenException('Массовое редактирование доступно диспетчеру');
    const results: Array<{ id: string; ok: boolean; message?: string }> = [];
    for (const id of dto.ids) {
      try {
        switch (dto.action) {
          case 'delete':
            await this.remove(id, actor);
            break;
          case 'lock':
          case 'unlock':
            await this.loadForChange(id, actor);
            await this.prisma.scheduleLesson.update({
              where: { id },
              data: { isLocked: dto.action === 'lock' },
            });
            break;
          case 'cancel':
            await this.cancel(id, { reason: dto.reason ?? 'OTHER', createMakeupTask: true }, actor);
            break;
          case 'update': {
            const p = dto.patch ?? {};
            const current = await this.loadForChange(id, actor);
            await this.update(
              id,
              {
                teacherId: p.teacherId,
                classroomId: p.classroomId,
                lessonNumber: p.lessonNumber,
                topic: p.topic,
                date: p.shiftDays ? addDaysStr(toDateStr(current.date), p.shiftDays) : undefined,
                force: dto.force,
              },
              actor,
            );
            break;
          }
        }
        results.push({ id, ok: true });
      } catch (e) {
        results.push({ id, ok: false, message: (e as Error).message });
      }
    }
    return {
      processed: results.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok),
    };
  }

  // ---------------------------------------------------------------- свободные слоты и история

  async freeSlots(id: string, actor: AuthUser, params: { from?: string; to?: string; limit?: number }) {
    const lesson = await this.get(id, actor);
    return this.slots.find({
      organizationId: actor.organizationId,
      studentGroupId: lesson.studentGroupId,
      subgroupNumber: lesson.subgroupNumber,
      semesterCurriculumItemId: lesson.semesterCurriculumItemId,
      lessonType: lesson.lessonType,
      teacherId: lesson.teacherId,
      from: params.from,
      to: params.to,
      excludeLessonIds: [id],
      limit: params.limit ?? 10,
    });
  }

  async history(id: string, actor: AuthUser) {
    const lesson = await this.get(id, actor);
    // Цепочка переносов: назад к исходному и вперёд к новым занятиям
    const chain: LessonWithRelations[] = [lesson];
    let cursor: string | null = lesson.originalLessonId;
    let guard = 0;
    while (cursor && guard++ < 20) {
      const prev: LessonWithRelations | null = await this.prisma.scheduleLesson.findUnique({
        where: { id: cursor },
        include: LESSON_INCLUDE,
      });
      if (!prev) break;
      chain.unshift(prev);
      cursor = prev.originalLessonId;
    }
    let next = lesson.derivedLessons.map((d) => d.id);
    guard = 0;
    while (next.length && guard++ < 20) {
      const found = await this.prisma.scheduleLesson.findMany({
        where: { id: { in: next } },
        include: LESSON_INCLUDE,
      });
      chain.push(...found);
      next = found.flatMap((f) => f.derivedLessons.map((d) => d.id));
    }
    const ids = chain.map((c) => c.id);
    const [substitutions, makeupTasks, audit] = await Promise.all([
      this.prisma.teacherSubstitution.findMany({
        where: { scheduleLessonId: { in: ids } },
        include: {
          originalTeacher: { select: { fullName: true } },
          substituteTeacher: { select: { fullName: true } },
          approvedBy: { select: { fullName: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.makeupTask.findMany({
        where: { OR: [{ sourceLessonId: { in: ids } }, { resolvedLessonId: { in: ids } }] },
      }),
      this.prisma.auditLog.findMany({
        where: { entityType: 'ScheduleLesson', entityId: { in: ids } },
        include: { user: { select: { fullName: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      lesson: presentLesson(lesson),
      chain: chain.map(presentLesson),
      substitutions,
      makeupTasks,
      audit: audit.map((a) => ({
        id: a.id,
        action: a.action,
        user: a.user?.fullName ?? null,
        createdAt: a.createdAt,
        entityId: a.entityId,
      })),
    };
  }
}
