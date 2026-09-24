import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MakeupTaskStatus, Prisma, UserRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { parseDate, toDateStr } from '../common/utils/dates';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleMakeupDto, UpdateMakeupTaskDto } from './dto/schedule.dto';
import { ScheduleLessonsService } from './schedule-lessons.service';
import { SlotFinderService } from './slot-finder.service';

const INCLUDE = {
  group: { select: { id: true, code: true } },
  semesterItem: { include: { curriculumItem: { select: { code: true, name: true } } } },
  teacher: { select: { id: true, fullName: true } },
  sourceLesson: { select: { id: true, date: true, lessonNumber: true, schedulePeriodId: true, status: true } },
  resolvedLesson: { select: { id: true, date: true, lessonNumber: true, status: true } },
} satisfies Prisma.MakeupTaskInclude;

/** Задачи «требуется отработка» после отмены занятий */
@Injectable()
export class MakeupTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lessons: ScheduleLessonsService,
    private readonly slots: SlotFinderService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, params: { status?: MakeupTaskStatus; groupId?: string; teacherId?: string }) {
    const where: Prisma.MakeupTaskWhereInput = {
      group: { program: { organizationId: actor.organizationId } },
      status: params.status || undefined,
      studentGroupId: params.groupId || undefined,
      teacherId: params.teacherId || undefined,
    };
    if (actor.role === UserRole.TEACHER) where.teacherId = actor.teacherId ?? '-';
    const tasks = await this.prisma.makeupTask.findMany({ where, include: INCLUDE, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] });
    return tasks.map((t) => ({
      ...t,
      dueDate: t.dueDate ? toDateStr(t.dueDate) : null,
      sourceLesson: t.sourceLesson ? { ...t.sourceLesson, date: toDateStr(t.sourceLesson.date) } : null,
      resolvedLesson: t.resolvedLesson ? { ...t.resolvedLesson, date: toDateStr(t.resolvedLesson.date) } : null,
    }));
  }

  private async load(id: string, actor: AuthUser) {
    const task = await this.prisma.makeupTask.findFirst({
      where: { id, group: { program: { organizationId: actor.organizationId } } },
      include: INCLUDE,
    });
    if (!task) throw new NotFoundException('Задача отработки не найдена');
    return task;
  }

  async update(id: string, dto: UpdateMakeupTaskDto, actor: AuthUser) {
    const before = await this.load(id, actor);
    const updated = await this.prisma.makeupTask.update({
      where: { id },
      data: { status: dto.status, notes: dto.notes, dueDate: dto.dueDate ? parseDate(dto.dueDate) : undefined },
      include: INCLUDE,
    });
    await this.audit.log(actor.id, 'UPDATE', 'MakeupTask', id, before, updated);
    return updated;
  }

  async freeSlots(id: string, actor: AuthUser, params: { from?: string; to?: string; limit?: number }) {
    const task = await this.load(id, actor);
    return this.slots.find({
      organizationId: actor.organizationId,
      studentGroupId: task.studentGroupId,
      subgroupNumber: task.subgroupNumber,
      semesterCurriculumItemId: task.semesterCurriculumItemId,
      lessonType: task.lessonType,
      teacherId: task.teacherId,
      from: params.from,
      to: params.to,
      limit: params.limit ?? 10,
    });
  }

  /** Постановка отработки в расписание */
  async schedule(id: string, dto: ScheduleMakeupDto, actor: AuthUser) {
    const task = await this.load(id, actor);
    if (task.status !== MakeupTaskStatus.OPEN) {
      throw new ConflictException('Отработка уже поставлена в расписание или закрыта');
    }
    let classroomId = dto.classroomId ?? null;
    if (!classroomId) {
      const candidates = await this.slots.find({
        organizationId: actor.organizationId,
        studentGroupId: task.studentGroupId,
        subgroupNumber: task.subgroupNumber,
        semesterCurriculumItemId: task.semesterCurriculumItemId,
        lessonType: task.lessonType,
        teacherId: dto.teacherId ?? task.teacherId,
        from: dto.date,
        to: dto.date,
        limit: 50,
      });
      classroomId = candidates.find((c) => c.lessonNumber === dto.lessonNumber)?.classroomId ?? null;
    }
    return this.lessons.create(
      {
        schedulePeriodId: task.sourceLesson.schedulePeriodId,
        date: dto.date,
        lessonNumber: dto.lessonNumber,
        studentGroupId: task.studentGroupId,
        subgroupNumber: task.subgroupNumber,
        semesterCurriculumItemId: task.semesterCurriculumItemId,
        lessonType: task.lessonType,
        teacherId: dto.teacherId ?? task.teacherId,
        classroomId,
        academicHours: task.academicHours,
        makeupTaskId: task.id,
        notes: 'Отработка отменённого занятия',
        force: dto.force,
      },
      actor,
    );
  }
}
