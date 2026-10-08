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
import { parseDate } from '../common/utils/dates';
import { JOB_STATUS_LABELS } from '../common/utils/labels';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleValidatorService } from '../validation/schedule-validator.service';
import { GenerateScheduleDto } from './dto/generation.dto';
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
    const running = await this.prisma.scheduleGenerationJob.findFirst({
      where: {
        schedulePeriodId: periodId,
        status: {
          in: [GenerationJobStatus.QUEUED, GenerationJobStatus.GENERATING, GenerationJobStatus.VALIDATING],
        },
      },
    });
    if (running) {
      throw new ConflictException('Для этого периода уже выполняется генерация — дождитесь её завершения');
    }
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
      where: { schedulePeriodId: periodId, schedulePeriod: { organizationId: actor.organizationId } },
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
    const newer = await this.prisma.scheduleGenerationJob.findFirst({
      where: { schedulePeriodId: job.schedulePeriodId, appliedAt: { gt: job.createdAt } },
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
              schedulePeriodId: job.schedulePeriodId,
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
        if (job.schedulePeriod.status === SchedulePeriodStatus.DRAFT) {
          await tx.schedulePeriod.update({
            where: { id: job.schedulePeriodId },
            data: { status: SchedulePeriodStatus.GENERATED },
          });
        }
        return { created: rows.length, deleted: del.count };
      },
      { timeout: 120_000, maxWait: 20_000 },
    );

    const validation = await this.validator.validatePeriod(job.schedulePeriodId, actor.organizationId, true);
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
