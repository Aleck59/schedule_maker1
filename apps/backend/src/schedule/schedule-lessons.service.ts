import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ConductedStatus,
  ControlForm,
  LessonStatus,
  LessonType,
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
import {
  LessonCandidate,
  LessonCheckerService,
  ROOM_ISSUE_TYPES,
} from '../validation/lesson-checker.service';
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

/**
 * Занятие для списков (сетка недели, расписание группы): без служебных полей, которые интерфейс
 * не показывает. Неделя всех групп — тысячи занятий, каждое лишнее поле умножается на них
 */
export function presentListLesson(l: LessonWithRelations) {
  const { createdAt: _c, updatedAt: _u, generationJobId: _g, ...rest } = presentLesson(l);
  return rest;
}

export const LESSON_INCLUDE = {
  studentGroup: { select: { id: true, code: true, studentCount: true } },
  semesterItem: {
    select: {
      id: true,
      semesterId: true,
      curriculumItem: {
        select: {
          id: true,
          code: true,
          name: true,
          itemType: true,
          isDifficult: true,
          educationalProgramId: true,
        },
      },
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

/** Связи занятия, которые читаются вместе с ним; справочные (группа, дисциплина…) — отдельно */
const LESSON_OWN_INCLUDE = {
  conducted: LESSON_INCLUDE.conducted,
  originalLesson: LESSON_INCLUDE.originalLesson,
  derivedLessons: LESSON_INCLUDE.derivedLessons,
  substitutions: LESSON_INCLUDE.substitutions,
} satisfies Prisma.ScheduleLessonInclude;

/** Неделя всех групп — около 7 тыс. пар на большой базе; больше 20 тыс. за раз не отдаём */
const LESSON_LIST_LIMIT = 20_000;

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

/** Экзамен или зачёт в сетке расписания: занятие только для чтения с пометкой assessment */
export interface AssessmentLesson {
  id: string;
  schedulePeriodId: string | null;
  date: string;
  weekday: number;
  lessonNumber: number;
  startTime: string;
  endTime: string;
  studentGroupId: string;
  subgroupNumber: null;
  semesterCurriculumItemId: string;
  teacherId: string | null;
  classroomId: string | null;
  lessonType: LessonType;
  status: LessonStatus;
  academicHours: number;
  originalLessonId: null;
  streamKey: null;
  isManual: boolean;
  isLocked: boolean;
  allowHoursExcess: boolean;
  topic: null;
  notes: string | null;
  studentGroup: { id: string; code: string; studentCount: number };
  semesterItem: ReturnType<typeof presentListLesson>['semesterItem'];
  teacher: { id: string; fullName: string } | null;
  classroom: ReturnType<typeof presentListLesson>['classroom'];
  conducted: null;
  originalLesson: null;
  derivedLessons: never[];
  substitution: null;
  assessment: { id: string; controlForm: ControlForm };
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
    const lessons = await this.findWithRelations({
      where,
      orderBy: [
        { date: 'asc' },
        { lessonNumber: 'asc' },
        { studentGroup: { code: 'asc' } },
        { subgroupNumber: 'asc' },
      ],
      take: LESSON_LIST_LIMIT,
    });
    const list: Array<ReturnType<typeof presentListLesson> | AssessmentLesson> = lessons.map(presentListLesson);
    if (query.withAssessments === 'true' && (!statuses?.length || statuses.includes(LessonStatus.PLANNED))) {
      const assessments = await this.assessmentLessons(query, actor);
      if (assessments.length) {
        list.push(...assessments);
        list.sort(
          (a, b) =>
            a.date.localeCompare(b.date) ||
            a.lessonNumber - b.lessonNumber ||
            a.studentGroup.code.localeCompare(b.studentGroup.code),
        );
      }
    }
    return list;
  }

  /**
   * Экзамены и зачёты, назначенные на пару, в виде занятий только для чтения: в сетке расписания
   * они видны вместе с обычными парами. В часы и нагрузку не входят, правятся в редакторе экзаменов.
   */
  private async assessmentLessons(query: LessonQueryDto, actor: AuthUser): Promise<AssessmentLesson[]> {
    let semesterId: string | undefined;
    let periodFrom: string | undefined;
    let periodTo: string | undefined;
    if (query.periodId) {
      const period = await this.prisma.schedulePeriod.findFirst({
        where: { id: query.periodId, organizationId: actor.organizationId },
        select: { semesterId: true, startDate: true, endDate: true },
      });
      if (!period) return [];
      semesterId = period.semesterId;
      periodFrom = toDateStr(period.startDate);
      periodTo = toDateStr(period.endDate);
    }
    const from = [query.from, periodFrom].filter(Boolean).sort().at(-1);
    const to = [query.to, periodTo].filter(Boolean).sort()[0];
    let groupId = query.groupId || undefined;
    if (actor.role === UserRole.STUDENT) {
      if (!actor.studentGroupId || (groupId && groupId !== actor.studentGroupId)) return [];
      groupId = actor.studentGroupId;
    }
    const events = await this.prisma.assessmentEvent.findMany({
      where: {
        group: { program: { organizationId: actor.organizationId } },
        studentGroupId: groupId,
        teacherId: query.teacherId || undefined,
        classroomId: query.classroomId || undefined,
        semesterCurriculumItemId: query.semesterItemId || undefined,
        semesterItem: semesterId ? { semesterId } : undefined,
        lessonNumber: { not: null },
        date: { gte: from ? parseDate(from) : undefined, lte: to ? parseDate(to) : undefined },
      },
      include: {
        group: { select: LESSON_INCLUDE.studentGroup.select },
        semesterItem: { select: LESSON_INCLUDE.semesterItem.select },
        teacher: { select: LESSON_INCLUDE.teacher.select },
        classroom: { select: LESSON_INCLUDE.classroom.select },
      },
      orderBy: [{ date: 'asc' }, { lessonNumber: 'asc' }],
      take: 5000,
    });
    if (events.length === 0) return [];
    const settings = await this.settings.getEffective(actor.organizationId);
    return events.map((e) => {
      const date = toDateStr(e.date);
      const time = this.settings.lessonTime(settings, e.lessonNumber!);
      return {
        id: `assessment-${e.id}`,
        schedulePeriodId: query.periodId ?? null,
        date,
        weekday: isoWeekday(date),
        lessonNumber: e.lessonNumber!,
        startTime: time.startTime,
        endTime: time.endTime,
        studentGroupId: e.studentGroupId,
        subgroupNumber: null,
        semesterCurriculumItemId: e.semesterCurriculumItemId,
        teacherId: e.teacherId,
        classroomId: e.classroomId,
        lessonType: LessonType.OTHER,
        status: LessonStatus.PLANNED,
        academicHours: 0,
        originalLessonId: null,
        streamKey: null,
        isManual: true,
        isLocked: true,
        allowHoursExcess: false,
        topic: null,
        notes: e.notes,
        studentGroup: e.group,
        semesterItem: e.semesterItem,
        teacher: e.teacher,
        classroom: e.classroom,
        conducted: null,
        originalLesson: null,
        derivedLessons: [],
        substitution: null,
        assessment: { id: e.id, controlForm: e.controlForm },
      };
    });
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
    const lessons = await this.findWithRelations({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      take: 300,
    });
    return lessons.map(presentLesson);
  }

  /**
   * То же, что findMany с LESSON_INCLUDE, но группы, дисциплины, преподаватели, аудитории и периоды
   * читаются отдельными запросами по уникальным id. На тысячах занятий это в разы меньше строк:
   * у недели всех групп всего ~600 групп и ~200 аудиторий, а не 7 тыс. копий каждой
   */
  async findWithRelations(
    args: Pick<Prisma.ScheduleLessonFindManyArgs, 'where' | 'orderBy' | 'take'>,
  ): Promise<LessonWithRelations[]> {
    const lessons = await this.prisma.scheduleLesson.findMany({ ...args, include: LESSON_OWN_INCLUDE });
    if (lessons.length === 0) return [];
    const ids = <K extends keyof (typeof lessons)[number]>(key: K) =>
      [
        ...new Set(lessons.map((l) => l[key]).filter((v): v is NonNullable<typeof v> => v != null)),
      ] as string[];
    const [groups, items, teachers, classrooms, periods] = await Promise.all([
      this.prisma.studentGroup.findMany({
        where: { id: { in: ids('studentGroupId') } },
        select: LESSON_INCLUDE.studentGroup.select,
      }),
      this.prisma.semesterCurriculumItem.findMany({
        where: { id: { in: ids('semesterCurriculumItemId') } },
        select: LESSON_INCLUDE.semesterItem.select,
      }),
      this.prisma.teacher.findMany({
        where: { id: { in: ids('teacherId') } },
        select: LESSON_INCLUDE.teacher.select,
      }),
      this.prisma.classroom.findMany({
        where: { id: { in: ids('classroomId') } },
        select: LESSON_INCLUDE.classroom.select,
      }),
      this.prisma.schedulePeriod.findMany({
        where: { id: { in: ids('schedulePeriodId') } },
        select: LESSON_INCLUDE.schedulePeriod.select,
      }),
    ]);
    const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));
    const g = byId(groups);
    const i = byId(items);
    const t = byId(teachers);
    const c = byId(classrooms);
    const p = byId(periods);
    return lessons.map((l) => ({
      ...l,
      studentGroup: g.get(l.studentGroupId)!,
      semesterItem: i.get(l.semesterCurriculumItemId)!,
      teacher: l.teacherId ? (t.get(l.teacherId) ?? null) : null,
      classroom: l.classroomId ? (c.get(l.classroomId) ?? null) : null,
      schedulePeriod: p.get(l.schedulePeriodId)!,
    }));
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

  /** Перенос занятия; пары потока (общие у нескольких групп) переносятся вместе */
  async move(id: string, dto: MoveLessonDto, actor: AuthUser) {
    const lesson = await this.loadForChange(id, actor);
    const siblings = lesson.streamKey
      ? await this.prisma.scheduleLesson.findMany({
          where: {
            id: { not: id },
            streamKey: lesson.streamKey,
            date: lesson.date,
            lessonNumber: lesson.lessonNumber,
            teacherId: lesson.teacherId,
            status: { in: [LessonStatus.PLANNED, LessonStatus.REPLACED] },
            schedulePeriod: { organizationId: actor.organizationId },
          },
          include: { ...LESSON_INCLUDE, schedulePeriod: true },
        })
      : [];
    // Исходная аудитория занята/мала/недоступна в новом слоте — подбираем свободную
    const auto = dto.classroomId ? null : await this.pickMoveRoom(lesson, dto, siblings, actor);
    if (auto?.room) dto = { ...dto, classroomId: auto.room.id };
    const withAuto = <T extends { issues: ValidationIssue[] }>(r: T) =>
      auto?.room
        ? {
            ...r,
            issues: [auto.warning!, ...r.issues],
            roomChanged: { from: auto.fromCode, to: auto.room.code },
          }
        : r;
    if (siblings.length === 0) return withAuto(await this.moveOne(id, dto, actor));
    // Сначала проверяем все группы потока, чтобы не разорвать поток на полпути
    const issues: ValidationIssue[] = [];
    for (const s of siblings) {
      const found = await this.checker.check({
        organizationId: actor.organizationId,
        lessonId: s.id,
        schedulePeriodId: s.schedulePeriodId,
        date: dto.date,
        lessonNumber: dto.lessonNumber,
        studentGroupId: s.studentGroupId,
        subgroupNumber: s.subgroupNumber,
        semesterCurriculumItemId: s.semesterCurriculumItemId,
        lessonType: s.lessonType,
        teacherId: s.teacherId,
        classroomId: dto.classroomId ?? s.classroomId,
        academicHours: s.academicHours,
        streamKey: s.streamKey,
        skipHoursCheck: true,
      });
      // Занятость преподавателя и аудитории общая для потока — её покажет проверка основной пары
      issues.push(
        ...found.filter((i) => i.severity === Severity.ERROR && !issues.some((x) => x.message === i.message)),
      );
    }
    if (issues.length > 0 && !this.canForce(actor, dto.force)) {
      throw new ConflictException({
        message: `Обнаружены конфликты: ${issues[0].message}`,
        errors: issues.map((e) => e.message),
        details: { issues },
      });
    }
    const main = await this.moveOne(id, dto, actor);
    for (const s of siblings) await this.moveOne(s.id, { ...dto, force: true }, actor);
    return withAuto({ ...main, movedTogether: siblings.map((s) => s.studentGroup.code) });
  }

  /**
   * Мягкая проверка аудитории при переносе: если прежняя аудитория в новом слоте занята,
   * мала или недоступна, ставим занятие в свободную подходящую. Если свободных нет —
   * ошибка (её можно обойти только принудительным переносом).
   */
  private async pickMoveRoom(
    lesson: Awaited<ReturnType<ScheduleLessonsService['loadForChange']>>,
    dto: MoveLessonDto,
    siblings: Array<{ id: string; studentGroupId: string }>,
    actor: AuthUser,
  ) {
    const candidate: LessonCandidate = {
      organizationId: actor.organizationId,
      lessonId: lesson.id,
      excludeIds: siblings.map((s) => s.id),
      schedulePeriodId: lesson.schedulePeriodId,
      date: dto.date,
      lessonNumber: dto.lessonNumber,
      studentGroupId: lesson.studentGroupId,
      subgroupNumber: lesson.subgroupNumber,
      semesterCurriculumItemId: lesson.semesterCurriculumItemId,
      lessonType: lesson.lessonType,
      teacherId: lesson.teacherId,
      classroomId: lesson.classroomId,
      academicHours: lesson.academicHours,
      streamKey: lesson.streamKey,
      skipHoursCheck: true,
    };
    const issues = await this.checker.check(candidate);
    const roomErrors = issues.filter(
      (i) => i.severity === Severity.ERROR && ROOM_ISSUE_TYPES.has(i.validationType),
    );
    if (roomErrors.length === 0) return null;
    const room = await this.checker.findFreeRoom(
      candidate,
      siblings.map((s) => s.studentGroupId),
    );
    const fromCode = lesson.classroom?.code ?? null;
    if (!room) {
      if (this.canForce(actor, dto.force)) return null;
      const errors = [
        ...issues.filter((i) => i.severity === Severity.ERROR),
        {
          severity: Severity.ERROR,
          validationType: 'NO_FREE_CLASSROOM',
          entityType: 'ScheduleLesson',
          entityId: null,
          message: 'Свободных подходящих аудиторий в это время нет',
        } satisfies ValidationIssue,
      ];
      throw new ConflictException({
        message: `Обнаружены конфликты: ${roomErrors[0].message}. Свободных подходящих аудиторий в это время нет`,
        errors: errors.map((e) => e.message),
        details: { issues: [...errors, ...issues.filter((i) => i.severity !== Severity.ERROR)] },
      });
    }
    const why =
      roomErrors[0].validationType === 'CAPACITY_EXCEEDED'
        ? 'мала для группы'
        : roomErrors[0].validationType === 'CLASSROOM_UNAVAILABLE'
          ? 'недоступна'
          : roomErrors[0].validationType === 'NO_CLASSROOM'
            ? null
            : 'занята';
    const message =
      fromCode && why
        ? `Аудитория ${fromCode} в это время ${why} — занятие поставлено в свободную аудиторию ${room.code}`
        : `Занятие поставлено в свободную аудиторию ${room.code}`;
    const warning: ValidationIssue = {
      severity: Severity.WARNING,
      validationType: 'CLASSROOM_REPLACED',
      entityType: 'ScheduleLesson',
      entityId: lesson.id,
      message,
      details: { from: fromCode, to: room.code, classroomId: room.id },
    };
    return { room, warning, fromCode };
  }

  private async moveOne(id: string, dto: MoveLessonDto, actor: AuthUser) {
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
