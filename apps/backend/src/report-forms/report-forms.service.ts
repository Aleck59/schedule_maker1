import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EducationLevel, LessonStatus, Prisma, SchedulePeriodStatus } from '@prisma/client';
import { AuthUser } from '../common/types/auth-user';
import {
  addDaysStr,
  diffDays,
  eachDay,
  formatDateRu,
  isoWeekday,
  parseDate,
  toDateStr,
  todayInTimezone,
  weekStart,
} from '../common/utils/dates';
import { normalizePrintForm } from '../export/schedule-form';
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
import {
  FormError,
  PARAM_KEYS,
  parseFormContent,
  renderForm,
  ReportFormContent,
  RenderedSheet,
} from './report-form';
import {
  BlankLayout,
  buildScheduleBlank,
  buildWeekFields,
  isWeekSlotField,
  SCHEDULE_WEEK_FIELDS,
  SCHEDULE_WEEK_INFO,
  SCHEDULE_WEEK_SOURCE,
  WeekLesson,
  WeekMeta,
} from './schedule-week';

/** Свободная пара, отсутствующий день или группа — пустая ячейка */
const weekFallback = (name: string) => (isWeekSlotField(name) || /^(g|d)\d+\./.test(name) ? '' : undefined);

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
      sources: [
        ...REPORT_TYPES.map((t) => ({
          type: t.type,
          title: t.title,
          description: t.description,
          params: t.params,
          columns: REPORT_COLUMNS[t.type] ?? [],
          fields: [] as Array<{ key: string; label: string }>,
        })),
        { ...SCHEDULE_WEEK_INFO, columns: [], fields: SCHEDULE_WEEK_FIELDS },
      ],
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
      return parseFormContent(raw, [...REPORT_TYPES.map((t) => t.type), SCHEDULE_WEEK_SOURCE]);
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
    const params: ReportParams & { groupIds?: string } = { ...form.params };
    for (const k of PARAM_KEYS) {
      const v = rawParams?.[k];
      if (typeof v === 'string') {
        if (v.trim()) params[k] = v.trim();
        else delete params[k];
      }
    }
    if (form.dataSource === SCHEDULE_WEEK_SOURCE) {
      const week = await this.weekFields(params, user);
      const fields = { ...(await this.fields(params, null, user)), ...week.fields };
      return {
        sheet: renderForm(form, { fields, table: null, fallback: weekFallback }),
        title: week.title,
      };
    }
    const table: ReportTable | null = form.dataSource
      ? await this.reports.build(form.dataSource, params, user)
      : null;
    const fields = await this.fields(params, table, user);
    return { sheet: renderForm(form, { fields, table }), title: table?.title ?? 'Отчёт' };
  }

  /** Группы для бланка: из параметра groupIds (порядок сохраняется) */
  private async weekGroups(groupIds: string | undefined, user: AuthUser) {
    const ids = (groupIds ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 12);
    if (!ids.length) throw new BadRequestException('Выберите группы для бланка расписания');
    const found = await this.prisma.studentGroup.findMany({
      where: { id: { in: ids }, program: { organizationId: user.organizationId } },
      include: { program: { include: { specialty: true, academicYears: true } } },
    });
    return ids.map((id) => found.find((g) => g.id === id)).filter((g): g is (typeof found)[number] => !!g);
  }

  /** Поля бланка «Расписание недели по группам» */
  private async weekFields(params: ReportParams & { groupIds?: string }, user: AuthUser) {
    const settings = await this.settings.getEffective(user.organizationId);
    const today = todayInTimezone(settings.timezone);
    const monday = weekStart(params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from) ? params.from : today);
    const days = eachDay(monday, addDaysStr(monday, 6)).filter((d) =>
      settings.workingDays.includes(isoWeekday(d)),
    );
    const groups = await this.weekGroups(params.groupIds, user);
    const range = { gte: parseDate(monday), lte: parseDate(addDaysStr(monday, 6)) };
    const raw = await this.prisma.scheduleLesson.findMany({
      where: {
        studentGroupId: { in: groups.map((g) => g.id) },
        schedulePeriod: {
          organizationId: user.organizationId,
          status: { not: SchedulePeriodStatus.ARCHIVED },
        },
        date: range,
        status: { notIn: [LessonStatus.CANCELLED, LessonStatus.MOVED] },
      },
      include: {
        schedulePeriod: { select: { status: true } },
        semesterItem: { select: { curriculumItem: { select: { name: true } } } },
        teacher: { select: { fullName: true } },
        classroom: { select: { code: true } },
      },
    });
    // Опубликованное расписание группы важнее черновика
    const published = new Set(
      raw
        .filter((l) => l.schedulePeriod.status === SchedulePeriodStatus.PUBLISHED)
        .map((l) => l.studentGroupId),
    );
    const lessons: WeekLesson[] = raw
      .filter(
        (l) => !published.has(l.studentGroupId) || l.schedulePeriod.status === SchedulePeriodStatus.PUBLISHED,
      )
      .map((l) => ({
        groupId: l.studentGroupId,
        date: toDateStr(l.date),
        lessonNumber: l.lessonNumber,
        subgroupNumber: l.subgroupNumber,
        subject: l.semesterItem.curriculumItem.name,
        teacher: l.teacher?.fullName ?? null,
        room: l.classroom?.code ?? null,
        lessonType: l.lessonType,
      }));
    const print = normalizePrintForm(settings.printFormJson);
    const g0 = groups[0];
    const year = g0?.program.academicYears.find(
      (y) => toDateStr(y.startDate) <= monday && toDateStr(y.endDate) >= monday,
    );
    const meta: WeekMeta | null = g0
      ? {
          specialtyCode: g0.program.specialty.code,
          specialtyName: g0.program.specialty.name,
          higherEducation: g0.program.specialty.educationLevel !== EducationLevel.SPO,
          profile: print.profiles[g0.program.specialtyId] ?? null,
          studyForm: g0.program.studyForm,
          educationBase: g0.program.educationBase,
          academicYear: year?.title.replace('–', '-') ?? null,
          weekNumber: year
            ? Math.floor(diffDays(monday, weekStart(toDateStr(year.startDate))) / 7) + 1
            : null,
        }
      : null;
    const fields = buildWeekFields({
      meta,
      groups: groups.map((g) => ({
        id: g.id,
        code: g.code,
        courseNumber: g.courseNumber,
        semesterNumber: g.currentSemesterNumber,
      })),
      days,
      lessons,
      lessonTimes: settings.lessonTimes,
      print,
    });
    const title = meta
      ? `Расписание ${meta.specialtyCode} ${groups.map((g) => g.code).join(', ')}`
      : 'Расписание';
    return { fields, title };
  }

  /** Готовый бланк расписания для выбранных групп */
  async scheduleBlank(
    dto: { groupIds: string[]; layout?: string; pairs?: number; approvals?: number },
    user: AuthUser,
  ): Promise<ReportFormContent> {
    const groups = await this.weekGroups(dto.groupIds.join(','), user);
    const settings = await this.settings.getEffective(user.organizationId);
    const print = normalizePrintForm(settings.printFormJson);
    const layout: BlankLayout = dto.layout === 'types' || dto.layout === 'header-room' ? dto.layout : 'rooms';
    return buildScheduleBlank({
      groups: groups.map((g) => ({
        id: g.id,
        code: g.code,
        courseNumber: g.courseNumber,
        semesterNumber: g.currentSemesterNumber,
      })),
      layout,
      pairs: Math.min(8, Math.max(1, dto.pairs ?? Math.min(4, settings.lessonsPerDay))),
      days: Math.max(1, Math.min(7, settings.workingDays.length)),
      approvals: Math.min(3, Math.max(1, dto.approvals ?? Math.max(2, print.approvals.length))),
    });
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
