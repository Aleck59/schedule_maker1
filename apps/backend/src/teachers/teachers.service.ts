import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ReplaceAvailabilityDto } from '../common/dto/availability.dto';
import { AuthUser } from '../common/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTeacherDto, UpdateTeacherDto } from './dto/teachers.dto';

@Injectable()
export class TeachersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(actor: AuthUser, params: { search?: string; department?: string; isActive?: boolean }) {
    return this.prisma.teacher.findMany({
      where: {
        organizationId: actor.organizationId,
        isActive: params.isActive,
        department: params.department || undefined,
        fullName: params.search ? { contains: params.search, mode: 'insensitive' } : undefined,
      },
      include: {
        _count: { select: { assignments: true, availability: true } },
        user: { select: { id: true, email: true } },
      },
      orderBy: { fullName: 'asc' },
    });
  }

  async get(id: string, actor: AuthUser) {
    const teacher = await this.prisma.teacher.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: {
        availability: { orderBy: [{ weekday: 'asc' }, { lessonNumber: 'asc' }] },
        user: { select: { id: true, email: true } },
        assignments: {
          include: {
            group: { select: { id: true, code: true } },
            semesterItem: {
              include: {
                curriculumItem: { select: { id: true, code: true, name: true } },
                semester: { select: { id: true, number: true } },
              },
            },
          },
        },
      },
    });
    if (!teacher) throw new NotFoundException('Преподаватель не найден');
    return teacher;
  }

  async create(dto: CreateTeacherDto, actor: AuthUser) {
    this.checkPreferred(dto.preferredStartLesson, dto.preferredEndLesson);
    const created = await this.prisma.teacher.create({
      data: { ...dto, fullName: dto.fullName.trim(), organizationId: actor.organizationId },
    });
    await this.audit.log(actor.id, 'CREATE', 'Teacher', created.id, null, created);
    return created;
  }

  async update(id: string, dto: UpdateTeacherDto, actor: AuthUser) {
    const before = await this.get(id, actor);
    this.checkPreferred(
      dto.preferredStartLesson ?? before.preferredStartLesson,
      dto.preferredEndLesson ?? before.preferredEndLesson,
    );
    const updated = await this.prisma.teacher.update({
      where: { id },
      data: { ...dto, fullName: dto.fullName?.trim() },
    });
    await this.audit.log(actor.id, 'UPDATE', 'Teacher', id, before, updated);
    return updated;
  }

  async remove(id: string, actor: AuthUser) {
    const before = await this.get(id, actor);
    const lessons = await this.prisma.scheduleLesson.count({ where: { teacherId: id } });
    if (lessons > 0) {
      throw new ConflictException('Нельзя удалить преподавателя, у которого есть занятия. Сделайте его неактивным');
    }
    await this.prisma.teacher.delete({ where: { id } });
    await this.audit.log(actor.id, 'DELETE', 'Teacher', id, before, null);
    return { success: true };
  }

  async getAvailability(id: string, actor: AuthUser) {
    await this.get(id, actor);
    return this.prisma.teacherAvailability.findMany({
      where: { teacherId: id },
      orderBy: [{ weekday: 'asc' }, { lessonNumber: 'asc' }],
    });
  }

  async replaceAvailability(id: string, dto: ReplaceAvailabilityDto, actor: AuthUser) {
    const before = await this.getAvailability(id, actor);
    const keys = dto.items.map((i) => `${i.weekday}-${i.lessonNumber}`);
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException('Слоты доступности не должны повторяться');
    }
    // Храним только отличия от значения по умолчанию (доступен, без предпочтений)
    const items = dto.items.filter((i) => !i.isAvailable || (i.preferenceWeight ?? 0) !== 0 || i.reason);
    await this.prisma.$transaction([
      this.prisma.teacherAvailability.deleteMany({ where: { teacherId: id } }),
      this.prisma.teacherAvailability.createMany({
        data: items.map((i) => ({
          teacherId: id,
          weekday: i.weekday,
          lessonNumber: i.lessonNumber,
          isAvailable: i.isAvailable,
          preferenceWeight: i.preferenceWeight ?? 0,
          reason: i.reason,
        })),
      }),
    ]);
    await this.audit.log(actor.id, 'UPDATE', 'TeacherAvailability', id, before, items);
    return this.getAvailability(id, actor);
  }

  private checkPreferred(start?: number, end?: number) {
    if (start && end && start > end) {
      throw new BadRequestException('Первая предпочтительная пара не может быть позже последней');
    }
  }
}
