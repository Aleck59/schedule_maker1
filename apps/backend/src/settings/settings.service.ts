import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LessonTime, OrganizationSettings, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { ReplaceLessonTimesDto, UpdateOrganizationDto, UpdateSettingsDto } from './dto/settings.dto';

/** Веса мягких ограничений генератора по умолчанию */
export const DEFAULT_SOLVER_WEIGHTS: Record<string, number> = {
  groupWindows: 30,
  teacherWindows: 10,
  lateLessons: 8,
  teacherPreference: 6,
  groupDailyOverload: 25,
  difficultLate: 6,
  disciplineWeekly: 5,
  sameDayDiscipline: 3,
  buildingChanges: 15,
  evenDistribution: 10,
};

export const DEFAULT_LESSON_TIMES: Array<{ lessonNumber: number; startTime: string; endTime: string }> = [
  { lessonNumber: 1, startTime: '08:30', endTime: '10:00' },
  { lessonNumber: 2, startTime: '10:10', endTime: '11:40' },
  { lessonNumber: 3, startTime: '12:20', endTime: '13:50' },
  { lessonNumber: 4, startTime: '14:00', endTime: '15:30' },
  { lessonNumber: 5, startTime: '15:40', endTime: '17:10' },
  { lessonNumber: 6, startTime: '17:20', endTime: '18:50' },
];

export interface EffectiveSettings extends OrganizationSettings {
  weights: Record<string, number>;
  timezone: string;
  lessonTimes: LessonTime[];
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getEffective(organizationId: string): Promise<EffectiveSettings> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: { settings: true, lessonTimes: { orderBy: { lessonNumber: 'asc' } } },
    });
    if (!org) throw new NotFoundException('Организация не найдена');
    let settings = org.settings;
    if (!settings) {
      settings = await this.prisma.organizationSettings.create({ data: { organizationId } });
    }
    let lessonTimes = org.lessonTimes;
    if (lessonTimes.length === 0) {
      await this.prisma.lessonTime.createMany({
        data: DEFAULT_LESSON_TIMES.map((t) => ({ ...t, organizationId })),
      });
      lessonTimes = await this.prisma.lessonTime.findMany({
        where: { organizationId },
        orderBy: { lessonNumber: 'asc' },
      });
    }
    const custom = (settings.solverWeightsJson ?? {}) as Record<string, number>;
    return {
      ...settings,
      weights: { ...DEFAULT_SOLVER_WEIGHTS, ...custom },
      timezone: org.timezone,
      lessonTimes,
    };
  }

  /** Время начала/окончания пары по номеру */
  lessonTime(settings: EffectiveSettings, lessonNumber: number): { startTime: string; endTime: string } {
    const t = settings.lessonTimes.find((x) => x.lessonNumber === lessonNumber);
    if (t) return { startTime: t.startTime, endTime: t.endTime };
    // Если звонок не задан — считаем от последнего известного
    const last = settings.lessonTimes[settings.lessonTimes.length - 1];
    const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
    const fmt = (m: number) =>
      `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const base = last ? toMin(last.endTime) + 10 : 8 * 60 + 30;
    const extra = last ? lessonNumber - last.lessonNumber - 1 : lessonNumber - 1;
    const start = base + extra * (settings.lessonDurationMinutes + 10);
    return { startTime: fmt(start), endTime: fmt(start + settings.lessonDurationMinutes) };
  }

  async getAll(organizationId: string) {
    const effective = await this.getEffective(organizationId);
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    const { lessonTimes, weights, timezone: _tz, ...settings } = effective;
    return { organization, settings: { ...settings, weights }, lessonTimes };
  }

  async update(organizationId: string, dto: UpdateSettingsDto, actor: AuthUser) {
    const before = await this.getEffective(organizationId);
    if (dto.lateLessonNumber && dto.lessonsPerDay && dto.lateLessonNumber > dto.lessonsPerDay + 1) {
      throw new BadRequestException('Номер «поздней» пары не может превышать количество пар в день');
    }
    const data: Prisma.OrganizationSettingsUpdateInput = { ...dto } as Prisma.OrganizationSettingsUpdateInput;
    if (dto.workingDays) {
      data.workingDays = Array.from(new Set(dto.workingDays)).sort();
    }
    if (dto.solverWeightsJson) {
      data.solverWeightsJson = dto.solverWeightsJson as Prisma.InputJsonValue;
    }
    const updated = await this.prisma.organizationSettings.update({ where: { organizationId }, data });
    await this.audit.log(actor.id, 'UPDATE', 'OrganizationSettings', updated.id, before, updated);
    return this.getAll(organizationId);
  }

  async updateOrganization(organizationId: string, dto: UpdateOrganizationDto, actor: AuthUser) {
    if (dto.timezone) {
      try {
        new Intl.DateTimeFormat('ru-RU', { timeZone: dto.timezone });
      } catch {
        throw new BadRequestException('Неизвестный часовой пояс');
      }
    }
    const before = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    const org = await this.prisma.organization.update({ where: { id: organizationId }, data: dto });
    await this.audit.log(actor.id, 'UPDATE', 'Organization', org.id, before, org);
    return org;
  }

  async replaceLessonTimes(organizationId: string, dto: ReplaceLessonTimesDto, actor: AuthUser) {
    const numbers = dto.items.map((i) => i.lessonNumber);
    if (new Set(numbers).size !== numbers.length) {
      throw new BadRequestException('Номера пар в расписании звонков не должны повторяться');
    }
    for (const item of dto.items) {
      if (item.startTime >= item.endTime) {
        throw new BadRequestException(`Пара №${item.lessonNumber}: время окончания должно быть позже начала`);
      }
    }
    const sorted = [...dto.items].sort((a, b) => a.lessonNumber - b.lessonNumber);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].startTime < sorted[i - 1].endTime) {
        throw new BadRequestException(
          `Пара №${sorted[i].lessonNumber} начинается раньше окончания пары №${sorted[i - 1].lessonNumber}`,
        );
      }
    }
    await this.prisma.$transaction([
      this.prisma.lessonTime.deleteMany({ where: { organizationId } }),
      this.prisma.lessonTime.createMany({ data: sorted.map((t) => ({ ...t, organizationId })) }),
    ]);
    await this.audit.log(actor.id, 'UPDATE', 'LessonTime', organizationId, null, sorted);
    return this.prisma.lessonTime.findMany({ where: { organizationId }, orderBy: { lessonNumber: 'asc' } });
  }
}
