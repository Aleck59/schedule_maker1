import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CalendarEventType,
  ConductedStatus,
  ControlForm,
  CurriculumItemType,
  LessonStatus,
  LessonType,
  Prisma,
} from '@prisma/client';
import { AuthUser } from '../common/types/auth-user';
import {
  addDaysStr,
  eachDay,
  formatDateRu,
  isoWeekday,
  parseDate,
  toDateStr,
  todayInTimezone,
  weekStart,
  weekdayName,
} from '../common/utils/dates';
import {
  CANCELLATION_REASON_LABELS,
  CLASSROOM_TYPE_LABELS,
  CONTROL_FORM_LABELS,
  ITEM_TYPE_LABELS,
  LESSON_STATUS_LABELS,
  LESSON_TYPE_LABELS,
} from '../common/utils/labels';
import { HourControlService } from '../hour-control/hour-control.service';
import { ACTIVE_STATUSES } from '../planning/hours-calculator';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleLessonsService } from '../schedule/schedule-lessons.service';
import { SettingsService } from '../settings/settings.service';

export interface ReportColumn {
  key: string;
  header: string;
  width?: number;
  type?: 'text' | 'number' | 'date' | 'percent';
}

export interface ReportTable {
  type: string;
  title: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows: Array<Record<string, string | number | null>>;
  summary?: Array<{ label: string; value: string | number }>;
}

export interface ReportParams {
  from?: string;
  to?: string;
  programId?: string;
  semesterId?: string;
  groupId?: string;
  teacherId?: string;
  classroomId?: string;
  periodId?: string;
}

export const REPORT_TYPES: Array<{ type: string; title: string; description: string; params: string[] }> = [
  {
    type: 'group-schedule',
    title: 'Расписание группы',
    description: 'Занятия группы за период',
    params: ['groupId', 'from', 'to'],
  },
  {
    type: 'teacher-schedule',
    title: 'Расписание преподавателя',
    description: 'Занятия преподавателя за период',
    params: ['teacherId', 'from', 'to'],
  },
  {
    type: 'classroom-schedule',
    title: 'Расписание аудитории',
    description: 'Занятия в аудитории за период',
    params: ['classroomId', 'from', 'to'],
  },
  {
    type: 'teacher-workload',
    title: 'Нагрузка преподавателей',
    description: 'Плановая, в расписании и фактическая нагрузка',
    params: ['semesterId'],
  },
  {
    type: 'plan-execution',
    title: 'Выполнение учебного плана',
    description: 'Часы по группам и дисциплинам: план, расписание, проведено, остаток',
    params: ['programId', 'semesterId', 'groupId'],
  },
  {
    type: 'hour-deficit',
    title: 'Дефицит часов',
    description: 'Дисциплины с дефицитом, риском невыполнения или превышением',
    params: ['programId', 'semesterId'],
  },
  {
    type: 'cancellations',
    title: 'Отменённые занятия',
    description: 'Отмены с причинами и статусом отработки',
    params: ['from', 'to', 'groupId', 'teacherId'],
  },
  {
    type: 'moves',
    title: 'Переносы занятий',
    description: 'Перенесённые занятия: откуда и куда',
    params: ['from', 'to', 'groupId'],
  },
  {
    type: 'substitutions',
    title: 'Замены преподавателей',
    description: 'Замены с причинами',
    params: ['from', 'to', 'teacherId'],
  },
  {
    type: 'practice',
    title: 'Отчёт по практике',
    description: 'Практики учебного плана: периоды, часы, проведение',
    params: ['programId'],
  },
  {
    type: 'assessments',
    title: 'Контрольные мероприятия',
    description: 'Формы контроля, даты экзаменов и зачётов',
    params: ['programId', 'semesterId'],
  },
  {
    type: 'classroom-utilization',
    title: 'Занятость аудиторного фонда',
    description: 'Загрузка аудиторий по слотам',
    params: ['from', 'to'],
  },
];

const HOUR_STATUS_LABELS: Record<string, string> = {
  NORMAL: 'Норма',
  RISK: 'Риск',
  DEFICIT: 'Дефицит',
  EXCESS: 'Превышение',
};

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hours: HourControlService,
    private readonly lessons: ScheduleLessonsService,
    private readonly settings: SettingsService,
  ) {}

  list() {
    return REPORT_TYPES;
  }

  async build(type: string, params: ReportParams, actor: AuthUser): Promise<ReportTable> {
    const settings = await this.settings.getEffective(actor.organizationId);
    const today = todayInTimezone(settings.timezone);
    const from = params.from ?? weekStart(today);
    const to = params.to ?? addDaysStr(from, 6);
    switch (type) {
      case 'group-schedule':
      case 'teacher-schedule':
      case 'classroom-schedule':
        return this.scheduleReport(type, { ...params, from, to }, actor);
      case 'teacher-workload':
        return this.teacherWorkload(params, actor);
      case 'plan-execution':
        return this.planExecution(params, actor, false);
      case 'hour-deficit':
        return this.planExecution(params, actor, true);
      case 'cancellations':
        return this.cancellations(
          { ...params, from: params.from ?? addDaysStr(today, -90), to: params.to ?? today },
          actor,
        );
      case 'moves':
        return this.moves(
          { ...params, from: params.from ?? addDaysStr(today, -90), to: params.to ?? addDaysStr(today, 30) },
          actor,
        );
      case 'substitutions':
        return this.substitutions(
          { ...params, from: params.from ?? addDaysStr(today, -90), to: params.to ?? addDaysStr(today, 30) },
          actor,
        );
      case 'practice':
        return this.practice(params, actor);
      case 'assessments':
        return this.assessments(params, actor);
      case 'classroom-utilization':
        return this.classroomUtilization({ from, to }, actor, settings.lessonsPerDay, settings.workingDays);
      default:
        throw new BadRequestException(`Неизвестный отчёт: ${type}`);
    }
  }

  private async scheduleReport(type: string, params: ReportParams, actor: AuthUser): Promise<ReportTable> {
    const filter =
      type === 'group-schedule'
        ? { groupId: params.groupId }
        : type === 'teacher-schedule'
          ? { teacherId: params.teacherId }
          : { classroomId: params.classroomId };
    if (!Object.values(filter)[0])
      throw new BadRequestException('Не выбран объект отчёта (группа, преподаватель или аудитория)');
    const lessons = await this.lessons.list(
      { ...filter, from: params.from, to: params.to, periodId: params.periodId },
      actor,
    );
    let subject = '';
    if (params.groupId)
      subject = (await this.prisma.studentGroup.findUnique({ where: { id: params.groupId } }))?.code ?? '';
    if (params.teacherId)
      subject = (await this.prisma.teacher.findUnique({ where: { id: params.teacherId } }))?.fullName ?? '';
    if (params.classroomId)
      subject = (await this.prisma.classroom.findUnique({ where: { id: params.classroomId } }))?.code ?? '';
    return {
      type,
      title: `${REPORT_TYPES.find((r) => r.type === type)?.title}: ${subject}`,
      subtitle: `${formatDateRu(params.from!)} — ${formatDateRu(params.to!)}`,
      columns: [
        { key: 'date', header: 'Дата', type: 'date', width: 12 },
        { key: 'weekday', header: 'День', width: 6 },
        { key: 'lesson', header: 'Пара', type: 'number', width: 6 },
        { key: 'time', header: 'Время', width: 12 },
        { key: 'group', header: 'Группа', width: 14 },
        { key: 'discipline', header: 'Дисциплина', width: 40 },
        { key: 'type', header: 'Вид', width: 14 },
        { key: 'teacher', header: 'Преподаватель', width: 28 },
        { key: 'room', header: 'Аудитория', width: 10 },
        { key: 'status', header: 'Статус', width: 14 },
      ],
      rows: lessons.map((l) => ({
        date: l.date,
        weekday: weekdayName(l.weekday, true),
        lesson: l.lessonNumber,
        time: `${l.startTime}–${l.endTime}`,
        group: `${l.studentGroup.code}${l.subgroupNumber ? ` (п/г ${l.subgroupNumber})` : ''}`,
        discipline: `${l.semesterItem.curriculumItem.code} ${l.semesterItem.curriculumItem.name}`,
        type: LESSON_TYPE_LABELS[l.lessonType],
        teacher: l.teacher?.fullName ?? '—',
        room: l.classroom?.code ?? '—',
        status: LESSON_STATUS_LABELS[l.status],
      })),
      summary: [
        { label: 'Всего занятий', value: lessons.length },
        { label: 'Отменено', value: lessons.filter((l) => l.status === LessonStatus.CANCELLED).length },
        {
          label: 'Проведено',
          value: lessons.filter((l) => l.conducted?.status === ConductedStatus.CONDUCTED).length,
        },
      ],
    };
  }

  private async teacherWorkload(params: ReportParams, actor: AuthUser): Promise<ReportTable> {
    const data = await this.hours.allTeachersWorkload(actor.organizationId, params.semesterId);
    return {
      type: 'teacher-workload',
      title: 'Нагрузка преподавателей',
      subtitle: params.semesterId ? 'За выбранный семестр' : 'За все семестры',
      columns: [
        { key: 'teacher', header: 'Преподаватель', width: 30 },
        { key: 'department', header: 'Цикловая комиссия', width: 30 },
        { key: 'planned', header: 'План, ч', type: 'number', width: 10 },
        { key: 'scheduled', header: 'В расписании, ч', type: 'number', width: 12 },
        { key: 'conducted', header: 'Проведено, ч', type: 'number', width: 12 },
        { key: 'substituted', header: 'В т.ч. замены, ч', type: 'number', width: 12 },
        { key: 'percent', header: 'Выполнение', type: 'percent', width: 10 },
        { key: 'week', header: 'Пар на текущей неделе', type: 'number', width: 12 },
        { key: 'limit', header: 'Лимит в неделю', type: 'number', width: 10 },
        { key: 'overload', header: 'Недель с перегрузкой', type: 'number', width: 12 },
        { key: 'groups', header: 'Группы', width: 20 },
      ],
      rows: data.map((t) => ({
        teacher: t.fullName,
        department: t.department ?? '',
        planned: t.planned,
        scheduled: t.scheduled,
        conducted: t.conducted,
        substituted: t.substitutedHours,
        percent: t.planned ? Math.round((t.conducted / t.planned) * 1000) / 10 : 0,
        week: t.currentWeekLessons,
        limit: t.maxWeeklyLessons,
        overload: t.overloadWeeks,
        groups: t.groups.join(', '),
      })),
      summary: [
        { label: 'Преподавателей', value: data.length },
        { label: 'Плановая нагрузка, ч', value: data.reduce((a, t) => a + t.planned, 0) },
        { label: 'Проведено, ч', value: data.reduce((a, t) => a + t.conducted, 0) },
      ],
    };
  }

  private async planExecution(
    params: ReportParams,
    actor: AuthUser,
    onlyProblems: boolean,
  ): Promise<ReportTable> {
    const { rows, summary } = await this.hours.rows({
      organizationId: actor.organizationId,
      programId: params.programId,
      semesterIds: params.semesterId ? [params.semesterId] : undefined,
      groupIds: params.groupId ? [params.groupId] : undefined,
    });
    const filtered = onlyProblems ? rows.filter((r) => r.status !== 'NORMAL') : rows;
    const t = (
      r: (typeof rows)[number],
      type: LessonType,
      field: 'planned' | 'scheduled' | 'conducted' | 'remaining',
    ) => r.byType[type]?.[field] ?? null;
    return {
      type: onlyProblems ? 'hour-deficit' : 'plan-execution',
      title: onlyProblems ? 'Дефицит и превышение часов' : 'Выполнение учебного плана',
      columns: [
        { key: 'group', header: 'Группа', width: 14 },
        { key: 'semester', header: 'Семестр', type: 'number', width: 8 },
        { key: 'discipline', header: 'Дисциплина', width: 40 },
        { key: 'lecPlan', header: 'Лек. план', type: 'number', width: 8 },
        { key: 'lecSch', header: 'Лек. в расп.', type: 'number', width: 8 },
        { key: 'lecDone', header: 'Лек. пров.', type: 'number', width: 8 },
        { key: 'prPlan', header: 'Практ. план', type: 'number', width: 8 },
        { key: 'prSch', header: 'Практ. в расп.', type: 'number', width: 8 },
        { key: 'prDone', header: 'Практ. пров.', type: 'number', width: 8 },
        { key: 'labPlan', header: 'Лаб. план', type: 'number', width: 8 },
        { key: 'labSch', header: 'Лаб. в расп.', type: 'number', width: 8 },
        { key: 'labDone', header: 'Лаб. пров.', type: 'number', width: 8 },
        { key: 'plan', header: 'Всего план', type: 'number', width: 9 },
        { key: 'scheduled', header: 'В расписании', type: 'number', width: 10 },
        { key: 'conducted', header: 'Проведено', type: 'number', width: 10 },
        { key: 'remaining', header: 'Остаток', type: 'number', width: 9 },
        { key: 'deficit', header: 'Дефицит', type: 'number', width: 9 },
        { key: 'excess', header: 'Превышение', type: 'number', width: 10 },
        { key: 'forecast', header: 'Прогноз, %', type: 'percent', width: 10 },
        { key: 'status', header: 'Статус', width: 12 },
      ],
      rows: filtered.map((r) => ({
        group: `${r.groupCode}${r.subgroupNumber ? ` (п/г ${r.subgroupNumber})` : ''}`,
        semester: r.semesterNumber,
        discipline: `${r.itemCode} ${r.itemName}`,
        lecPlan: t(r, LessonType.LECTURE, 'planned'),
        lecSch: t(r, LessonType.LECTURE, 'scheduled'),
        lecDone: t(r, LessonType.LECTURE, 'conducted'),
        prPlan: t(r, LessonType.PRACTICAL, 'planned') ?? t(r, LessonType.PRACTICE, 'planned'),
        prSch: t(r, LessonType.PRACTICAL, 'scheduled') ?? t(r, LessonType.PRACTICE, 'scheduled'),
        prDone: t(r, LessonType.PRACTICAL, 'conducted') ?? t(r, LessonType.PRACTICE, 'conducted'),
        labPlan: t(r, LessonType.LABORATORY, 'planned'),
        labSch: t(r, LessonType.LABORATORY, 'scheduled'),
        labDone: t(r, LessonType.LABORATORY, 'conducted'),
        plan: r.total.planned,
        scheduled: r.total.scheduled,
        conducted: r.total.conducted,
        remaining: r.total.remaining,
        deficit: r.total.scheduleDeficit,
        excess: r.total.excess,
        forecast: r.forecastPercent,
        status: HOUR_STATUS_LABELS[r.status],
      })),
      summary: [
        { label: 'Плановых часов', value: summary.total.planned },
        { label: 'В расписании', value: summary.total.scheduled },
        { label: 'Проведено', value: summary.total.conducted },
        { label: 'Выполнение, %', value: summary.completionPercent },
        { label: 'Дефицит', value: summary.byStatus.DEFICIT },
        { label: 'Риск', value: summary.byStatus.RISK },
        { label: 'Превышение', value: summary.byStatus.EXCESS },
      ],
    };
  }

  private lessonWhere(actor: AuthUser, params: ReportParams): Prisma.ScheduleLessonWhereInput {
    return {
      schedulePeriod: { organizationId: actor.organizationId },
      studentGroupId: params.groupId || undefined,
      date: { gte: parseDate(params.from!), lte: parseDate(params.to!) },
    };
  }

  private async cancellations(params: ReportParams, actor: AuthUser): Promise<ReportTable> {
    const where: Prisma.ScheduleLessonWhereInput = {
      ...this.lessonWhere(actor, params),
      status: LessonStatus.CANCELLED,
    };
    if (params.teacherId) where.teacherId = params.teacherId;
    const lessons = await this.prisma.scheduleLesson.findMany({
      where,
      include: {
        studentGroup: { select: { code: true } },
        semesterItem: { include: { curriculumItem: { select: { code: true, name: true } } } },
        teacher: { select: { fullName: true } },
        conducted: true,
        makeupTasks: { include: { resolvedLesson: { select: { date: true, lessonNumber: true } } } },
      },
      orderBy: [{ date: 'asc' }, { lessonNumber: 'asc' }],
    });
    const statusLabel: Record<string, string> = {
      OPEN: 'Требуется отработка',
      SCHEDULED: 'Отработка назначена',
      DONE: 'Отработано',
      CANCELLED: 'Не требуется',
    };
    return {
      type: 'cancellations',
      title: 'Отменённые занятия',
      subtitle: `${formatDateRu(params.from!)} — ${formatDateRu(params.to!)}`,
      columns: [
        { key: 'date', header: 'Дата', type: 'date', width: 12 },
        { key: 'lesson', header: 'Пара', type: 'number', width: 6 },
        { key: 'group', header: 'Группа', width: 14 },
        { key: 'discipline', header: 'Дисциплина', width: 40 },
        { key: 'teacher', header: 'Преподаватель', width: 28 },
        { key: 'hours', header: 'Часы', type: 'number', width: 6 },
        { key: 'reason', header: 'Причина', width: 26 },
        { key: 'makeup', header: 'Отработка', width: 22 },
        { key: 'makeupDate', header: 'Дата отработки', width: 14 },
      ],
      rows: lessons.map((l) => {
        const task = l.makeupTasks[0];
        return {
          date: toDateStr(l.date),
          lesson: l.lessonNumber,
          group: `${l.studentGroup.code}${l.subgroupNumber ? ` (п/г ${l.subgroupNumber})` : ''}`,
          discipline: `${l.semesterItem.curriculumItem.code} ${l.semesterItem.curriculumItem.name}`,
          teacher: l.teacher?.fullName ?? '—',
          hours: l.academicHours,
          reason: l.conducted?.cancellationReason
            ? CANCELLATION_REASON_LABELS[l.conducted.cancellationReason]
            : '—',
          makeup: task ? statusLabel[task.status] : '—',
          makeupDate: task?.resolvedLesson
            ? `${formatDateRu(task.resolvedLesson.date)}, ${task.resolvedLesson.lessonNumber} пара`
            : '',
        };
      }),
      summary: [
        { label: 'Отменено занятий', value: lessons.length },
        {
          label: 'Часов к отработке',
          value: lessons
            .filter((l) => l.makeupTasks.some((t) => t.status === 'OPEN'))
            .reduce((a, l) => a + l.academicHours, 0),
        },
      ],
    };
  }

  private async moves(params: ReportParams, actor: AuthUser): Promise<ReportTable> {
    const lessons = await this.prisma.scheduleLesson.findMany({
      where: { ...this.lessonWhere(actor, params), status: LessonStatus.MOVED },
      include: {
        studentGroup: { select: { code: true } },
        semesterItem: { include: { curriculumItem: { select: { code: true, name: true } } } },
        teacher: { select: { fullName: true } },
        derivedLessons: { select: { date: true, lessonNumber: true, status: true, notes: true } },
      },
      orderBy: [{ date: 'asc' }, { lessonNumber: 'asc' }],
    });
    return {
      type: 'moves',
      title: 'Переносы занятий',
      subtitle: `${formatDateRu(params.from!)} — ${formatDateRu(params.to!)}`,
      columns: [
        { key: 'fromDate', header: 'Было: дата', type: 'date', width: 12 },
        { key: 'fromLesson', header: 'Было: пара', type: 'number', width: 8 },
        { key: 'toDate', header: 'Стало: дата', type: 'date', width: 12 },
        { key: 'toLesson', header: 'Стало: пара', type: 'number', width: 8 },
        { key: 'group', header: 'Группа', width: 14 },
        { key: 'discipline', header: 'Дисциплина', width: 40 },
        { key: 'teacher', header: 'Преподаватель', width: 28 },
        { key: 'status', header: 'Статус нового занятия', width: 16 },
        { key: 'reason', header: 'Причина', width: 30 },
      ],
      rows: lessons.map((l) => {
        const next = l.derivedLessons[0];
        return {
          fromDate: toDateStr(l.date),
          fromLesson: l.lessonNumber,
          toDate: next ? toDateStr(next.date) : '',
          toLesson: next?.lessonNumber ?? null,
          group: l.studentGroup.code,
          discipline: `${l.semesterItem.curriculumItem.code} ${l.semesterItem.curriculumItem.name}`,
          teacher: l.teacher?.fullName ?? '—',
          status: next ? LESSON_STATUS_LABELS[next.status] : '—',
          reason: next?.notes ?? '',
        };
      }),
      summary: [{ label: 'Перенесено занятий', value: lessons.length }],
    };
  }

  private async substitutions(params: ReportParams, actor: AuthUser): Promise<ReportTable> {
    const subs = await this.prisma.teacherSubstitution.findMany({
      where: {
        scheduleLesson: this.lessonWhere(actor, params),
        OR: params.teacherId
          ? [{ originalTeacherId: params.teacherId }, { substituteTeacherId: params.teacherId }]
          : undefined,
      },
      include: {
        scheduleLesson: {
          include: {
            studentGroup: { select: { code: true } },
            semesterItem: { include: { curriculumItem: { select: { code: true, name: true } } } },
          },
        },
        originalTeacher: { select: { fullName: true } },
        substituteTeacher: { select: { fullName: true } },
        approvedBy: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return {
      type: 'substitutions',
      title: 'Замены преподавателей',
      subtitle: `${formatDateRu(params.from!)} — ${formatDateRu(params.to!)}`,
      columns: [
        { key: 'date', header: 'Дата', type: 'date', width: 12 },
        { key: 'lesson', header: 'Пара', type: 'number', width: 6 },
        { key: 'group', header: 'Группа', width: 14 },
        { key: 'discipline', header: 'Дисциплина', width: 36 },
        { key: 'original', header: 'Преподаватель по расписанию', width: 28 },
        { key: 'substitute', header: 'Заменяющий преподаватель', width: 28 },
        { key: 'reason', header: 'Причина', width: 26 },
        { key: 'approvedBy', header: 'Оформил', width: 24 },
      ],
      rows: subs.map((s) => ({
        date: toDateStr(s.scheduleLesson.date),
        lesson: s.scheduleLesson.lessonNumber,
        group: s.scheduleLesson.studentGroup.code,
        discipline: `${s.scheduleLesson.semesterItem.curriculumItem.code} ${s.scheduleLesson.semesterItem.curriculumItem.name}`,
        original: s.originalTeacher?.fullName ?? '—',
        substitute: s.substituteTeacher.fullName,
        reason: s.reason ?? '',
        approvedBy: s.approvedBy?.fullName ?? '',
      })),
      summary: [{ label: 'Замен', value: subs.length }],
    };
  }

  private async practice(params: ReportParams, actor: AuthUser): Promise<ReportTable> {
    const practiceTypes: CurriculumItemType[] = [
      CurriculumItemType.EDUCATIONAL_PRACTICE,
      CurriculumItemType.INDUSTRIAL_PRACTICE,
      CurriculumItemType.PRE_DIPLOMA_PRACTICE,
    ];
    const items = await this.prisma.semesterCurriculumItem.findMany({
      where: {
        curriculumItem: { itemType: { in: practiceTypes } },
        semester: {
          program: { organizationId: actor.organizationId },
          educationalProgramId: params.programId || undefined,
        },
      },
      include: {
        curriculumItem: true,
        semester: { include: { program: { include: { groups: { where: { isActive: true } } } } } },
        lessons: {
          select: {
            status: true,
            academicHours: true,
            studentGroupId: true,
            conducted: { select: { status: true, actualHours: true } },
          },
        },
      },
      orderBy: [{ semester: { number: 'asc' } }],
    });
    const events = await this.prisma.calendarEvent.findMany({
      where: {
        organizationId: actor.organizationId,
        eventType: {
          in: [
            CalendarEventType.EDUCATIONAL_PRACTICE,
            CalendarEventType.INDUSTRIAL_PRACTICE,
            CalendarEventType.PRE_DIPLOMA_PRACTICE,
          ],
        },
      },
    });
    const rows: ReportTable['rows'] = [];
    for (const item of items) {
      for (const group of item.semester.program.groups) {
        const ev = events.filter(
          (e) =>
            e.eventType === (item.curriculumItem.itemType as unknown as CalendarEventType) &&
            (e.educationalProgramId === item.semester.educationalProgramId ||
              e.studentGroupId === group.id) &&
            toDateStr(e.startDate) <= toDateStr(item.semester.endDate) &&
            toDateStr(e.endDate) >= toDateStr(item.semester.startDate),
        );
        const groupLessons = item.lessons.filter((l) => l.studentGroupId === group.id);
        rows.push({
          group: group.code,
          semester: item.semester.number,
          code: item.curriculumItem.code,
          name: item.curriculumItem.name,
          kind: ITEM_TYPE_LABELS[item.curriculumItem.itemType],
          place: item.practiceAtCollege ? 'На базе колледжа' : 'На предприятии',
          hours: item.practiceAtCollege ? item.practiceHours : item.totalHours,
          period:
            ev.map((e) => `${formatDateRu(e.startDate)}—${formatDateRu(e.endDate)}`).join('; ') || 'не задан',
          scheduled: groupLessons
            .filter((l) => ACTIVE_STATUSES.includes(l.status))
            .reduce((a, l) => a + l.academicHours, 0),
          conducted: groupLessons
            .filter((l) => l.conducted?.status === 'CONDUCTED')
            .reduce((a, l) => a + (l.conducted?.actualHours ?? 0), 0),
          control: CONTROL_FORM_LABELS[item.controlForm],
        });
      }
    }
    return {
      type: 'practice',
      title: 'Отчёт по практике',
      columns: [
        { key: 'group', header: 'Группа', width: 12 },
        { key: 'semester', header: 'Семестр', type: 'number', width: 8 },
        { key: 'code', header: 'Индекс', width: 10 },
        { key: 'name', header: 'Практика', width: 30 },
        { key: 'kind', header: 'Вид', width: 24 },
        { key: 'place', header: 'Место проведения', width: 18 },
        { key: 'hours', header: 'Часов', type: 'number', width: 8 },
        { key: 'period', header: 'Период по графику', width: 26 },
        { key: 'scheduled', header: 'В расписании, ч', type: 'number', width: 12 },
        { key: 'conducted', header: 'Проведено, ч', type: 'number', width: 12 },
        { key: 'control', header: 'Форма контроля', width: 18 },
      ],
      rows,
      summary: [{ label: 'Практик', value: rows.length }],
    };
  }

  private async assessments(params: ReportParams, actor: AuthUser): Promise<ReportTable> {
    const items = await this.prisma.semesterCurriculumItem.findMany({
      where: {
        controlForm: { not: ControlForm.NONE },
        semesterId: params.semesterId || undefined,
        semester: {
          program: { organizationId: actor.organizationId },
          educationalProgramId: params.programId || undefined,
        },
      },
      include: {
        curriculumItem: true,
        semester: { include: { program: { include: { groups: { where: { isActive: true } } } } } },
        assessmentEvents: {
          include: { teacher: { select: { fullName: true } }, classroom: { select: { code: true } } },
        },
      },
      orderBy: [{ semester: { number: 'asc' } }, { curriculumItem: { code: 'asc' } }],
    });
    const rows: ReportTable['rows'] = [];
    const examsPerWeek = new Map<string, number>();
    for (const item of items) {
      for (const group of item.semester.program.groups) {
        const events = item.assessmentEvents.filter((e) => e.studentGroupId === group.id);
        for (const e of events) {
          if (e.controlForm === ControlForm.EXAM || e.controlForm === ControlForm.QUALIFICATION_EXAM) {
            const key = `${group.code}#${weekStart(toDateStr(e.date))}`;
            examsPerWeek.set(key, (examsPerWeek.get(key) ?? 0) + 1);
          }
        }
        rows.push({
          group: group.code,
          semester: item.semester.number,
          discipline: `${item.curriculumItem.code} ${item.curriculumItem.name}`,
          control: CONTROL_FORM_LABELS[item.controlForm],
          date: events[0] ? toDateStr(events[0].date) : '',
          teacher: events[0]?.teacher?.fullName ?? '',
          room: events[0]?.classroom?.code ?? '',
          state: events.length ? 'Назначено' : 'Дата не назначена',
        });
      }
    }
    const heavy = [...examsPerWeek.values()].filter((c) => c > 3).length;
    return {
      type: 'assessments',
      title: 'Контрольные мероприятия',
      columns: [
        { key: 'group', header: 'Группа', width: 12 },
        { key: 'semester', header: 'Семестр', type: 'number', width: 8 },
        { key: 'discipline', header: 'Дисциплина', width: 44 },
        { key: 'control', header: 'Форма контроля', width: 24 },
        { key: 'date', header: 'Дата', type: 'date', width: 12 },
        { key: 'teacher', header: 'Преподаватель', width: 28 },
        { key: 'room', header: 'Аудитория', width: 10 },
        { key: 'state', header: 'Состояние', width: 18 },
      ],
      rows,
      summary: [
        { label: 'Контрольных мероприятий', value: rows.length },
        { label: 'Без даты', value: rows.filter((r) => !r.date).length },
        { label: 'Недель с >3 экзаменами', value: heavy },
      ],
    };
  }

  private async classroomUtilization(
    params: { from: string; to: string },
    actor: AuthUser,
    lessonsPerDay: number,
    workingDays: number[],
  ): Promise<ReportTable> {
    const rooms = await this.prisma.classroom.findMany({
      where: { organizationId: actor.organizationId },
      include: { availability: { where: { isAvailable: false } } },
      orderBy: [{ building: 'asc' }, { code: 'asc' }],
    });
    const lessons = await this.prisma.scheduleLesson.findMany({
      where: {
        schedulePeriod: { organizationId: actor.organizationId },
        status: { in: ACTIVE_STATUSES },
        date: { gte: parseDate(params.from), lte: parseDate(params.to) },
        classroomId: { not: null },
      },
      select: { classroomId: true, date: true, lessonNumber: true, weekday: true },
    });
    const days = eachDay(params.from, params.to).filter((d) => workingDays.includes(isoWeekday(d)));
    const rows = rooms.map((r) => {
      const used = new Set(
        lessons.filter((l) => l.classroomId === r.id).map((l) => `${toDateStr(l.date)}#${l.lessonNumber}`),
      );
      const blocked = days.reduce(
        (acc, d) =>
          acc +
          r.availability.filter((a) => a.weekday === isoWeekday(d) && a.lessonNumber <= lessonsPerDay).length,
        0,
      );
      const total = days.length * lessonsPerDay - blocked;
      const byDay: Record<string, number> = {};
      for (const key of used) {
        const wd = isoWeekday(key.slice(0, 10));
        byDay[wd] = (byDay[wd] ?? 0) + 1;
      }
      return {
        code: r.code,
        name: r.name,
        building: r.building ?? '',
        type: CLASSROOM_TYPE_LABELS[r.classroomType],
        capacity: r.capacity,
        available: total,
        used: used.size,
        percent: total > 0 ? Math.round((used.size / total) * 1000) / 10 : 0,
        busiest: Object.entries(byDay).sort((a, b) => b[1] - a[1])[0]
          ? weekdayName(Number(Object.entries(byDay).sort((a, b) => b[1] - a[1])[0][0]))
          : '',
      };
    });
    const totalAvailable = rows.reduce((a, r) => a + r.available, 0);
    const totalUsed = rows.reduce((a, r) => a + r.used, 0);
    return {
      type: 'classroom-utilization',
      title: 'Занятость аудиторного фонда',
      subtitle: `${formatDateRu(params.from)} — ${formatDateRu(params.to)}`,
      columns: [
        { key: 'code', header: 'Аудитория', width: 10 },
        { key: 'name', header: 'Наименование', width: 36 },
        { key: 'building', header: 'Корпус', width: 18 },
        { key: 'type', header: 'Тип', width: 18 },
        { key: 'capacity', header: 'Мест', type: 'number', width: 6 },
        { key: 'available', header: 'Доступно слотов', type: 'number', width: 10 },
        { key: 'used', header: 'Занято слотов', type: 'number', width: 10 },
        { key: 'percent', header: 'Загрузка, %', type: 'percent', width: 10 },
        { key: 'busiest', header: 'Самый загруженный день', width: 16 },
      ],
      rows,
      summary: [
        { label: 'Аудиторий', value: rows.length },
        {
          label: 'Средняя загрузка, %',
          value: totalAvailable ? Math.round((totalUsed / totalAvailable) * 1000) / 10 : 0,
        },
      ],
    };
  }
}
