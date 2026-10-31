import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ClassroomType, LessonStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { ReplaceAvailabilityDto } from '../common/dto/availability.dto';
import { AuthUser } from '../common/types/auth-user';
import { addDaysStr, diffDays, eachDay, isoWeekday, parseDate, toDateStr, todayInTimezone, weekStart } from '../common/utils/dates';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CreateClassroomDto, UpdateClassroomDto } from './dto/classrooms.dto';

@Injectable()
export class ClassroomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Тепловая карта занятости всех аудиторий за период.
   * Слот — дата × номер пара; поток (несколько групп в одной аудитории в одну пару) — один занятый слот.
   * grid: «день недели-пара» → сколько дат периода слот занят; byDate: дата → занятых пар в этот день.
   */
  async occupancy(actor: AuthUser, params: { from?: string; to?: string; building?: string }) {
    const settings = await this.settings.getEffective(actor.organizationId);
    const from = params.from ?? weekStart(todayInTimezone(settings.timezone));
    const to = params.to ?? addDaysStr(from, 27);
    if (to < from) throw new BadRequestException('Дата окончания раньше даты начала');
    if (diffDays(to, from) > 370) throw new BadRequestException('Период тепловой карты — не больше года');
    const rooms = await this.prisma.classroom.findMany({
      where: { organizationId: actor.organizationId, building: params.building || undefined },
      orderBy: [{ building: 'asc' }, { code: 'asc' }],
      select: { id: true, code: true, name: true, building: true, floor: true, capacity: true, classroomType: true, isActive: true },
    });
    const lessons = await this.prisma.scheduleLesson.findMany({
      where: {
        schedulePeriod: { organizationId: actor.organizationId },
        classroomId: { in: rooms.map((r) => r.id) },
        date: { gte: parseDate(from), lte: parseDate(to) },
        status: { notIn: [LessonStatus.CANCELLED, LessonStatus.MOVED] },
      },
      select: { classroomId: true, date: true, lessonNumber: true },
    });
    const days = eachDay(from, to).filter((d) => settings.workingDays.includes(isoWeekday(d)));
    const slotsTotal = days.length * settings.lessonsPerDay;
    const used = new Map<string, Set<string>>();
    for (const l of lessons) {
      if (!l.classroomId) continue;
      let set = used.get(l.classroomId);
      if (!set) used.set(l.classroomId, (set = new Set()));
      set.add(`${toDateStr(l.date)}#${l.lessonNumber}`);
    }
    const weekdays = [...new Set(days.map((d) => isoWeekday(d)))].sort();
    const lessonsPerDay = Math.max(
      settings.lessonsPerDay,
      ...lessons.map((l) => l.lessonNumber),
    );
    return {
      range: { from, to },
      days,
      weekdays,
      lessonsPerDay,
      // Сколько раз каждый день недели встречается в периоде (знаменатель для ячейки «день × пара»)
      weekdayCounts: Object.fromEntries(weekdays.map((w) => [w, days.filter((d) => isoWeekday(d) === w).length])),
      rooms: rooms.map((room) => {
        const slots = used.get(room.id) ?? new Set<string>();
        const grid: Record<string, number> = {};
        const byDate: Record<string, number> = {};
        for (const key of slots) {
          const [date, n] = key.split('#');
          const g = `${isoWeekday(date)}-${n}`;
          grid[g] = (grid[g] ?? 0) + 1;
          byDate[date] = (byDate[date] ?? 0) + 1;
        }
        return {
          ...room,
          slotsTotal,
          slotsUsed: slots.size,
          percent: slotsTotal ? Math.round((slots.size / slotsTotal) * 1000) / 10 : 0,
          grid,
          byDate,
        };
      }),
    };
  }

  list(
    actor: AuthUser,
    params: {
      type?: ClassroomType;
      building?: string;
      isActive?: boolean;
      minCapacity?: number;
      search?: string;
    },
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
