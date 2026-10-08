import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { GroupCurriculumAssignment, LessonType, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { hoursForType } from '../common/utils/hours';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAssignmentDto, GenerateAssignmentsDto, UpdateAssignmentDto } from './dto/assignments.dto';

const INCLUDE = {
  group: { select: { id: true, code: true, studentCount: true, subgroupCount: true } },
  semesterItem: {
    include: {
      curriculumItem: { select: { id: true, code: true, name: true, itemType: true } },
      semester: { select: { id: true, number: true, courseNumber: true } },
    },
  },
  teacher: { select: { id: true, fullName: true } },
  preferredClassroom: { select: { id: true, code: true, name: true } },
} satisfies Prisma.GroupCurriculumAssignmentInclude;

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(
    actor: AuthUser,
    params: {
      groupId?: string;
      teacherId?: string;
      semesterId?: string;
      programId?: string;
      semesterItemId?: string;
    },
  ) {
    return this.prisma.groupCurriculumAssignment.findMany({
      where: {
        group: { program: { organizationId: actor.organizationId } },
        studentGroupId: params.groupId || undefined,
        teacherId: params.teacherId || undefined,
        semesterCurriculumItemId: params.semesterItemId || undefined,
        semesterItem: {
          semesterId: params.semesterId || undefined,
          semester: params.programId ? { educationalProgramId: params.programId } : undefined,
        },
      },
      include: INCLUDE,
      orderBy: [
        { group: { code: 'asc' } },
        { semesterItem: { curriculumItem: { code: 'asc' } } },
        { lessonType: 'asc' },
        { subgroupNumber: 'asc' },
      ],
    });
  }

  async get(id: string, actor: AuthUser) {
    const a = await this.prisma.groupCurriculumAssignment.findFirst({
      where: { id, group: { program: { organizationId: actor.organizationId } } },
      include: INCLUDE,
    });
    if (!a) throw new NotFoundException('Назначение нагрузки не найдено');
    return a;
  }

  async create(dto: CreateAssignmentDto, actor: AuthUser) {
    await this.validate(dto.studentGroupId, dto.semesterCurriculumItemId, dto, actor);
    const created = await this.prisma.groupCurriculumAssignment.create({
      data: {
        studentGroupId: dto.studentGroupId,
        semesterCurriculumItemId: dto.semesterCurriculumItemId,
        subgroupNumber: dto.subgroupNumber ?? null,
        lessonType: dto.lessonType ?? null,
        teacherId: dto.teacherId ?? null,
        weeklyLessonTarget: dto.weeklyLessonTarget ?? null,
        priority: dto.priority ?? 5,
        plannedHours: dto.plannedHours ?? null,
        preferredClassroomId: dto.preferredClassroomId ?? null,
        classroomTypes: dto.classroomTypes ?? [],
        streamKey: dto.streamKey?.trim() || null,
        allowHoursExcess: dto.allowHoursExcess ?? false,
      },
      include: INCLUDE,
    });
    await this.audit.log(actor.id, 'CREATE', 'GroupCurriculumAssignment', created.id, null, created);
    return created;
  }

  async update(id: string, dto: UpdateAssignmentDto, actor: AuthUser) {
    const before = await this.get(id, actor);
    const merged = {
      subgroupNumber: dto.subgroupNumber === undefined ? before.subgroupNumber : dto.subgroupNumber,
      lessonType: dto.lessonType === undefined ? before.lessonType : dto.lessonType,
      teacherId: dto.teacherId === undefined ? before.teacherId : dto.teacherId,
      plannedHours: dto.plannedHours === undefined ? before.plannedHours : dto.plannedHours,
      preferredClassroomId:
        dto.preferredClassroomId === undefined ? before.preferredClassroomId : dto.preferredClassroomId,
    };
    await this.validate(before.studentGroupId, before.semesterCurriculumItemId, merged, actor, id);
    const updated = await this.prisma.groupCurriculumAssignment.update({
      where: { id },
      data: {
        subgroupNumber: dto.subgroupNumber,
        lessonType: dto.lessonType,
        teacherId: dto.teacherId,
        weeklyLessonTarget: dto.weeklyLessonTarget,
        priority: dto.priority,
        plannedHours: dto.plannedHours,
        preferredClassroomId: dto.preferredClassroomId,
        classroomTypes: dto.classroomTypes,
        streamKey: dto.streamKey === undefined ? undefined : dto.streamKey?.trim() || null,
        allowHoursExcess: dto.allowHoursExcess,
      },
      include: INCLUDE,
    });
    await this.audit.log(actor.id, 'UPDATE', 'GroupCurriculumAssignment', id, before, updated);
    return updated;
  }

  async remove(id: string, actor: AuthUser) {
    const before = await this.get(id, actor);
    await this.prisma.groupCurriculumAssignment.delete({ where: { id } });
    await this.audit.log(actor.id, 'DELETE', 'GroupCurriculumAssignment', id, before, null);
    return { success: true };
  }

  /**
   * Формирование «пустой» нагрузки группы на семестр: для каждой дисциплины семестра,
   * у которой ещё нет назначений, создаётся назначение на всю группу без преподавателя.
   */
  async generate(dto: GenerateAssignmentsDto, actor: AuthUser) {
    const group = await this.prisma.studentGroup.findFirst({
      where: { id: dto.studentGroupId, program: { organizationId: actor.organizationId } },
    });
    if (!group) throw new NotFoundException('Группа не найдена');
    const semester = await this.prisma.semester.findFirst({
      where: { id: dto.semesterId, educationalProgramId: group.educationalProgramId },
    });
    if (!semester) throw new BadRequestException('Семестр не относится к учебному плану группы');
    const items = await this.prisma.semesterCurriculumItem.findMany({
      where: { semesterId: semester.id },
      include: { assignments: { where: { studentGroupId: group.id } }, curriculumItem: true },
    });
    let created = 0;
    for (const item of items) {
      const schedulable =
        item.lectureHours +
        item.practicalHours +
        item.laboratoryHours +
        item.consultationHours +
        (item.practiceAtCollege ? item.practiceHours : 0);
      if (schedulable === 0 || item.assignments.length > 0) continue;
      await this.prisma.groupCurriculumAssignment.create({
        data: { studentGroupId: group.id, semesterCurriculumItemId: item.id },
      });
      created++;
    }
    await this.audit.log(actor.id, 'GENERATE', 'GroupCurriculumAssignment', group.id, null, { created });
    return { created };
  }

  private async validate(
    groupId: string,
    semesterItemId: string,
    dto: {
      subgroupNumber?: number | null;
      lessonType?: LessonType | null;
      teacherId?: string | null;
      plannedHours?: number | null;
      preferredClassroomId?: string | null;
    },
    actor: AuthUser,
    excludeId?: string,
  ) {
    const group = await this.prisma.studentGroup.findFirst({
      where: { id: groupId, program: { organizationId: actor.organizationId } },
    });
    if (!group) throw new BadRequestException('Группа не найдена');
    const item = await this.prisma.semesterCurriculumItem.findFirst({
      where: { id: semesterItemId },
      include: { semester: true, curriculumItem: true },
    });
    if (!item) throw new BadRequestException('Дисциплина семестра не найдена');
    if (item.semester.educationalProgramId !== group.educationalProgramId) {
      throw new BadRequestException('Дисциплина не относится к учебному плану группы');
    }
    if (item.curriculumItem.itemType === 'MODULE' || item.curriculumItem.itemType === 'FINAL_ATTESTATION') {
      throw new BadRequestException(
        'Профессиональный модуль и ГИА не ставятся в расписание — назначайте МДК и практики',
      );
    }
    if (dto.subgroupNumber && dto.subgroupNumber > group.subgroupCount) {
      throw new BadRequestException(`У группы ${group.code} только ${group.subgroupCount} подгрупп(ы)`);
    }
    if (dto.lessonType && dto.lessonType !== LessonType.OTHER) {
      const hours = hoursForType(item, dto.lessonType);
      if (hours === 0 && !dto.plannedHours) {
        throw new BadRequestException('В учебном плане нет часов этого вида занятий для дисциплины');
      }
    }
    if (dto.teacherId) {
      const teacher = await this.prisma.teacher.findFirst({
        where: { id: dto.teacherId, organizationId: actor.organizationId },
      });
      if (!teacher) throw new BadRequestException('Преподаватель не найден');
      if (!teacher.isActive) throw new BadRequestException('Преподаватель неактивен');
    }
    if (dto.preferredClassroomId) {
      const room = await this.prisma.classroom.findFirst({
        where: { id: dto.preferredClassroomId, organizationId: actor.organizationId },
      });
      if (!room) throw new BadRequestException('Аудитория не найдена');
    }
    // Проверка непротиворечивости: для одного вида занятий — либо вся группа, либо подгруппы
    const siblings = await this.prisma.groupCurriculumAssignment.findMany({
      where: {
        studentGroupId: groupId,
        semesterCurriculumItemId: semesterItemId,
        NOT: excludeId ? { id: excludeId } : undefined,
      },
    });
    const sameType = siblings.filter(
      (s: GroupCurriculumAssignment) => (s.lessonType ?? null) === (dto.lessonType ?? null),
    );
    const subgroup = dto.subgroupNumber ?? null;
    if (sameType.some((s) => (s.subgroupNumber ?? null) === subgroup)) {
      throw new ConflictException(
        subgroup
          ? `Для подгруппы ${subgroup} уже есть назначение по этому виду занятий`
          : 'Для всей группы уже есть назначение по этому виду занятий',
      );
    }
    if (subgroup === null && sameType.some((s) => s.subgroupNumber !== null)) {
      throw new ConflictException(
        'По этому виду занятий уже есть назначения по подгруппам — удалите их или назначьте подгруппу',
      );
    }
    if (subgroup !== null && sameType.some((s) => s.subgroupNumber === null)) {
      throw new ConflictException(
        'По этому виду занятий уже есть назначение на всю группу — удалите его или измените',
      );
    }
  }
}
