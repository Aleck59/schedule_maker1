import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../common/types/auth-user';
import { formatDateRu, todayInTimezone } from '../common/utils/dates';
import { PrismaService } from '../prisma/prisma.service';
import {
  REPORT_COLUMNS,
  REPORT_TYPES,
  ReportParams,
  ReportsService,
  ReportTable,
} from '../reports/reports.service';
import { SettingsService } from '../settings/settings.service';
import { SaveReportFormDto } from './dto/report-form.dto';
import { FormError, parseFormContent, renderForm, ReportFormContent, RenderedSheet } from './report-form';

const PARAM_KEYS = ['from', 'to', 'programId', 'semesterId', 'groupId', 'teacherId', 'classroomId'] as const;

/** Общие поля, доступные в любой форме (для подсказок редактора) */
export const COMMON_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'org.name', label: 'Организация' },
  { key: 'org.shortName', label: 'Организация (кратко)' },
  { key: 'org.address', label: 'Адрес организации' },
  { key: 'today', label: 'Сегодняшняя дата' },
  { key: 'year', label: 'Текущий год' },
  { key: 'user.name', label: 'Кто сформировал' },
  { key: 'param.from', label: 'Период: с' },
  { key: 'param.to', label: 'Период: по' },
  { key: 'param.group', label: 'Группа (параметр)' },
  { key: 'param.teacher', label: 'Преподаватель (параметр)' },
  { key: 'param.classroom', label: 'Аудитория (параметр)' },
  { key: 'param.program', label: 'Учебный план (параметр)' },
  { key: 'param.semester', label: 'Семестр (параметр)' },
  { key: 'report.title', label: 'Заголовок отчёта-источника' },
  { key: 'report.subtitle', label: 'Подзаголовок (период) источника' },
  { key: 'count', label: 'Число строк данных' },
];

@Injectable()
export class ReportFormsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly settings: SettingsService,
  ) {}

  /** Источники данных и их поля — для панели полей редактора */
  sources() {
    return {
      common: COMMON_FIELDS,
      sources: REPORT_TYPES.map((t) => ({
        type: t.type,
        title: t.title,
        description: t.description,
        params: t.params,
        columns: REPORT_COLUMNS[t.type] ?? [],
      })),
    };
  }

  list(user: AuthUser) {
    return this.prisma.reportForm.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, name: true, description: true, dataSource: true, createdAt: true, updatedAt: true },
      orderBy: { name: 'asc' },
    });
  }

  async get(id: string, user: AuthUser) {
    const form = await this.prisma.reportForm.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!form) throw new NotFoundException('Форма отчёта не найдена');
    return form;
  }

  async create(dto: SaveReportFormDto, user: AuthUser) {
    const content = this.parse(dto.content);
    return this.prisma.reportForm.create({
      data: {
        organizationId: user.organizationId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        dataSource: content.dataSource,
        content: content as unknown as Prisma.InputJsonValue,
        createdById: user.id,
      },
    });
  }

  async update(id: string, dto: SaveReportFormDto, user: AuthUser) {
    await this.get(id, user);
    const content = this.parse(dto.content);
    return this.prisma.reportForm.update({
      where: { id },
      data: {
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        dataSource: content.dataSource,
        content: content as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async remove(id: string, user: AuthUser) {
    await this.get(id, user);
    await this.prisma.reportForm.delete({ where: { id } });
    return { ok: true };
  }

  parse(raw: unknown): ReportFormContent {
    try {
      return parseFormContent(
        raw,
        REPORT_TYPES.map((t) => t.type),
      );
    } catch (e) {
      if (e instanceof FormError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  /** Заполнение формы данными источника */
  async render(
    rawContent: unknown,
    rawParams: Record<string, unknown> | undefined,
    user: AuthUser,
  ): Promise<{ sheet: RenderedSheet; title: string }> {
    const form = this.parse(rawContent);
    const params: ReportParams = { ...form.params };
    for (const k of PARAM_KEYS) {
      const v = rawParams?.[k];
      if (typeof v === 'string') {
        if (v.trim()) params[k] = v.trim();
        else delete params[k];
      }
    }
    const table: ReportTable | null = form.dataSource
      ? await this.reports.build(form.dataSource, params, user)
      : null;
    const fields = await this.fields(params, table, user);
    return { sheet: renderForm(form, { fields, table }), title: table?.title ?? 'Отчёт' };
  }

  private async fields(params: ReportParams, table: ReportTable | null, user: AuthUser) {
    const org = user.organizationId;
    const [organization, settings, group, teacher, classroom, program, semester] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: org } }),
      this.settings.getEffective(org),
      params.groupId
        ? this.prisma.studentGroup.findFirst({
            where: { id: params.groupId, program: { organizationId: org } },
          })
        : null,
      params.teacherId
        ? this.prisma.teacher.findFirst({ where: { id: params.teacherId, organizationId: org } })
        : null,
      params.classroomId
        ? this.prisma.classroom.findFirst({ where: { id: params.classroomId, organizationId: org } })
        : null,
      params.programId
        ? this.prisma.educationalProgram.findFirst({ where: { id: params.programId, organizationId: org } })
        : null,
      params.semesterId
        ? this.prisma.semester.findFirst({
            where: { id: params.semesterId, program: { organizationId: org } },
            include: { program: true },
          })
        : null,
    ]);
    const today = todayInTimezone(settings.timezone);
    const fields: Record<string, string | number> = {
      'org.name': organization?.name ?? '',
      'org.shortName': organization?.shortName ?? organization?.name ?? '',
      'org.address': organization?.address ?? '',
      today: formatDateRu(today),
      year: Number(today.slice(0, 4)),
      'user.name': user.fullName,
      'param.from': params.from ? formatDateRu(params.from) : '',
      'param.to': params.to ? formatDateRu(params.to) : '',
      'param.group': group?.code ?? '',
      'param.teacher': teacher?.fullName ?? '',
      'param.classroom': classroom ? `${classroom.code}` : '',
      'param.program': program?.title ?? '',
      'param.semester': semester ? `${semester.number} семестр (${semester.courseNumber} курс)` : '',
      'report.title': table?.title ?? '',
      'report.subtitle': table?.subtitle ?? '',
    };
    return fields;
  }
}
