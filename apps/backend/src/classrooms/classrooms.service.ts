import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ClassroomType, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { ReplaceAvailabilityDto } from '../common/dto/availability.dto';
import { AuthUser } from '../common/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClassroomDto, UpdateClassroomDto } from './dto/classrooms.dto';

@Injectable()
export class ClassroomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(
    actor: AuthUser,
    params: { type?: ClassroomType; building?: string; isActive?: boolean; minCapacity?: number; search?: string },
  ) {
    return this.prisma.classroom.findMany({
      where: {
        organizationId: actor.organizationId,
        classroomType: params.type || undefined,
        building: params.building || undefined,
        isActive: params.isActive,
        capacity: params.minCapacity ? { gte: params.minCapacity } : undefined,
        OR: params.search
          ? [
              { code: { contains: params.search, mode: 'insensitive' } },
              { name: { contains: params.search, mode: 'insensitive' } },
            ]
          : undefined,
      },
      include: { _count: { select: { availability: true } } },
      orderBy: [{ building: 'asc' }, { code: 'asc' }],
    });
  }

  async get(id: string, actor: AuthUser) {
    const classroom = await this.prisma.classroom.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: { availability: { orderBy: [{ weekday: 'asc' }, { lessonNumber: 'asc' }] } },
    });
    if (!classroom) throw new NotFoundException('Аудитория не найдена');
    return classroom;
  }

  async create(dto: CreateClassroomDto, actor: AuthUser) {
    const created = await this.prisma.classroom.create({
      data: {
        ...dto,
        code: dto.code.trim(),
        equipmentJson: (dto.equipmentJson ?? undefined) as Prisma.InputJsonValue | undefined,
        organizationId: actor.organizationId,
      },
    });
    await this.audit.log(actor.id, 'CREATE', 'Classroom', created.id, null, created);
    return created;
  }

  async update(id: string, dto: UpdateClassroomDto, actor: AuthUser) {
    const before = await this.get(id, actor);
    const updated = await this.prisma.classroom.update({
      where: { id },
      data: {
        ...dto,
        code: dto.code?.trim(),
        equipmentJson: (dto.equipmentJson ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    await this.audit.log(actor.id, 'UPDATE', 'Classroom', id, before, updated);
    return updated;
  }

  async remove(id: string, actor: AuthUser) {
    const before = await this.get(id, actor);
    const lessons = await this.prisma.scheduleLesson.count({ where: { classroomId: id } });
    if (lessons > 0) {
      throw new ConflictException('Нельзя удалить аудиторию, в которой есть занятия. Сделайте её неактивной');
    }
    await this.prisma.classroom.delete({ where: { id } });
    await this.audit.log(actor.id, 'DELETE', 'Classroom', id, before, null);
    return { success: true };
  }

  async getAvailability(id: string, actor: AuthUser) {
    await this.get(id, actor);
    return this.prisma.classroomAvailability.findMany({
      where: { classroomId: id },
      orderBy: [{ weekday: 'asc' }, { lessonNumber: 'asc' }],
    });
  }

  async replaceAvailability(id: string, dto: ReplaceAvailabilityDto, actor: AuthUser) {
    const before = await this.getAvailability(id, actor);
    const keys = dto.items.map((i) => `${i.weekday}-${i.lessonNumber}`);
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException('Слоты доступности не должны повторяться');
    }
    const items = dto.items.filter((i) => !i.isAvailable || i.reason);
    await this.prisma.$transaction([
      this.prisma.classroomAvailability.deleteMany({ where: { classroomId: id } }),
      this.prisma.classroomAvailability.createMany({
        data: items.map((i) => ({
          classroomId: id,
          weekday: i.weekday,
          lessonNumber: i.lessonNumber,
          isAvailable: i.isAvailable,
          reason: i.reason,
        })),
      }),
    ]);
    await this.audit.log(actor.id, 'UPDATE', 'ClassroomAvailability', id, before, items);
    return this.getAvailability(id, actor);
  }

  async buildings(actor: AuthUser) {
    const rows = await this.prisma.classroom.findMany({
      where: { organizationId: actor.organizationId, building: { not: null } },
      distinct: ['building'],
      select: { building: true },
      orderBy: { building: 'asc' },
    });
    return rows.map((r) => r.building).filter(Boolean);
  }
}
