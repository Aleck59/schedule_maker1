import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, WeekParity } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { addDaysStr, parseDate, toDateStr } from '../common/utils/dates';
import { AvailabilityRuleLike, describeRule, TeacherRules } from '../planning/availability-rules';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AvailabilityRuleDto, UpdateAvailabilityRuleDto } from './dto/availability-rule.dto';

/** Гибкие правила доступности преподавателя */
@Injectable()
export class AvailabilityRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private async ensureTeacher(teacherId: string, actor: AuthUser) {
    const teacher = await this.prisma.teacher.findFirst({
      where: { id: teacherId, organizationId: actor.organizationId },
    });
    if (!teacher) throw new NotFoundException('Преподаватель не найден');
    return teacher;
  }

  private data(dto: AvailabilityRuleDto | UpdateAvailabilityRuleDto) {
    if (dto.timeFrom && dto.timeTo && dto.timeFrom >= dto.timeTo) {
      throw new BadRequestException('Начало интервала времени должно быть раньше окончания');
    }
    if (dto.validFrom && dto.validTo && dto.validFrom > dto.validTo) {
      throw new BadRequestException('Дата начала действия правила позже даты окончания');
    }
    const data: Prisma.TeacherAvailabilityRuleUncheckedUpdateInput = {};
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.weekdays !== undefined) data.weekdays = [...dto.weekdays].sort((a, b) => a - b);
    if (dto.lessonNumbers !== undefined) data.lessonNumbers = [...dto.lessonNumbers].sort((a, b) => a - b);
    if (dto.timeFrom !== undefined) data.timeFrom = dto.timeFrom || null;
    if (dto.timeTo !== undefined) data.timeTo = dto.timeTo || null;
    if (dto.parity !== undefined) data.parity = dto.parity;
    if (dto.monthWeeks !== undefined) data.monthWeeks = dto.monthWeeks;
    if (dto.validFrom !== undefined) data.validFrom = dto.validFrom ? parseDate(dto.validFrom) : null;
    if (dto.validTo !== undefined) data.validTo = dto.validTo ? parseDate(dto.validTo) : null;
    if (dto.weight !== undefined) data.weight = dto.weight;
    if (dto.note !== undefined) data.note = dto.note?.trim() || null;
    return data;
  }

  async list(teacherId: string, actor: AuthUser) {
    await this.ensureTeacher(teacherId, actor);
    const { lessonTimes } = await this.settings.getEffective(actor.organizationId);
    const rules = await this.prisma.teacherAvailabilityRule.findMany({
      where: { teacherId },
      orderBy: { createdAt: 'asc' },
    });
    return rules.map((r) => ({ ...r, description: describeRule(r, lessonTimes) }));
  }

  async create(teacherId: string, dto: AvailabilityRuleDto, actor: AuthUser) {
    await this.ensureTeacher(teacherId, actor);
    const rule = await this.prisma.teacherAvailabilityRule.create({
      data: {
        ...(this.data(dto) as Prisma.TeacherAvailabilityRuleUncheckedCreateInput),
        teacherId,
        kind: dto.kind,
      },
    });
    await this.audit.log(actor.id, 'CREATE', 'TeacherAvailabilityRule', rule.id, null, rule);
    return rule;
  }

  async update(teacherId: string, ruleId: string, dto: UpdateAvailabilityRuleDto, actor: AuthUser) {
    await this.ensureTeacher(teacherId, actor);
    const before = await this.prisma.teacherAvailabilityRule.findFirst({ where: { id: ruleId, teacherId } });
    if (!before) throw new NotFoundException('Правило не найдено');
    const merged = {
      timeFrom: dto.timeFrom !== undefined ? dto.timeFrom : before.timeFrom,
      timeTo: dto.timeTo !== undefined ? dto.timeTo : before.timeTo,
      validFrom:
        dto.validFrom !== undefined ? dto.validFrom : before.validFrom && toDateStr(before.validFrom),
      validTo: dto.validTo !== undefined ? dto.validTo : before.validTo && toDateStr(before.validTo),
    };
    this.data(merged);
    const rule = await this.prisma.teacherAvailabilityRule.update({
      where: { id: ruleId },
      data: this.data(dto),
    });
    await this.audit.log(actor.id, 'UPDATE', 'TeacherAvailabilityRule', ruleId, before, rule);
    return rule;
  }

  async remove(teacherId: string, ruleId: string, actor: AuthUser) {
    await this.ensureTeacher(teacherId, actor);
    const before = await this.prisma.teacherAvailabilityRule.findFirst({ where: { id: ruleId, teacherId } });
    if (!before) throw new NotFoundException('Правило не найдено');
    await this.prisma.teacherAvailabilityRule.delete({ where: { id: ruleId } });
    await this.audit.log(actor.id, 'DELETE', 'TeacherAvailabilityRule', ruleId, before, null);
    return { success: true };
  }

  /** Описание правила и ближайшие даты, к которым оно применяется (до сохранения) */
  async preview(teacherId: string, dto: AvailabilityRuleDto, actor: AuthUser, from?: string) {
    await this.ensureTeacher(teacherId, actor);
    this.data(dto);
    const settings = await this.settings.getEffective(actor.organizationId);
    const rule: AvailabilityRuleLike = {
      id: 'preview',
      kind: dto.kind,
      weekdays: dto.weekdays ?? [],
      lessonNumbers: dto.lessonNumbers ?? [],
      timeFrom: dto.timeFrom ?? null,
      timeTo: dto.timeTo ?? null,
      parity: dto.parity ?? WeekParity.ANY,
      monthWeeks: dto.monthWeeks ?? [],
      validFrom: dto.validFrom ?? null,
      validTo: dto.validTo ?? null,
      weight: dto.weight ?? 5,
      note: dto.note ?? null,
    };
    const rules = new TeacherRules([rule], settings.lessonTimes);
    const start = from ?? toDateStr(new Date());
    const dates: Array<{ date: string; lessons: number[] }> = [];
    for (let i = 0; i < 400 && dates.length < 12; i++) {
      const date = addDaysStr(start, i);
      if (!settings.workingDays.includes(((parseDate(date).getUTCDay() + 6) % 7) + 1)) continue;
      const lessons: number[] = [];
      for (let lesson = 1; lesson <= settings.lessonsPerDay; lesson++) {
        const v = rules.evaluate(date, lesson);
        const hit =
          rule.kind === 'AVAILABLE_ONLY'
            ? !v.blocked
            : rule.kind === 'ONLINE'
              ? v.online
              : rule.kind === 'UNAVAILABLE'
                ? v.blocked
                : v.weight !== 0;
        if (hit) lessons.push(lesson);
      }
      if (lessons.length) dates.push({ date, lessons });
    }
    return { description: describeRule(rule, settings.lessonTimes), dates };
  }
}
