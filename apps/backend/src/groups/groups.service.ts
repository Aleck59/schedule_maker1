import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { AddStudentsDto, ConfigureSubgroupsDto, CreateGroupDto, UpdateGroupDto, UpdateStudentDto } from './dto/groups.dto';

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Студент видит только свою группу */
  assertGroupAccess(groupId: string, actor: AuthUser) {
    if (actor.role === UserRole.STUDENT && actor.studentGroupId !== groupId) {
      throw new ForbiddenException('Доступно только расписание своей группы');
    }
  }

  async list(actor: AuthUser, params: { programId?: string; isActive?: boolean; search?: string }) {
    const where: Prisma.StudentGroupWhereInput = {
      program: { organizationId: actor.organizationId },
      educationalProgramId: params.programId || undefined,
      isActive: params.isActive,
      code: params.search ? { contains: params.search, mode: 'insensitive' } : undefined,
    };
    if (actor.role === UserRole.STUDENT) {
      where.id = actor.studentGroupId ?? '00000000-0000-0000-0000-000000000000';
    }
    return this.prisma.studentGroup.findMany({
      where,
      include: {
        program: { select: { id: true, title: true, admissionYear: true, specialty: { select: { code: true, name: true } } } },
        subgroups: { orderBy: { number: 'asc' } },
        _count: { select: { students: true, assignments: true } },
      },
      orderBy: [{ courseNumber: 'asc' }, { code: 'asc' }],
    });
  }

  async get(id: string, actor: AuthUser) {
    this.assertGroupAccess(id, actor);
    const group = await this.prisma.studentGroup.findFirst({
      where: { id, program: { organizationId: actor.organizationId } },
      include: {
        program: { include: { specialty: true, semesters: { orderBy: { number: 'asc' } } } },
        subgroups: {
          orderBy: { number: 'asc' },
          include: { students: { orderBy: { fullName: 'asc' }, select: { id: true, fullName: true } } },
        },
        _count: { select: { students: true, assignments: true, lessons: true } },
      },
    });
    if (!group) throw new NotFoundException('Группа не найдена');
    return group;
  }

  async create(dto: CreateGroupDto, actor: AuthUser) {
    const program = await this.prisma.educationalProgram.findFirst({
      where: { id: dto.educationalProgramId, organizationId: actor.organizationId },
    });
    if (!program) throw new BadRequestException('Учебный план не найден');
    if (dto.currentSemesterNumber > program.totalSemesters) {
      throw new BadRequestException(`В учебном плане только ${program.totalSemesters} семестров`);
    }
    const subgroupCount = dto.subgroupCount ?? 1;
    const group = await this.prisma.$transaction(async (tx) => {
      const created = await tx.studentGroup.create({
        data: {
          educationalProgramId: dto.educationalProgramId,
          code: dto.code.trim(),
          title: dto.title?.trim() || `${program.title}, группа ${dto.code.trim()}`,
          admissionYear: dto.admissionYear ?? program.admissionYear,
          courseNumber: dto.courseNumber,
          currentSemesterNumber: dto.currentSemesterNumber,
          studentCount: dto.studentCount,
          subgroupCount,
          isActive: dto.isActive ?? true,
        },
      });
      if (subgroupCount > 1) {
        const base = Math.floor(dto.studentCount / subgroupCount);
        const extra = dto.studentCount % subgroupCount;
        await tx.subgroup.createMany({
          data: Array.from({ length: subgroupCount }, (_, i) => ({
            studentGroupId: created.id,
            number: i + 1,
            name: `Подгруппа ${i + 1}`,
            studentCount: base + (i < extra ? 1 : 0),
          })),
        });
      }
      return created;
    });
    await this.audit.log(actor.id, 'CREATE', 'StudentGroup', group.id, null, group);
    return this.get(group.id, actor);
  }

  async update(id: string, dto: UpdateGroupDto, actor: AuthUser) {
    const before = await this.get(id, actor);
    if (dto.educationalProgramId && dto.educationalProgramId !== before.educationalProgramId) {
      const lessons = await this.prisma.scheduleLesson.count({ where: { studentGroupId: id } });
      if (lessons > 0) {
        throw new ConflictException('Нельзя сменить учебный план группы, по которой уже составлено расписание');
      }
    }
    const updated = await this.prisma.studentGroup.update({
      where: { id },
      data: {
        educationalProgramId: dto.educationalProgramId,
        code: dto.code?.trim(),
        title: dto.title?.trim(),
        admissionYear: dto.admissionYear,
        courseNumber: dto.courseNumber,
        currentSemesterNumber: dto.currentSemesterNumber,
        studentCount: dto.studentCount,
        subgroupCount: dto.subgroupCount,
        isActive: dto.isActive,
      },
    });
    if (dto.subgroupCount && dto.subgroupCount !== before.subgroupCount) {
      await this.syncSubgroupCount(id, dto.subgroupCount, updated.studentCount);
    }
    await this.audit.log(actor.id, 'UPDATE', 'StudentGroup', id, before, updated);
    return this.get(id, actor);
  }

  async remove(id: string, actor: AuthUser) {
    const before = await this.get(id, actor);
    if (before._count.lessons > 0) {
      throw new ConflictException('Нельзя удалить группу, по которой составлено расписание. Сделайте её неактивной');
    }
    await this.prisma.studentGroup.delete({ where: { id } });
    await this.audit.log(actor.id, 'DELETE', 'StudentGroup', id, before, null);
    return { success: true };
  }

  // ---------------------------------------------------------------- подгруппы

  async listSubgroups(groupId: string, actor: AuthUser) {
    await this.get(groupId, actor);
    return this.prisma.subgroup.findMany({
      where: { studentGroupId: groupId },
      orderBy: { number: 'asc' },
      include: { students: { select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } } },
    });
  }

  async configureSubgroups(groupId: string, dto: ConfigureSubgroupsDto, actor: AuthUser) {
    const group = await this.get(groupId, actor);
    const numbers = dto.subgroups.map((s) => s.number).sort((a, b) => a - b);
    if (new Set(numbers).size !== numbers.length) {
      throw new BadRequestException('Номера подгрупп не должны повторяться');
    }
    const maxNumber = numbers[numbers.length - 1];
    // Нельзя удалить подгруппу, на которую есть назначения или занятия
    const removed = group.subgroups.filter((s) => !numbers.includes(s.number));
    for (const s of removed) {
      const used =
        (await this.prisma.groupCurriculumAssignment.count({ where: { studentGroupId: groupId, subgroupNumber: s.number } })) +
        (await this.prisma.scheduleLesson.count({ where: { studentGroupId: groupId, subgroupNumber: s.number } }));
      if (used > 0) {
        throw new ConflictException(`Подгруппа ${s.number} используется в нагрузке или расписании и не может быть удалена`);
      }
    }
    const allStudentIds = dto.subgroups.flatMap((s) => s.studentIds ?? []);
    if (new Set(allStudentIds).size !== allStudentIds.length) {
      throw new BadRequestException('Студент не может состоять в двух подгруппах одновременно');
    }
    if (allStudentIds.length > 0) {
      const count = await this.prisma.student.count({ where: { id: { in: allStudentIds }, studentGroupId: groupId } });
      if (count !== allStudentIds.length) {
        throw new BadRequestException('Некоторые студенты не принадлежат группе');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.subgroup.deleteMany({ where: { studentGroupId: groupId, number: { notIn: numbers } } });
      for (const s of dto.subgroups) {
        const saved = await tx.subgroup.upsert({
          where: { studentGroupId_number: { studentGroupId: groupId, number: s.number } },
          create: {
            studentGroupId: groupId,
            number: s.number,
            name: s.name?.trim() || `Подгруппа ${s.number}`,
            studentCount: s.studentIds?.length ?? s.studentCount ?? 0,
          },
          update: {
            name: s.name?.trim() || undefined,
            studentCount: s.studentIds?.length ?? s.studentCount ?? undefined,
          },
        });
        if (s.studentIds) {
          await tx.student.updateMany({ where: { subgroupId: saved.id, id: { notIn: s.studentIds } }, data: { subgroupId: null } });
          await tx.student.updateMany({ where: { id: { in: s.studentIds } }, data: { subgroupId: saved.id } });
        }
      }
      await tx.studentGroup.update({ where: { id: groupId }, data: { subgroupCount: Math.max(maxNumber, numbers.length) } });
    });
    await this.audit.log(actor.id, 'UPDATE', 'Subgroups', groupId, group.subgroups, dto.subgroups);
    return this.listSubgroups(groupId, actor);
  }

  private async syncSubgroupCount(groupId: string, count: number, studentCount: number) {
    const existing = await this.prisma.subgroup.findMany({ where: { studentGroupId: groupId } });
    const base = Math.floor(studentCount / Math.max(1, count));
    for (let n = 1; n <= count; n++) {
      if (!existing.some((s) => s.number === n) && count > 1) {
        await this.prisma.subgroup.create({
          data: { studentGroupId: groupId, number: n, name: `Подгруппа ${n}`, studentCount: base },
        });
      }
    }
  }

  // ---------------------------------------------------------------- студенты

  async listStudents(groupId: string, actor: AuthUser) {
    await this.get(groupId, actor);
    return this.prisma.student.findMany({
      where: { studentGroupId: groupId },
      include: { subgroup: { select: { id: true, number: true, name: true } } },
      orderBy: { fullName: 'asc' },
    });
  }

  async addStudents(groupId: string, dto: AddStudentsDto, actor: AuthUser) {
    const group = await this.get(groupId, actor);
    const subgroupByNumber = new Map(group.subgroups.map((s) => [s.number, s.id]));
    for (const s of dto.students) {
      if (s.subgroupNumber && !subgroupByNumber.has(s.subgroupNumber)) {
        throw new BadRequestException(`У группы нет подгруппы ${s.subgroupNumber}`);
      }
    }
    await this.prisma.student.createMany({
      data: dto.students.map((s) => ({
        studentGroupId: groupId,
        fullName: s.fullName.trim(),
        recordBookNumber: s.recordBookNumber,
        subgroupId: s.subgroupNumber ? subgroupByNumber.get(s.subgroupNumber) : null,
      })),
    });
    await this.refreshCounts(groupId);
    await this.audit.log(actor.id, 'CREATE', 'Student', groupId, null, dto.students);
    return this.listStudents(groupId, actor);
  }

  async updateStudent(id: string, dto: UpdateStudentDto, actor: AuthUser) {
    const student = await this.prisma.student.findFirst({
      where: { id, group: { program: { organizationId: actor.organizationId } } },
    });
    if (!student) throw new NotFoundException('Студент не найден');
    let subgroupId: string | null | undefined = undefined;
    if (dto.subgroupNumber === null) subgroupId = null;
    else if (dto.subgroupNumber !== undefined) {
      const sg = await this.prisma.subgroup.findUnique({
        where: { studentGroupId_number: { studentGroupId: student.studentGroupId, number: dto.subgroupNumber } },
      });
      if (!sg) throw new BadRequestException(`У группы нет подгруппы ${dto.subgroupNumber}`);
      subgroupId = sg.id;
    }
    const updated = await this.prisma.student.update({
      where: { id },
      data: { fullName: dto.fullName?.trim(), recordBookNumber: dto.recordBookNumber, isActive: dto.isActive, subgroupId },
    });
    await this.refreshCounts(student.studentGroupId);
    await this.audit.log(actor.id, 'UPDATE', 'Student', id, student, updated);
    return updated;
  }

  async removeStudent(id: string, actor: AuthUser) {
    const student = await this.prisma.student.findFirst({
      where: { id, group: { program: { organizationId: actor.organizationId } } },
    });
    if (!student) throw new NotFoundException('Студент не найден');
    await this.prisma.student.delete({ where: { id } });
    await this.refreshCounts(student.studentGroupId);
    await this.audit.log(actor.id, 'DELETE', 'Student', id, student, null);
    return { success: true };
  }

  /** Численность подгрупп и группы по списку студентов */
  private async refreshCounts(groupId: string) {
    const subgroups = await this.prisma.subgroup.findMany({ where: { studentGroupId: groupId } });
    for (const sg of subgroups) {
      const count = await this.prisma.student.count({ where: { subgroupId: sg.id, isActive: true } });
      await this.prisma.subgroup.update({ where: { id: sg.id }, data: { studentCount: count } });
    }
    const total = await this.prisma.student.count({ where: { studentGroupId: groupId, isActive: true } });
    if (total > 0) {
      await this.prisma.studentGroup.update({ where: { id: groupId }, data: { studentCount: total } });
    }
  }
}
