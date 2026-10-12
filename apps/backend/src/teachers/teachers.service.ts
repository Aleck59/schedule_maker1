import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ReplaceAvailabilityDto } from '../common/dto/availability.dto';
import { AuthUser } from '../common/types/auth-user';
import { parseDate, toDateStr } from '../common/utils/dates';
import { allowedLevels } from '../common/utils/teacher-levels';
import { ACTIVE_STATUSES } from '../planning/hours-calculator';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTeacherDto, UpdateTeacherDto } from './dto/teachers.dto';

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_MAX_BYTES = 3 * 1024 * 1024;

@Injectable()
export class TeachersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, params: { search?: string; department?: string; isActive?: boolean }) {
    const teachers = await this.prisma.teacher.findMany({
      where: {
        organizationId: actor.organizationId,
        isActive: params.isActive,
        department: params.department || undefined,
        fullName: params.search ? { contains: params.search, mode: 'insensitive' } : undefined,
      },
      omit: { photo: true },
      include: {
        _count: { select: { assignments: true, availability: true, availabilityRules: true } },
        user: { select: { id: true, email: true } },
        assignments: {
          select: {
            studentGroupId: true,
            semesterItem: { select: { curriculumItem: { select: { name: true } } } },
            group: { select: { program: { select: { specialty: { select: { educationLevel: true } } } } } },
          },
        },
      },
      orderBy: { fullName: 'asc' },
    });
    return teachers.map(({ assignments, ...t }) => ({
      ...t,
      allowedLevels: allowedLevels(t),
      // Сводка для плитки: дисциплины, группы и уровни, на которых преподаватель уже ведёт занятия
      disciplines: [...new Set(assignments.map((a) => a.semesterItem.curriculumItem.name))].sort(),
      groupsCount: new Set(assignments.map((a) => a.studentGroupId)).size,
      teachingLevels: [...new Set(assignments.map((a) => a.group.program.specialty.educationLevel))],
    }));
  }

  async get(id: string, actor: AuthUser) {
    const teacher = await this.prisma.teacher.findFirst({
      where: { id, organizationId: actor.organizationId },
      omit: { photo: true },
      include: {
        availability: { orderBy: [{ weekday: 'asc' }, { lessonNumber: 'asc' }] },
        user: { select: { id: true, email: true } },
        assignments: {
          include: {
            group: {
              select: {
                id: true,
                code: true,
                program: {
                  select: { title: true, studyForm: true, specialty: { select: { educationLevel: true } } },
                },
              },
            },
            semesterItem: {
              include: {
                curriculumItem: { select: { id: true, code: true, name: true } },
                semester: { select: { id: true, number: true, startDate: true, endDate: true } },
              },
            },
          },
        },
      },
    });
    if (!teacher) throw new NotFoundException('Преподаватель не найден');
    // Занятия вне периода работы — их нужно передать другому преподавателю
    const outside = [
      ...(teacher.employedFrom ? [{ date: { lt: teacher.employedFrom } }] : []),
      ...(teacher.employedTo ? [{ date: { gt: teacher.employedTo } }] : []),
    ];
    const lessonsOutsideEmployment = outside.length
      ? await this.prisma.scheduleLesson.count({
          where: { teacherId: id, status: { in: ACTIVE_STATUSES }, OR: outside },
        })
      : 0;
    return { ...teacher, allowedLevels: allowedLevels(teacher), lessonsOutsideEmployment };
  }

  private toData<T extends UpdateTeacherDto>(dto: T) {
    const date = (v: string | null | undefined) =>
      v === undefined ? undefined : v === null ? null : parseDate(v);
    return { ...dto, employedFrom: date(dto.employedFrom), employedTo: date(dto.employedTo) };
  }

  private checkEmployment(from?: string | null, to?: string | null) {
    if (from && to && from > to) {
      throw new BadRequestException('Дата окончания работы раньше даты начала');
    }
  }

  /** Фотография преподавателя */
  async photo(id: string, actor: AuthUser) {
    const t = await this.prisma.teacher.findFirst({
      where: { id, organizationId: actor.organizationId },
      select: { photo: true, photoMime: true },
    });
    if (!t?.photo) throw new NotFoundException('Фотография не загружена');
    return { data: Buffer.from(t.photo), mime: t.photoMime ?? 'image/jpeg' };
  }

  async setPhoto(id: string, file: Express.Multer.File | undefined, actor: AuthUser) {
    await this.get(id, actor);
    if (!file) throw new BadRequestException('Выберите файл с фотографией');
    if (!PHOTO_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Фотография должна быть в формате JPEG, PNG или WebP');
    }
    if (file.size > PHOTO_MAX_BYTES) throw new BadRequestException('Фотография больше 3 МБ — уменьшите её');
    await this.prisma.teacher.update({
      where: { id },
      data: { photo: new Uint8Array(file.buffer), photoMime: file.mimetype, photoUpdatedAt: new Date() },
    });
    await this.audit.log(actor.id, 'UPDATE', 'TeacherPhoto', id, null, { size: file.size });
    return this.get(id, actor);
  }

  async removePhoto(id: string, actor: AuthUser) {
    await this.get(id, actor);
    await this.prisma.teacher.update({
      where: { id },
      data: { photo: null, photoMime: null, photoUpdatedAt: null },
    });
    return this.get(id, actor);
  }

  async create(dto: CreateTeacherDto, actor: AuthUser) {
    this.checkPreferred(dto.preferredStartLesson, dto.preferredEndLesson);
    this.checkEmployment(dto.employedFrom, dto.employedTo);
    const created = await this.prisma.teacher.create({
      data: { ...this.toData(dto), fullName: dto.fullName.trim(), organizationId: actor.organizationId },
      omit: { photo: true },
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
    this.checkEmployment(
      dto.employedFrom === undefined
        ? before.employedFrom && toDateStr(before.employedFrom)
        : dto.employedFrom,
      dto.employedTo === undefined ? before.employedTo && toDateStr(before.employedTo) : dto.employedTo,
    );
    const updated = await this.prisma.teacher.update({
      where: { id },
      data: { ...this.toData(dto), fullName: dto.fullName?.trim() },
      omit: { photo: true },
    });
    await this.audit.log(actor.id, 'UPDATE', 'Teacher', id, before, updated);
    return updated;
  }

  async remove(id: string, actor: AuthUser) {
    const before = await this.get(id, actor);
    const lessons = await this.prisma.scheduleLesson.count({ where: { teacherId: id } });
    if (lessons > 0) {
      throw new ConflictException(
        'Нельзя удалить преподавателя, у которого есть занятия. Сделайте его неактивным',
      );
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
