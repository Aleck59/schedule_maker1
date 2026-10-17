import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ConductedStatus,
  LessonStatus,
  NotificationType,
  Prisma,
  SchedulePeriodStatus,
  UserRole,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { parseDate, toDateStr } from '../common/utils/dates';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleValidatorService } from '../validation/schedule-validator.service';
import { ClearPeriodDto, CreatePeriodDto, UpdatePeriodDto } from './dto/schedule.dto';

@Injectable()
export class SchedulePeriodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validator: ScheduleValidatorService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: AuthUser,
    params: { semesterId?: string; status?: SchedulePeriodStatus; programId?: string },
  ) {
    const where: Prisma.SchedulePeriodWhereInput = {
      organizationId: actor.organizationId,
      semesterId: params.semesterId || undefined,
      status: params.status || undefined,
      semester: params.programId ? { educationalProgramId: params.programId } : undefined,
    };
    if (actor.role === UserRole.STUDENT || actor.role === UserRole.TEACHER) {
      where.status = SchedulePeriodStatus.PUBLISHED;
    }
    if (actor.role === UserRole.STUDENT && actor.studentGroupId) {
      const group = await this.prisma.studentGroup.findUnique({ where: { id: actor.studentGroupId } });
      where.semester = { educationalProgramId: group?.educationalProgramId };
    }
    const periods = await this.prisma.schedulePeriod.findMany({
      where,
      include: {
        semester: {
          select: {
            id: true,
            number: true,
            courseNumber: true,
            startDate: true,
            endDate: true,
            program: { select: { id: true, title: true } },
          },
        },
        academicYear: { select: { id: true, title: true } },
        _count: { select: { lessons: true } },
      },
      orderBy: [{ startDate: 'desc' }, { title: 'asc' }],
    });
    const errors = await this.prisma.validationResult.groupBy({
      by: ['schedulePeriodId', 'severity'],
      where: { schedulePeriodId: { in: periods.map((p) => p.id) }, isResolved: false },
      _count: { _all: true },
    });
    return periods.map((p) => ({
      ...p,
      startDate: toDateStr(p.startDate),
      endDate: toDateStr(p.endDate),
      validation: {
        errors: errors.find((e) => e.schedulePeriodId === p.id && e.severity === 'ERROR')?._count._all ?? 0,
        warnings:
          errors.find((e) => e.schedulePeriodId === p.id && e.severity === 'WARNING')?._count._all ?? 0,
      },
    }));
  }

  async get(id: string, actor: AuthUser) {
    const period = await this.prisma.schedulePeriod.findFirst({
      where: {
        id,
        organizationId: actor.organizationId,
        status:
          actor.role === UserRole.STUDENT || actor.role === UserRole.TEACHER
            ? SchedulePeriodStatus.PUBLISHED
            : undefined,
      },
      include: {
        semester: {
          include: {
            program: { include: { groups: { where: { isActive: true }, orderBy: { code: 'asc' } } } },
          },
        },
        academicYear: true,
      },
    });
    if (!period) throw new NotFoundException('Период расписания не найден');
    const [byStatus, jobs] = await Promise.all([
      this.prisma.scheduleLesson.groupBy({
        by: ['status'],
        where: { schedulePeriodId: id },
        _count: { _all: true },
      }),
      this.prisma.scheduleGenerationJob.findMany({
        where: { schedulePeriodId: id },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          status: true,
          progress: true,
          message: true,
          createdAt: true,
          appliedAt: true,
          solver: true,
        },
      }),
    ]);
    const validation = await this.prisma.validationResult.groupBy({
      by: ['severity'],
      where: { schedulePeriodId: id },
      _count: { _all: true },
    });
    return {
      ...period,
      startDate: toDateStr(period.startDate),
      endDate: toDateStr(period.endDate),
      lessonsByStatus: Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])),
      lessonsTotal: byStatus.reduce((a, b) => a + b._count._all, 0),
      validation: Object.fromEntries(validation.map((v) => [v.severity, v._count._all])),
      recentJobs: jobs,
    };
  }

  async create(dto: CreatePeriodDto, actor: AuthUser) {
    const semester = await this.prisma.semester.findFirst({
      where: { id: dto.semesterId, program: { organizationId: actor.organizationId } },
    });
    if (!semester) throw new BadRequestException('Семестр не найден');
    const start = dto.startDate ?? toDateStr(semester.startDate);
    const end = dto.endDate ?? toDateStr(semester.endDate);
    if (start > end) throw new BadRequestException('Дата окончания периода раньше даты начала');
    if (start < toDateStr(semester.startDate) || end > toDateStr(semester.endDate)) {
      throw new BadRequestException('Период расписания должен находиться в пределах дат семестра');
    }
    const created = await this.prisma.schedulePeriod.create({
      data: {
        organizationId: actor.organizationId,
        academicYearId: dto.academicYearId ?? semester.academicYearId,
        semesterId: semester.id,
        title: dto.title.trim(),
        startDate: parseDate(start),
        endDate: parseDate(end),
        notes: dto.notes,
      },
    });
    await this.audit.log(actor.id, 'CREATE', 'SchedulePeriod', created.id, null, created);
    return this.get(created.id, actor);
  }

  async update(id: string, dto: UpdatePeriodDto, actor: AuthUser) {
    const before = await this.prisma.schedulePeriod.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: { semester: true },
    });
    if (!before) throw new NotFoundException('Период расписания не найден');
    if (dto.status === SchedulePeriodStatus.PUBLISHED) {
      throw new BadRequestException(
        'Для публикации используйте действие «Опубликовать» — оно выполняет проверку расписания',
      );
    }
    const start = dto.startDate ?? toDateStr(before.startDate);
    const end = dto.endDate ?? toDateStr(before.endDate);
    if (start > end) throw new BadRequestException('Дата окончания периода раньше даты начала');
    if (start < toDateStr(before.semester.startDate) || end > toDateStr(before.semester.endDate)) {
      throw new BadRequestException('Период расписания должен находиться в пределах дат семестра');
    }
    const updated = await this.prisma.schedulePeriod.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        startDate: dto.startDate ? parseDate(dto.startDate) : undefined,
        endDate: dto.endDate ? parseDate(dto.endDate) : undefined,
        status: dto.status,
        notes: dto.notes,
      },
    });
    await this.audit.log(actor.id, 'UPDATE', 'SchedulePeriod', id, before, updated);
    return this.get(id, actor);
  }

  async remove(id: string, actor: AuthUser) {
    const period = await this.prisma.schedulePeriod.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!period) throw new NotFoundException('Период расписания не найден');
    const conducted = await this.prisma.conductedLesson.count({
      where: { scheduleLesson: { schedulePeriodId: id }, status: ConductedStatus.CONDUCTED },
    });
    if (conducted > 0) {
      throw new ConflictException('Нельзя удалить период с проведёнными занятиями — переведите его в архив');
    }
    await this.prisma.schedulePeriod.delete({ where: { id } });
    await this.audit.log(actor.id, 'DELETE', 'SchedulePeriod', id, period, null);
    return { success: true };
  }

  /** Публикация: только если нет ошибок, блокирующих публикацию */
  async publish(id: string, actor: AuthUser) {
    const period = await this.prisma.schedulePeriod.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!period) throw new NotFoundException('Период расписания не найден');
    if (period.status === SchedulePeriodStatus.ARCHIVED)
      throw new ConflictException('Период находится в архиве');
    const summary = await this.validator.validatePeriod(id, actor.organizationId, true);
    if (!summary.canPublish) {
      const errors = summary.items.filter((i) => i.severity === 'ERROR');
      throw new ConflictException({
        message: `Публикация невозможна: найдено ошибок — ${summary.errors}. ${errors[0]?.message ?? ''}`,
        errors: errors.slice(0, 20).map((e) => e.message),
        details: { errors: summary.errors, warnings: summary.warnings, byType: summary.byType },
      });
    }
    const updated = await this.prisma.schedulePeriod.update({
      where: { id },
      data: { status: SchedulePeriodStatus.PUBLISHED, publishedAt: new Date() },
    });
    const lessons = await this.prisma.scheduleLesson.findMany({
      where: { schedulePeriodId: id },
      select: { studentGroupId: true, teacherId: true },
      distinct: ['studentGroupId', 'teacherId'],
    });
    await this.notifications.notify({
      type: NotificationType.SCHEDULE_PUBLISHED,
      title: 'Опубликовано расписание',
      message: `Опубликовано расписание «${period.title}»`,
      groupIds: Array.from(new Set(lessons.map((l) => l.studentGroupId))),
      teacherIds: Array.from(new Set(lessons.map((l) => l.teacherId))),
    });
    await this.audit.log(actor.id, 'PUBLISH', 'SchedulePeriod', id, period, updated);
    return {
      period: await this.get(id, actor),
      validation: { errors: summary.errors, warnings: summary.warnings },
    };
  }

  async unpublish(id: string, actor: AuthUser) {
    const period = await this.prisma.schedulePeriod.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!period) throw new NotFoundException('Период расписания не найден');
    const updated = await this.prisma.schedulePeriod.update({
      where: { id },
      data: { status: SchedulePeriodStatus.GENERATED, publishedAt: null },
    });
    await this.audit.log(actor.id, 'UNPUBLISH', 'SchedulePeriod', id, period, updated);
    return this.get(id, actor);
  }

  /** Очистка занятий периода (например, перед повторной генерацией) */
  async clear(id: string, dto: ClearPeriodDto, actor: AuthUser) {
    const period = await this.prisma.schedulePeriod.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!period) throw new NotFoundException('Период расписания не найден');
    const where: Prisma.ScheduleLessonWhereInput = {
      schedulePeriodId: id,
      studentGroupId: dto.groupIds?.length ? { in: dto.groupIds } : undefined,
      date: { gte: dto.from ? parseDate(dto.from) : undefined, lte: dto.to ? parseDate(dto.to) : undefined },
      status: LessonStatus.PLANNED,
      conducted: null,
      isLocked: false,
      isManual: dto.onlyGenerated === false ? undefined : false,
    };
    const result = await this.prisma.scheduleLesson.deleteMany({ where });
    await this.audit.log(actor.id, 'CLEAR', 'SchedulePeriod', id, null, { deleted: result.count, ...dto });
    return { deleted: result.count };
  }
}
