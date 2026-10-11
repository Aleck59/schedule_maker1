import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  GenerationJobStatus,
  GenerationMode,
  LessonStatus,
  NotificationType,
  Prisma,
  SchedulePeriodStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { diffDays, formatDateRu, parseDate, toDateStr } from '../common/utils/dates';
import { JOB_STATUS_LABELS } from '../common/utils/labels';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleValidatorService } from '../validation/schedule-validator.service';
import { GenerateAllDto, GenerateScheduleDto } from './dto/generation.dto';
import { GenerationQueueService } from './generation-queue.service';
import { GenerationParams, GenerationResultJson, PreviewLesson } from './generation.types';
import { ACTIVE_LESSON_STATUSES } from './problem-builder.service';

const FINISHED: GenerationJobStatus[] = [
  GenerationJobStatus.COMPLETED,
  GenerationJobStatus.COMPLETED_WITH_CONFLICTS,
];

@Injectable()
export class GenerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: GenerationQueueService,
    private readonly validator: ScheduleValidatorService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async create(periodId: string, dto: GenerateScheduleDto, actor: AuthUser) {
    const period = await this.prisma.schedulePeriod.findFirst({
      where: { id: periodId, organizationId: actor.organizationId },
      include: { semester: true },
    });
    if (!period) throw new NotFoundException('Период расписания не найден');
    if (period.status === SchedulePeriodStatus.ARCHIVED) {
      throw new ConflictException('Период находится в архиве — генерация невозможна');
    }
    if (dto.dateFrom && dto.dateTo && dto.dateFrom > dto.dateTo) {
      throw new BadRequestException('Дата окончания генерации раньше даты начала');
    }
    if (dto.groupIds?.length) {
      const count = await this.prisma.studentGroup.count({
        where: { id: { in: dto.groupIds }, educationalProgramId: period.semester.educationalProgramId },
      });
      if (count !== dto.groupIds.length) {
        throw new BadRequestException('Некоторые группы не относятся к учебному плану семестра');
      }
    }
    await this.ensureNotRunning([periodId]);
    const params: GenerationParams = { ...dto, mode: dto.mode ?? 'CALENDAR' };
    const job = await this.prisma.scheduleGenerationJob.create({
      data: {
        schedulePeriodId: periodId,
        createdByUserId: actor.id,
        mode: params.mode === 'WEEKLY_TEMPLATE' ? GenerationMode.WEEKLY_TEMPLATE : GenerationMode.CALENDAR,
        paramsJson: params as unknown as Prisma.InputJsonValue,
        status: GenerationJobStatus.QUEUED,
        message: 'Ожидание: задание поставлено в очередь',
      },
    });
    await this.queue.enqueue(job.id);
    await this.audit.log(actor.id, 'GENERATE', 'SchedulePeriod', periodId, null, { jobId: job.id, params });
    return this.present(job, false);
  }

  /** Для периодов не должно выполняться других генераций (в том числе совместных) */
  private async ensureNotRunning(periodIds: string[]) {
    const running = await this.prisma.scheduleGenerationJob.findFirst({
      where: {
        OR: [{ schedulePeriodId: { in: periodIds } }, { periodIds: { hasSome: periodIds } }],
        status: {
          in: [GenerationJobStatus.QUEUED, GenerationJobStatus.GENERATING, GenerationJobStatus.VALIDATING],
        },
      },
      include: { schedulePeriod: { select: { title: true } } },
    });
    if (running) {
      throw new ConflictException(
        `Уже выполняется генерация («${running.schedulePeriod.title}»${running.periodIds.length > 1 ? ' и другие периоды' : ''}) — дождитесь её завершения`,
      );
    }
  }

  /**
   * План составления расписания для всех групп: текущий семестр каждой активной группы на дату
   * и период расписания, в который попадут занятия (существующий или будет создан).
   */
  async planAll(actor: AuthUser, dto: Pick<GenerateAllDto, 'date' | 'educationLevels' | 'programIds'> = {}) {
    const date = dto.date ?? toDateStr(new Date());
    const groups = await this.prisma.studentGroup.findMany({
      where: {
        isActive: true,
        program: {
          organizationId: actor.organizationId,
          id: dto.programIds?.length ? { in: dto.programIds } : undefined,
          specialty: dto.educationLevels?.length
            ? { educationLevel: { in: dto.educationLevels } }
            : undefined,
        },
      },
      include: {
        program: {
          include: {
            specialty: { select: { code: true, name: true, educationLevel: true } },
            semesters: { orderBy: { number: 'asc' }, include: { academicYear: { select: { title: true } } } },
          },
        },
      },
      orderBy: { code: 'asc' },
    });
    const semesterIds = groups.flatMap((g) => g.program.semesters.map((s) => s.id));
    const periods = await this.prisma.schedulePeriod.findMany({
      where: {
        organizationId: actor.organizationId,
        semesterId: { in: semesterIds },
        status: { not: SchedulePeriodStatus.ARCHIVED },
      },
      orderBy: { createdAt: 'desc' },
    });
    const rows = groups.map((g) => {
      const semesters = g.program.semesters;
      const current = semesters.find((s) => toDateStr(s.startDate) <= date && date <= toDateStr(s.endDate));
      // На каникулах перед семестром — ближайший семестр, если он начинается в течение 45 дней
      const upcoming = semesters.find(
        (s) => toDateStr(s.startDate) > date && diffDays(toDateStr(s.startDate), date) <= 45,
      );
      const semester = current ?? upcoming ?? null;
      const period = semester ? (periods.find((p) => p.semesterId === semester.id) ?? null) : null;
      const base = {
        groupId: g.id,
        groupCode: g.code,
        programId: g.educationalProgramId,
        programTitle: g.program.title,
        specialty: `${g.program.specialty.code} ${g.program.specialty.name}`,
        educationLevel: g.program.specialty.educationLevel,
        studyForm: g.program.studyForm,
      };
      if (!semester) {
        const finished = semesters.length > 0 && toDateStr(semesters[semesters.length - 1].endDate) < date;
        return {
          ...base,
          included: false,
          semesterId: null,
          semesterNumber: null,
          periodId: null,
          periodTitle: null,
          createPeriod: false,
          reason: finished
            ? 'Обучение по учебному плану завершено'
            : semesters.length === 0
              ? 'В учебном плане нет семестров'
              : `На ${formatDateRu(date)} у группы нет семестра (каникулы или практика между семестрами)`,
        };
      }
      return {
        ...base,
        included: true,
        semesterId: semester.id,
        semesterNumber: semester.number,
        semesterStart: toDateStr(semester.startDate),
        semesterEnd: toDateStr(semester.endDate),
        periodId: period?.id ?? null,
        periodTitle:
          period?.title ?? `${g.program.title}: ${semester.number} семестр (${semester.academicYear.title})`,
        createPeriod: !period,
        reason:
          semester.number !== g.currentSemesterNumber
            ? `В карточке группы указан ${g.currentSemesterNumber} семестр, по датам учебного плана — ${semester.number}`
            : null,
      };
    });
    const included = rows.filter((r) => r.included);
    return {
      date,
      groups: rows,
      summary: {
        groups: rows.length,
        included: included.length,
        skipped: rows.length - included.length,
        periods: new Set(included.map((r) => r.semesterId)).size,
        newPeriods: new Set(included.filter((r) => r.createPeriod).map((r) => r.semesterId)).size,
      },
    };
  }

  /** Совместная генерация расписания всех групп (одно задание: общие преподаватели и аудитории) */
  async createForAll(dto: GenerateAllDto, actor: AuthUser) {
    const plan = await this.planAll(actor, dto);
    const included = plan.groups.filter((g) => g.included && g.semesterId);
    if (included.length === 0) {
      throw new BadRequestException(
        `На ${formatDateRu(plan.date)} нет активных групп с текущим семестром — проверьте даты семестров учебных планов`,
      );
    }
    if (dto.dateFrom && dto.dateTo && dto.dateFrom > dto.dateTo) {
      throw new BadRequestException('Дата окончания генерации раньше даты начала');
    }
    // Периоды расписания: существующие или новые на даты семестров
    const periodBySemester = new Map<string, string>();
    const created: string[] = [];
    for (const g of included) {
      const semesterId = g.semesterId!;
      if (periodBySemester.has(semesterId)) continue;
      if (g.periodId) {
        periodBySemester.set(semesterId, g.periodId);
        continue;
      }
      const semester = await this.prisma.semester.findUniqueOrThrow({ where: { id: semesterId } });
      const period = await this.prisma.schedulePeriod.create({
        data: {
          organizationId: actor.organizationId,
          academicYearId: semester.academicYearId,
          semesterId,
          title: g.periodTitle!,
          startDate: semester.startDate,
          endDate: semester.endDate,
          status: SchedulePeriodStatus.DRAFT,
          notes: 'Создан при составлении расписания для всех групп',
        },
      });
      periodBySemester.set(semesterId, period.id);
      created.push(period.id);
      await this.audit.log(actor.id, 'CREATE', 'SchedulePeriod', period.id, null, period);
    }
    const periodIds = [...new Set(periodBySemester.values())];
    await this.ensureNotRunning(periodIds);
    const { date: _date, educationLevels: _levels, programIds: _programs, ...rest } = dto;
    const params: GenerationParams = {
      ...rest,
      mode: dto.mode ?? 'CALENDAR',
      groupIds: included.map((g) => g.groupId),
      periodIds,
    };
    const job = await this.prisma.scheduleGenerationJob.create({
      data: {
        schedulePeriodId: periodIds[0],
        periodIds,
        createdByUserId: actor.id,
        mode: params.mode === 'WEEKLY_TEMPLATE' ? GenerationMode.WEEKLY_TEMPLATE : GenerationMode.CALENDAR,
        paramsJson: params as unknown as Prisma.InputJsonValue,
        status: GenerationJobStatus.QUEUED,
        message: `Ожидание: расписание для ${included.length} групп(ы), периодов: ${periodIds.length}`,
      },
    });
    await this.queue.enqueue(job.id);
    await this.audit.log(actor.id, 'GENERATE', 'SchedulePeriod', periodIds[0], null, {
      jobId: job.id,
      joint: true,
      periodIds,
      groups: included.length,
    });
    return { job: this.present(job, false), plan, createdPeriods: created.length };
  }

  /** Совместные генерации (для всех групп) */
  async listJoint(actor: AuthUser) {
    const jobs = await this.prisma.scheduleGenerationJob.findMany({
      where: {
        schedulePeriod: { organizationId: actor.organizationId },
        NOT: { periodIds: { isEmpty: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { createdBy: { select: { id: true, fullName: true } } },
    });
    return jobs.map((j) => this.present(j, false));
  }

  async get(jobId: string, actor: AuthUser, includeResult = true) {
    const job = await this.prisma.scheduleGenerationJob.findFirst({
      where: { id: jobId, schedulePeriod: { organizationId: actor.organizationId } },
      include: { createdBy: { select: { id: true, fullName: true } } },
    });
    if (!job) throw new NotFoundException('Задание генерации не найдено');
    return this.present(job, includeResult);
  }

  async list(periodId: string, actor: AuthUser) {
    const jobs = await this.prisma.scheduleGenerationJob.findMany({
      where: {
        OR: [{ schedulePeriodId: periodId }, { periodIds: { has: periodId } }],
        schedulePeriod: { organizationId: actor.organizationId },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { createdBy: { select: { id: true, fullName: true } } },
    });
    return jobs.map((j) => this.present(j, false));
  }

  async cancel(jobId: string, actor: AuthUser) {
    const job = await this.prisma.scheduleGenerationJob.findFirst({
      where: { id: jobId, schedulePeriod: { organizationId: actor.organizationId } },
    });
    if (!job) throw new NotFoundException('Задание генерации не найдено');
    if (job.status === GenerationJobStatus.APPLIED) {
      throw new ConflictException('Результат уже применён — отмена невозможна');
    }
    const updated = await this.prisma.scheduleGenerationJob.update({
      where: { id: jobId },
      data: {
        status: GenerationJobStatus.CANCELLED,
        message: 'Отменено пользователем',
        finishedAt: new Date(),
      },
    });
    return this.present(updated, false);
  }

  /**
   * Применение результата генерации: удаление заменяемых занятий и создание новых.
   * Занятия, конфликтующие с изменениями, внесёнными после генерации, пропускаются.
   */
  async apply(jobId: string, actor: AuthUser) {
    const job = await this.prisma.scheduleGenerationJob.findFirst({
      where: { id: jobId, schedulePeriod: { organizationId: actor.organizationId } },
      include: { schedulePeriod: true },
    });
    if (!job) throw new NotFoundException('Задание генерации не найдено');
    if (job.appliedAt || job.status === GenerationJobStatus.APPLIED) {
      throw new ConflictException('Результат этой генерации уже применён');
    }
    if (!FINISHED.includes(job.status)) {
      throw new ConflictException(
        `Применить можно только завершённую генерацию (текущий статус: ${JOB_STATUS_LABELS[job.status]})`,
      );
    }
    if (job.schedulePeriod.status === SchedulePeriodStatus.ARCHIVED) {
      throw new ConflictException('Период находится в архиве');
    }
    const periodIds = job.periodIds.length ? job.periodIds : [job.schedulePeriodId];
    const archived = await this.prisma.schedulePeriod.count({
      where: { id: { in: periodIds }, status: SchedulePeriodStatus.ARCHIVED },
    });
    if (archived > 0) throw new ConflictException('Один из периодов генерации находится в архиве');
    const newer = await this.prisma.scheduleGenerationJob.findFirst({
      where: {
        id: { not: job.id },
        OR: [{ schedulePeriodId: { in: periodIds } }, { periodIds: { hasSome: periodIds } }],
        appliedAt: { gt: job.createdAt },
      },
    });
    if (newer) {
      throw new ConflictException(
        'После этой генерации был применён другой результат — запустите генерацию заново',
      );
    }
    const result = job.resultJson as unknown as GenerationResultJson;
    const skipped: Array<{ lesson: PreviewLesson; reason: string }> = [];

    const { created, deleted } = await this.prisma.$transaction(
      async (tx) => {
        const del = await tx.scheduleLesson.deleteMany({
          where: {
            id: { in: result.replaceLessonIds },
            status: LessonStatus.PLANNED,
            isManual: false,
            isLocked: false,
            conducted: null,
          },
        });
        const existing = await tx.scheduleLesson.findMany({
          where: {
            schedulePeriod: { organizationId: actor.organizationId },
            status: { in: ACTIVE_LESSON_STATUSES },
            date: { gte: parseDate(result.range.from), lte: parseDate(result.range.to) },
          },
          select: {
            date: true,
            lessonNumber: true,
            studentGroupId: true,
            subgroupNumber: true,
            teacherId: true,
            classroomId: true,
            streamKey: true,
            classroom: { select: { classroomType: true } },
          },
        });
        const teacherBusy = new Set<string>();
        const roomBusy = new Set<string>();
        const groupBusy = new Map<string, Set<number>>();
        const slot = (d: Date | string, n: number) =>
          `${typeof d === 'string' ? d : d.toISOString().slice(0, 10)}#${n}`;
        for (const e of existing) {
          const s = slot(e.date, e.lessonNumber);
          if (e.teacherId) teacherBusy.add(`${e.teacherId}#${s}`);
          if (e.classroomId && e.classroom?.classroomType !== 'ONLINE') roomBusy.add(`${e.classroomId}#${s}`);
          const gs = groupBusy.get(`${e.studentGroupId}#${s}`) ?? new Set<number>();
          gs.add(e.subgroupNumber ?? 0);
          groupBusy.set(`${e.studentGroupId}#${s}`, gs);
        }
        const rows: Prisma.ScheduleLessonCreateManyInput[] = [];
        for (const l of result.lessons) {
          const s = slot(l.date, l.lessonNumber);
          let reason: string | null = null;
          if (l.teacherId && teacherBusy.has(`${l.teacherId}#${s}`)) reason = 'преподаватель уже занят';
          if (l.roomId && roomBusy.has(`${l.roomId}#${s}`)) reason = 'аудитория уже занята';
          for (const g of l.groupIds) {
            const gs = groupBusy.get(`${g}#${s}`);
            if (gs && (l.subgroupNumber === null || gs.has(0) || gs.has(l.subgroupNumber)))
              reason = 'у группы уже есть занятие';
          }
          if (reason) {
            skipped.push({ lesson: l, reason });
            continue;
          }
          if (l.teacherId) teacherBusy.add(`${l.teacherId}#${s}`);
          if (l.roomId) roomBusy.add(`${l.roomId}#${s}`);
          l.groupIds.forEach((g, idx) => {
            const gs = groupBusy.get(`${g}#${s}`) ?? new Set<number>();
            gs.add(l.subgroupNumber ?? 0);
            groupBusy.set(`${g}#${s}`, gs);
            rows.push({
              schedulePeriodId: l.periodId ?? job.schedulePeriodId,
              date: parseDate(l.date),
              weekday: l.weekday,
              lessonNumber: l.lessonNumber,
              startTime: l.startTime,
              endTime: l.endTime,
              studentGroupId: g,
              subgroupNumber: l.subgroupNumber,
              semesterCurriculumItemId: l.semesterItemId,
              assignmentId: l.assignmentIds?.[idx] ?? null,
              teacherId: l.teacherId,
              classroomId: l.roomId,
              lessonType: l.lessonType as Prisma.ScheduleLessonCreateManyInput['lessonType'],
              status: LessonStatus.PLANNED,
              academicHours: l.academicHours,
              streamKey: l.groupIds.length > 1 ? (l.streamKey ?? `stream-${job.id.slice(0, 8)}`) : null,
              generationJobId: job.id,
            });
          });
        }
        if (rows.length) await tx.scheduleLesson.createMany({ data: rows });
        await tx.scheduleGenerationJob.update({
          where: { id: job.id },
          data: {
            status: GenerationJobStatus.APPLIED,
            appliedAt: new Date(),
            message: `Применено: создано ${rows.length} занятий${skipped.length ? `, пропущено ${skipped.length}` : ''}`,
          },
        });
        await tx.schedulePeriod.updateMany({
          where: { id: { in: periodIds }, status: SchedulePeriodStatus.DRAFT },
          data: { status: SchedulePeriodStatus.GENERATED },
        });
        return { created: rows.length, deleted: del.count };
      },
      { timeout: 120_000, maxWait: 20_000 },
    );

    const validation = { errors: 0, warnings: 0, canPublish: true };
    for (const id of periodIds) {
      const v = await this.validator.validatePeriod(id, actor.organizationId, true);
      validation.errors += v.errors;
      validation.warnings += v.warnings;
      validation.canPublish = validation.canPublish && v.canPublish;
    }
    if (job.schedulePeriod.status === SchedulePeriodStatus.PUBLISHED) {
      const groupIds = Array.from(new Set(result.lessons.flatMap((l) => l.groupIds)));
      await this.notifications.notify({
        type: NotificationType.SCHEDULE_PUBLISHED,
        title: 'Расписание обновлено',
        message: `Расписание «${job.schedulePeriod.title}» обновлено. Проверьте изменения.`,
        groupIds,
      });
    }
    await this.audit.log(actor.id, 'APPLY_GENERATION', 'SchedulePeriod', job.schedulePeriodId, null, {
      jobId,
      created,
      deleted,
      skipped: skipped.length,
    });
    return {
      created,
      deleted,
      skipped: skipped.map((s) => ({
        date: s.lesson.date,
        lessonNumber: s.lesson.lessonNumber,
        groups: s.lesson.groupCodes.join(', '),
        discipline: s.lesson.itemName,
        reason: s.reason,
      })),
      validation: {
        errors: validation.errors,
        warnings: validation.warnings,
        canPublish: validation.canPublish,
      },
    };
  }

  private present(
    job: {
      id: string;
      schedulePeriodId: string;
      periodIds: string[];
      status: GenerationJobStatus;
      mode: GenerationMode;
      progress: number;
      message: string | null;
      solver: string | null;
      error: string | null;
      paramsJson: Prisma.JsonValue;
      resultJson: Prisma.JsonValue;
      statsJson: Prisma.JsonValue;
      createdAt: Date;
      startedAt: Date | null;
      finishedAt: Date | null;
      appliedAt: Date | null;
      createdBy?: { id: string; fullName: string } | null;
    },
    includeResult: boolean,
  ) {
    return {
      id: job.id,
      schedulePeriodId: job.schedulePeriodId,
      periodIds: job.periodIds,
      status: job.status,
      statusLabel: JOB_STATUS_LABELS[job.status],
      mode: job.mode,
      progress: job.progress,
      message: job.message,
      solver: job.solver,
      error: job.error,
      params: job.paramsJson,
      stats: job.statsJson,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      appliedAt: job.appliedAt,
      createdBy: job.createdBy ?? null,
      result: includeResult ? job.resultJson : undefined,
    };
  }
}
