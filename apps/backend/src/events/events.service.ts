import { Injectable, NotFoundException } from '@nestjs/common';
import { CalendarEventType, ControlForm, MakeupTaskStatus, ProgramStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import {
  addDaysStr,
  DateStr,
  formatDateRu,
  parseDate,
  toDateStr,
  todayInTimezone,
} from '../common/utils/dates';
import { CALENDAR_EVENT_LABELS, CONTROL_FORM_LABELS } from '../common/utils/labels';
import { AuthUser } from '../common/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import {
  academicYearEnd,
  academicYearStart,
  groupStage,
  idsHash,
  isDismissed,
  nextYearly,
  sortEvents,
  TimelineEvent,
  TimelineItem,
} from './event-rules';
import { CreateReminderDto, DismissEventDto, UpdateReminderDto } from './dto/events.dto';

/** Периоды графика, о начале которых стоит напомнить */
const PROCESS_TYPES: CalendarEventType[] = [
  CalendarEventType.EXAM_SESSION,
  CalendarEventType.VACATION,
  CalendarEventType.EDUCATIONAL_PRACTICE,
  CalendarEventType.INDUSTRIAL_PRACTICE,
  CalendarEventType.PRE_DIPLOMA_PRACTICE,
  CalendarEventType.FINAL_ATTESTATION,
  CalendarEventType.DIPLOMA_PREPARATION,
  CalendarEventType.DIPLOMA_DEFENSE,
  CalendarEventType.DEMO_EXAM_PREPARATION,
  CalendarEventType.DEMO_EXAM,
  CalendarEventType.REATTESTATION,
];

const PROCESS_TITLES: Partial<Record<CalendarEventType, string>> = {
  EXAM_SESSION: 'Начинается промежуточная аттестация',
  VACATION: 'Начинаются каникулы',
  EDUCATIONAL_PRACTICE: 'Начинается учебная практика',
  INDUSTRIAL_PRACTICE: 'Начинается производственная практика',
  PRE_DIPLOMA_PRACTICE: 'Начинается преддипломная практика',
  FINAL_ATTESTATION: 'Начинается ГИА',
  DIPLOMA_PREPARATION: 'Начинается подготовка ВКР',
  DIPLOMA_DEFENSE: 'Защита ВКР',
  DEMO_EXAM_PREPARATION: 'Подготовка к демонстрационному экзамену',
  DEMO_EXAM: 'Демонстрационный экзамен',
  REATTESTATION: 'Повторная аттестация',
};

const EXAM_LIKE: ControlForm[] = [ControlForm.EXAM, ControlForm.QUALIFICATION_EXAM];
const CREDIT_LIKE: ControlForm[] = [ControlForm.CREDIT, ControlForm.DIFFERENTIATED_CREDIT];

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function shortFio(full: string | null | undefined): string {
  if (!full) return '';
  const [last, first, middle] = full.trim().split(/\s+/);
  return [last, first ? `${first[0]}.` : '', middle ? `${middle[0]}.` : ''].filter(Boolean).join(' ');
}

function formatShort(d: DateStr) {
  return `${d.slice(8, 10)}.${d.slice(5, 7)}`;
}

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async today(organizationId: string): Promise<DateStr> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    });
    return todayInTimezone(org?.timezone ?? 'Europe/Moscow');
  }

  /** Лента событий организации на `days` дней вперёд (и дела, которые уже требуют действий) */
  async list(actor: AuthUser, days = 60) {
    const org = actor.organizationId;
    const today = await this.today(org);
    const horizon = Math.min(Math.max(days, 7), 366);
    const to = addDaysStr(today, horizon);
    const from = addDaysStr(today, -1);

    const [assessments, groupEvents, process, holidays, teachers, makeup, reminders, dismissals, decree] =
      await Promise.all([
        this.assessmentEvents(org, today, to),
        this.groupEvents(org, today, to),
        this.processEvents(org, today, to),
        this.holidayEvents(org, today, to),
        this.teacherEvents(org, today, to),
        this.makeupEvents(org, today),
        this.reminderEvents(org, today, to),
        this.prisma.eventDismissal.findMany({ where: { organizationId: org } }),
        this.decreeEvent(org, today),
      ]);

    const events: TimelineEvent[] = [
      ...assessments,
      ...groupEvents,
      ...process,
      ...holidays,
      ...teachers,
      ...makeup,
      ...reminders,
      ...decree,
      ...this.yearEvents(today, to),
    ];
    const dismissed = new Map(dismissals.map((d) => [d.eventKey, d.until ? toDateStr(d.until) : null]));
    for (const e of events) {
      const exists = dismissed.has(e.key);
      const until = dismissed.get(e.key);
      e.hidden = isDismissed(until, exists, today);
      e.hiddenUntil = e.hidden ? (until ?? null) : null;
    }
    const visible = events.filter((e) => !e.hidden);
    return {
      today,
      from,
      to,
      days: horizon,
      events: sortEvents(events, today),
      summary: {
        total: visible.length,
        attention: visible.filter((e) => e.needsAction).length,
        week: visible.filter((e) => e.date <= addDaysStr(today, 7)).length,
        assessments: visible
          .filter((e) => e.category === 'assessments' && !e.needsAction)
          .reduce((a, e) => a + (e.items?.length ?? 0), 0),
        reminders: visible.filter((e) => e.category === 'reminders').length,
        hidden: events.length - visible.length,
      },
    };
  }

  /** Сколько событий требует действий — для счётчика в меню */
  async attention(actor: AuthUser) {
    const res = await this.list(actor);
    return { attention: res.summary.attention, week: res.summary.week };
  }

  // ---------------------------------------------------------------------------
  // Источники событий
  // ---------------------------------------------------------------------------

  /** Экзамены и зачёты по дням + дисциплины без назначенной даты контроля */
  private async assessmentEvents(org: string, today: DateStr, to: DateStr): Promise<TimelineEvent[]> {
    const rows = await this.prisma.assessmentEvent.findMany({
      where: {
        date: { gte: parseDate(today), lte: parseDate(to) },
        group: { isActive: true, program: { organizationId: org } },
      },
      include: {
        group: { select: { id: true, code: true, educationalProgramId: true } },
        semesterItem: { select: { curriculumItem: { select: { code: true, name: true } } } },
        teacher: { select: { fullName: true } },
        classroom: { select: { code: true } },
      },
      orderBy: [{ date: 'asc' }, { lessonNumber: 'asc' }],
    });
    const byDate = new Map<DateStr, typeof rows>();
    for (const r of rows) {
      const d = toDateStr(r.date);
      byDate.set(d, [...(byDate.get(d) ?? []), r]);
    }
    const events: TimelineEvent[] = [];
    for (const [date, list] of byDate) {
      const items: TimelineItem[] = list.map((r) => {
        const missing = [
          r.lessonNumber ? null : 'пара',
          r.teacher ? null : 'преподаватель',
          r.classroom ? null : 'аудитория',
        ].filter(Boolean);
        return {
          id: r.id,
          title: `${CONTROL_FORM_LABELS[r.controlForm] ?? r.controlForm}: ${r.semesterItem.curriculumItem.name}`,
          subtitle: [
            r.group.code,
            r.lessonNumber ? `${r.lessonNumber} пара` : null,
            r.teacher ? shortFio(r.teacher.fullName) : null,
            r.classroom ? `ауд. ${r.classroom.code}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
          warning: missing.length ? `Не указано: ${missing.join(', ')}` : null,
          link: `/groups/${r.group.id}`,
        };
      });
      const exams = list.filter((r) => EXAM_LIKE.includes(r.controlForm)).length;
      const credits = list.filter((r) => CREDIT_LIKE.includes(r.controlForm)).length;
      const warnings = items.filter((i) => i.warning).length;
      const codes = [...new Set(list.map((r) => r.group.code))].sort((a, b) =>
        a.localeCompare(b, 'ru', { numeric: true }),
      );
      const title =
        list.length === 1
          ? items[0].title
          : exams === list.length
            ? `Экзамены: ${exams}`
            : credits === list.length
              ? `Зачёты: ${credits}`
              : `Экзамены и зачёты: ${list.length}`;
      events.push({
        key: `assessments:${date}`,
        category: 'assessments',
        severity: warnings ? 'warning' : 'info',
        date,
        title,
        description:
          list.length === 1
            ? [items[0].subtitle, items[0].warning].filter(Boolean).join(' · ')
            : `${codes.slice(0, 8).join(', ')}${codes.length > 8 ? ` и ещё ${codes.length - 8}` : ''}` +
              (warnings ? ` · у ${warnings} не заполнены пара, преподаватель или аудитория` : ''),
        items: list.length > 1 ? items : undefined,
        needsAction: false,
        link: {
          to: `/calendar?tab=assessments&program=${list[0].group.educationalProgramId}`,
          label: 'Экзамены и зачёты',
        },
      });
    }

    // Семестр заканчивается в окне, а у дисциплин с экзаменом или зачётом нет даты контроля
    const groups = await this.prisma.studentGroup.findMany({
      where: { isActive: true, program: { organizationId: org } },
      select: {
        id: true,
        code: true,
        educationalProgramId: true,
        program: {
          select: {
            semesters: {
              where: { endDate: { gte: parseDate(today), lte: parseDate(to) } },
              select: {
                id: true,
                number: true,
                endDate: true,
                items: {
                  where: {
                    controlForm: { notIn: [ControlForm.NONE, ControlForm.OTHER, ControlForm.COURSE_PROJECT] },
                  },
                  select: { id: true },
                },
              },
            },
          },
        },
        assessmentEvents: { select: { semesterCurriculumItemId: true } },
      },
    });
    const missing: TimelineItem[] = [];
    const missingGroups: string[] = [];
    let missingCount = 0;
    let earliestEnd: DateStr | null = null;
    for (const g of groups) {
      const placed = new Set(g.assessmentEvents.map((a) => a.semesterCurriculumItemId));
      for (const s of g.program.semesters) {
        const notPlaced = s.items.filter((i) => !placed.has(i.id)).length;
        if (!notPlaced) continue;
        const end = toDateStr(s.endDate);
        if (!earliestEnd || end < earliestEnd) earliestEnd = end;
        missingCount += notPlaced;
        missingGroups.push(g.id);
        missing.push({
          id: g.id,
          title: g.code,
          subtitle: `${s.number} семестр до ${formatDateRu(end)}: без даты ${notPlaced} ${plural(notPlaced, 'дисциплина', 'дисциплины', 'дисциплин')}`,
          link: `/calendar?tab=assessments&program=${g.educationalProgramId}&semester=${s.id}`,
        });
      }
    }
    if (missing.length && earliestEnd) {
      missing.sort((a, b) => a.title.localeCompare(b.title, 'ru', { numeric: true }));
      events.push({
        key: `assessments-missing:${idsHash(missingGroups)}`,
        category: 'assessments',
        severity: 'warning',
        date: today,
        title: `Не назначены даты экзаменов и зачётов: ${missingCount}`,
        description: `Семестр заканчивается у ${missing.length} ${plural(missing.length, 'группы', 'групп', 'групп')}, первая — ${formatDateRu(earliestEnd)}. Назначьте даты в редакторе экзаменов`,
        items: missing,
        needsAction: true,
        link: {
          to: `/calendar?tab=assessments&program=${groups.find((g) => g.id === missingGroups[0])?.educationalProgramId ?? ''}`,
          label: 'Назначить даты',
        },
      });
    }
    return events;
  }

  /** Выпуск групп, переход на новый семестр, расписание на новый семестр */
  private async groupEvents(org: string, today: DateStr, to: DateStr): Promise<TimelineEvent[]> {
    const groups = await this.prisma.studentGroup.findMany({
      where: { isActive: true, program: { organizationId: org } },
      select: {
        id: true,
        code: true,
        courseNumber: true,
        currentSemesterNumber: true,
        _count: { select: { lessons: true } },
        program: {
          select: {
            id: true,
            title: true,
            semesters: {
              select: { id: true, number: true, courseNumber: true, startDate: true, endDate: true },
            },
          },
        },
      },
      orderBy: { code: 'asc' },
    });
    const graduated: TimelineItem[] = [];
    const graduatedIds: string[] = [];
    let lastGraduation = '';
    const soon = new Map<DateStr, TimelineItem[]>();
    const mismatch: TimelineItem[] = [];
    const mismatchIds: string[] = [];
    const newSemester = new Map<DateStr, Array<{ id: string; code: string; number: number; end: DateStr }>>();

    for (const g of groups) {
      const stage = groupStage(g.program.semesters, today);
      if (stage.kind === 'graduated') {
        graduatedIds.push(g.id);
        if (stage.lastEnd > lastGraduation) lastGraduation = stage.lastEnd;
        graduated.push({
          id: g.id,
          title: g.code,
          subtitle: `${g.program.title} · обучение завершено ${formatDateRu(stage.lastEnd)}${g._count.lessons ? ` · ${g._count.lessons} пар в расписании` : ''}`,
          link: `/groups/${g.id}`,
        });
        continue;
      }
      if (stage.kind === 'no-semesters') continue;
      if (stage.lastEnd <= to) {
        soon.set(stage.lastEnd, [
          ...(soon.get(stage.lastEnd) ?? []),
          { id: g.id, title: g.code, subtitle: g.program.title, link: `/groups/${g.id}` },
        ]);
      }
      if (stage.kind === 'studying' && stage.semester.number !== g.currentSemesterNumber) {
        mismatchIds.push(g.id);
        mismatch.push({
          id: g.id,
          title: g.code,
          subtitle: `в карточке ${g.courseNumber} курс, ${g.currentSemesterNumber} семестр → по плану ${stage.semester.courseNumber} курс, ${stage.semester.number} семестр`,
          link: `/groups/${g.id}`,
        });
      }
      // Новый семестр в окне: напомнить составить расписание, если пар на него ещё нет
      const next =
        stage.kind === 'between'
          ? stage.next
          : g.program.semesters
              .filter((s) => toDateStr(s.startDate) > today)
              .sort((a, b) => toDateStr(a.startDate).localeCompare(toDateStr(b.startDate)))[0];
      if (next && toDateStr(next.startDate) <= to) {
        const start = toDateStr(next.startDate);
        newSemester.set(start, [
          ...(newSemester.get(start) ?? []),
          { id: g.id, code: g.code, number: next.number, end: toDateStr(next.endDate) },
        ]);
      }
    }

    const events: TimelineEvent[] = [];
    if (graduated.length) {
      events.push({
        key: `graduated:${idsHash(graduatedIds)}`,
        category: 'groups',
        severity: 'danger',
        date: lastGraduation,
        title: `Группы закончили обучение: ${graduated.length}`,
        description:
          'Группы остаются активными, пока их не архивировать. Архив: группа становится неактивной, расписание и отчёты сохраняются, учебный план уходит в архив, когда выпустились все его группы. Удалить можно только группы без пар в расписании',
        items: graduated,
        groupIds: graduatedIds,
        needsAction: true,
        action: 'archive-graduates',
      });
    }
    for (const [date, items] of soon) {
      events.push({
        key: `graduation:${date}`,
        category: 'groups',
        severity: 'info',
        date,
        title: `Выпуск: ${items.map((i) => i.title).join(', ')}`,
        description:
          'Последний день обучения по учебному плану. После этой даты группы появятся в «Закончили обучение»',
        items: items.length > 1 ? items : undefined,
        needsAction: false,
        link: items.length === 1 ? { to: items[0].link!, label: 'Открыть группу' } : null,
      });
    }
    if (mismatch.length) {
      events.push({
        key: `semester-sync:${idsHash(mismatchIds)}`,
        category: 'groups',
        severity: 'warning',
        date: today,
        title: `Перевести группы на новый курс или семестр: ${mismatch.length}`,
        description: 'Курс и семестр в карточке группы не совпадают с датами учебного плана',
        items: mismatch,
        groupIds: mismatchIds,
        needsAction: true,
        action: 'sync-semesters',
      });
    }
    // Есть ли уже пары на новый семестр
    const semesterChecks = await Promise.all(
      [...newSemester].flatMap(([start, list]) =>
        list.map(async (g) => ({
          start,
          g,
          has: !!(await this.prisma.scheduleLesson.findFirst({
            where: { studentGroupId: g.id, date: { gte: parseDate(start), lte: parseDate(g.end) } },
            select: { id: true },
          })),
        })),
      ),
    );
    const noSchedule = new Map<DateStr, typeof semesterChecks>();
    for (const c of semesterChecks)
      if (!c.has) noSchedule.set(c.start, [...(noSchedule.get(c.start) ?? []), c]);
    for (const [start, list] of noSchedule) {
      const codes = list.map((c) => c.g.code);
      const ids = list.map((c) => c.g.id);
      const prepare = addDaysStr(start, -14);
      events.push({
        key: `new-semester:${start}:${idsHash(ids)}`,
        category: 'schedule',
        severity: prepare <= today ? 'warning' : 'info',
        date: prepare <= today ? today : prepare,
        title: `Составить расписание на семестр с ${formatDateRu(start)}`,
        description: `${list.length} ${plural(list.length, 'группа', 'группы', 'групп')} без пар в новом семестре: ${codes.slice(0, 8).join(', ')}${codes.length > 8 ? ` и ещё ${codes.length - 8}` : ''}`,
        needsAction: prepare <= today,
        link: { to: '/generation', label: 'Перейти к составлению' },
      });
    }
    return events;
  }

  /** Начало периодов календарного графика: сессии, практики, каникулы, ГИА */
  private async processEvents(org: string, today: DateStr, to: DateStr): Promise<TimelineEvent[]> {
    const rows = await this.prisma.calendarEvent.findMany({
      where: {
        organizationId: org,
        teacherId: null,
        holidayYear: null,
        eventType: { in: PROCESS_TYPES },
        startDate: { gte: parseDate(today), lte: parseDate(to) },
        OR: [{ studentGroupId: null }, { group: { isActive: true } }],
      },
      include: {
        program: {
          select: {
            title: true,
            groups: { where: { isActive: true }, select: { code: true, courseNumber: true } },
          },
        },
        group: { select: { code: true } },
      },
    });
    const byKey = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = `${r.eventType}:${toDateStr(r.startDate)}`;
      byKey.set(k, [...(byKey.get(k) ?? []), r]);
    }
    const events: TimelineEvent[] = [];
    for (const [key, list] of byKey) {
      const first = list[0];
      const start = toDateStr(first.startDate);
      const end = list.reduce(
        (m, r) => (toDateStr(r.endDate) > m ? toDateStr(r.endDate) : m),
        toDateStr(first.endDate),
      );
      const codes = new Set<string>();
      for (const r of list) {
        if (r.group) codes.add(r.group.code);
        else if (r.program) {
          for (const g of r.program.groups)
            if (!r.courseNumber || g.courseNumber === r.courseNumber) codes.add(g.code);
        }
      }
      if (!codes.size && list.every((r) => r.program)) continue; // план без активных групп
      const sortedCodes = [...codes].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
      events.push({
        key: `process:${key}`,
        category: 'process',
        severity: first.eventType === CalendarEventType.EXAM_SESSION ? 'warning' : 'info',
        date: start,
        endDate: end,
        title: PROCESS_TITLES[first.eventType] ?? CALENDAR_EVENT_LABELS[first.eventType] ?? first.title,
        description: sortedCodes.length
          ? `${formatShort(start)}–${formatShort(end)} · ${sortedCodes.slice(0, 10).join(', ')}${sortedCodes.length > 10 ? ` и ещё ${sortedCodes.length - 10}` : ''}`
          : `${formatShort(start)}–${formatShort(end)} · вся организация`,
        needsAction: false,
        link: { to: '/calendar', label: 'Календарный график' },
      });
    }
    return events;
  }

  /** Праздничные дни из модуля «Праздники» */
  private async holidayEvents(org: string, today: DateStr, to: DateStr): Promise<TimelineEvent[]> {
    const rows = await this.prisma.calendarEvent.findMany({
      where: {
        organizationId: org,
        eventType: CalendarEventType.HOLIDAY,
        educationalProgramId: null,
        studentGroupId: null,
        teacherId: null,
        endDate: { gte: parseDate(today) },
        startDate: { lte: parseDate(to) },
      },
      orderBy: { startDate: 'asc' },
    });
    // Соседние дни с одинаковым названием — одно событие
    const merged: Array<{ title: string; start: DateStr; end: DateStr }> = [];
    for (const r of rows) {
      const start = toDateStr(r.startDate);
      const end = toDateStr(r.endDate);
      const last = merged[merged.length - 1];
      if (last && last.title === r.title && addDaysStr(last.end, 1) >= start) {
        if (end > last.end) last.end = end;
      } else merged.push({ title: r.title, start, end });
    }
    return merged.map((h) => ({
      key: `holiday:${h.start}`,
      category: 'holidays' as const,
      severity: 'success' as const,
      date: h.start,
      endDate: h.end !== h.start ? h.end : null,
      ongoing: h.start < today,
      title: h.title,
      description:
        h.end !== h.start
          ? `Нерабочие дни ${formatShort(h.start)}–${formatShort(h.end)}, пары не ставятся`
          : 'Нерабочий день, пары не ставятся',
      needsAction: false,
      link: { to: '/holidays', label: 'Праздники' },
    }));
  }

  /** С октября: переносы выходных на следующий год ещё не внесены */
  private async decreeEvent(org: string, today: DateStr): Promise<TimelineEvent[]> {
    const month = Number(today.slice(5, 7));
    if (month < 10) return [];
    const next = Number(today.slice(0, 4)) + 1;
    const count = await this.prisma.holidayTransfer.count({
      where: {
        organizationId: org,
        fromDate: { gte: parseDate(`${next}-01-01`), lte: parseDate(`${next}-12-31`) },
      },
    });
    if (count) return [];
    return [
      {
        key: `decree:${next}`,
        category: 'holidays',
        severity: 'warning',
        date: today,
        title: `Внести переносы выходных на ${next} год`,
        description: `Постановление Правительства о переносе выходных на ${next} год обычно выходит осенью. Пока переносов нет, праздники ${next} года считаются только по ТК РФ`,
        needsAction: true,
        link: { to: '/holidays', label: 'Открыть «Праздники»' },
      },
    ];
  }

  /** Отсутствие преподавателей (курсы, отпуск, больничный) */
  private async teacherEvents(org: string, today: DateStr, to: DateStr): Promise<TimelineEvent[]> {
    const rows = await this.prisma.calendarEvent.findMany({
      where: {
        organizationId: org,
        teacherId: { not: null },
        endDate: { gte: parseDate(today) },
        startDate: { lte: parseDate(to) },
      },
      include: { teacher: { select: { id: true, fullName: true } } },
      orderBy: { startDate: 'asc' },
    });
    return rows.map((r) => {
      const start = toDateStr(r.startDate);
      const end = toDateStr(r.endDate);
      return {
        key: `teacher:${r.id}`,
        category: 'teachers' as const,
        severity: 'info' as const,
        date: start,
        endDate: end,
        ongoing: start < today,
        title: `Отсутствует: ${shortFio(r.teacher?.fullName)}`,
        description:
          `${r.title} · ${formatShort(start)}–${formatShort(end)}` +
          (r.makeupAfterReturn ? ' · пропущенные пары переносятся после выхода' : ''),
        needsAction: false,
        link: r.teacher ? { to: `/teachers/${r.teacher.id}`, label: 'Преподаватель' } : null,
      };
    });
  }

  /** Открытые задачи на отработку */
  private async makeupEvents(org: string, today: DateStr): Promise<TimelineEvent[]> {
    const open = await this.prisma.makeupTask.findMany({
      where: { status: MakeupTaskStatus.OPEN, group: { program: { organizationId: org } } },
      select: { id: true, academicHours: true, dueDate: true },
    });
    if (!open.length) return [];
    const hours = open.reduce((a, t) => a + t.academicHours, 0);
    return [
      {
        key: `makeup:${idsHash(open.map((t) => t.id))}`,
        category: 'schedule',
        severity: 'warning',
        date: today,
        title: `Отработки ждут постановки: ${open.length}`,
        description: `${hours} ак. ч пропущенных занятий нужно вернуть в расписание`,
        needsAction: true,
        link: { to: '/makeup', label: 'Отработки' },
      },
    ];
  }

  /** Конец и начало учебного года */
  private yearEvents(today: DateStr, to: DateStr): TimelineEvent[] {
    const events: TimelineEvent[] = [];
    const end = academicYearEnd(today);
    const endRemind = addDaysStr(end, -14);
    if (endRemind <= to) {
      events.push({
        key: `year-end:${end.slice(0, 4)}`,
        category: 'groups',
        severity: 'info',
        date: endRemind < today ? today : endRemind,
        title: `Конец учебного года ${Number(end.slice(0, 4)) - 1}–${end.slice(0, 4)}`,
        description:
          'Проверьте выпускников и архивируйте их группы, переведите остальные группы на следующий курс, загрузите учебные планы нового набора',
        needsAction: false,
        link: { to: '/groups', label: 'Группы' },
      });
    }
    const start = academicYearStart(today);
    const startRemind = addDaysStr(start, -21);
    if (startRemind <= to && startRemind >= today) {
      events.push({
        key: `year-start:${start.slice(0, 4)}`,
        category: 'process',
        severity: 'info',
        date: startRemind,
        title: `Скоро новый учебный год (${formatDateRu(start)})`,
        description:
          'Создайте группы нового набора, проверьте нагрузку преподавателей и составьте расписание на первый семестр',
        needsAction: false,
        link: { to: '/setup', label: 'Мастер настройки' },
      });
    }
    return events;
  }

  /** Напоминания, добавленные вручную (просроченные — тоже) */
  private async reminderEvents(org: string, today: DateStr, to: DateStr): Promise<TimelineEvent[]> {
    const rows = await this.prisma.reminder.findMany({
      where: { organizationId: org, doneAt: null },
      include: { createdBy: { select: { fullName: true } } },
    });
    const events: TimelineEvent[] = [];
    for (const r of rows) {
      const stored = toDateStr(r.date);
      const date = r.yearly && stored < addDaysStr(today, -30) ? nextYearly(stored, today) : stored;
      if (date > to) continue;
      const overdue = date < today;
      events.push({
        key: `reminder:${r.id}`,
        category: 'reminders',
        severity: overdue ? 'danger' : date === today ? 'warning' : 'info',
        date,
        title: r.title,
        description:
          [
            r.notes,
            overdue ? `Просрочено с ${formatDateRu(date)}` : null,
            r.createdBy ? `Добавил(а): ${shortFio(r.createdBy.fullName)}` : null,
          ]
            .filter(Boolean)
            .join(' · ') || null,
        needsAction: date <= today,
        reminderId: r.id,
        notes: r.notes,
        yearly: r.yearly,
      });
    }
    return events;
  }

  // ---------------------------------------------------------------------------
  // Действия
  // ---------------------------------------------------------------------------

  private async ownGroups(groupIds: string[], org: string) {
    return this.prisma.studentGroup.findMany({
      where: { id: { in: groupIds }, program: { organizationId: org } },
      select: {
        id: true,
        code: true,
        isActive: true,
        educationalProgramId: true,
        _count: { select: { lessons: true } },
      },
    });
  }

  /** Архивировать группы: неактивны; план — в архив, если активных групп у него не осталось */
  async archiveGroups(groupIds: string[], actor: AuthUser) {
    const groups = await this.ownGroups(groupIds, actor.organizationId);
    if (!groups.length) throw new NotFoundException('Группы не найдены');
    const ids = groups.map((g) => g.id);
    await this.prisma.studentGroup.updateMany({ where: { id: { in: ids } }, data: { isActive: false } });
    const programIds = [...new Set(groups.map((g) => g.educationalProgramId))];
    const programs = await this.prisma.educationalProgram.findMany({
      where: {
        id: { in: programIds },
        status: { not: ProgramStatus.ARCHIVED },
        groups: { none: { isActive: true } },
      },
      select: { id: true, title: true },
    });
    if (programs.length) {
      await this.prisma.educationalProgram.updateMany({
        where: { id: { in: programs.map((p) => p.id) } },
        data: { status: ProgramStatus.ARCHIVED },
      });
    }
    await this.audit.log(actor.id, 'ARCHIVE', 'StudentGroup', null, null, {
      groups: groups.map((g) => g.code),
      programs: programs.map((p) => p.title),
    });
    return {
      archivedGroups: groups.length,
      archivedPrograms: programs.length,
      programs: programs.map((p) => p.title),
    };
  }

  /** Удалить группы без пар в расписании; остальные не трогать */
  async deleteGroups(groupIds: string[], actor: AuthUser) {
    const groups = await this.ownGroups(groupIds, actor.organizationId);
    const deletable = groups.filter((g) => g._count.lessons === 0);
    const kept = groups.filter((g) => g._count.lessons > 0);
    if (deletable.length) {
      await this.prisma.studentGroup.deleteMany({ where: { id: { in: deletable.map((g) => g.id) } } });
      await this.audit.log(
        actor.id,
        'DELETE',
        'StudentGroup',
        null,
        { groups: deletable.map((g) => g.code) },
        null,
      );
    }
    return { deleted: deletable.length, kept: kept.map((g) => g.code) };
  }

  /** Курс и семестр в карточках групп — по датам учебного плана */
  async syncSemesters(groupIds: string[], actor: AuthUser) {
    const today = await this.today(actor.organizationId);
    const groups = await this.prisma.studentGroup.findMany({
      where: { id: { in: groupIds }, program: { organizationId: actor.organizationId } },
      select: {
        id: true,
        code: true,
        courseNumber: true,
        currentSemesterNumber: true,
        program: {
          select: {
            semesters: {
              select: { id: true, number: true, courseNumber: true, startDate: true, endDate: true },
            },
          },
        },
      },
    });
    let updated = 0;
    for (const g of groups) {
      const stage = groupStage(g.program.semesters, today);
      if (stage.kind !== 'studying') continue;
      const { number, courseNumber } = stage.semester;
      if (number === g.currentSemesterNumber && courseNumber === g.courseNumber) continue;
      await this.prisma.studentGroup.update({
        where: { id: g.id },
        data: { currentSemesterNumber: number, courseNumber },
      });
      await this.audit.log(
        actor.id,
        'UPDATE',
        'StudentGroup',
        g.id,
        { courseNumber: g.courseNumber, currentSemesterNumber: g.currentSemesterNumber },
        { courseNumber, currentSemesterNumber: number },
      );
      updated++;
    }
    return { updated };
  }

  async dismiss(dto: DismissEventDto, actor: AuthUser) {
    const until = dto.until ? parseDate(dto.until) : null;
    await this.prisma.eventDismissal.upsert({
      where: { organizationId_eventKey: { organizationId: actor.organizationId, eventKey: dto.key } },
      create: { organizationId: actor.organizationId, eventKey: dto.key, until },
      update: { until },
    });
    return { success: true };
  }

  async restore(key: string, actor: AuthUser) {
    await this.prisma.eventDismissal.deleteMany({
      where: { organizationId: actor.organizationId, eventKey: key },
    });
    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Напоминания
  // ---------------------------------------------------------------------------

  private async findReminder(id: string, actor: AuthUser) {
    const r = await this.prisma.reminder.findFirst({ where: { id, organizationId: actor.organizationId } });
    if (!r) throw new NotFoundException('Напоминание не найдено');
    return r;
  }

  async createReminder(dto: CreateReminderDto, actor: AuthUser) {
    const r = await this.prisma.reminder.create({
      data: {
        organizationId: actor.organizationId,
        title: dto.title.trim(),
        notes: dto.notes?.trim() || null,
        date: parseDate(dto.date),
        yearly: dto.yearly ?? false,
        createdById: actor.id,
      },
    });
    await this.audit.log(actor.id, 'CREATE', 'Reminder', r.id, null, r);
    return r;
  }

  async updateReminder(id: string, dto: UpdateReminderDto, actor: AuthUser) {
    const before = await this.findReminder(id, actor);
    const r = await this.prisma.reminder.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        notes: dto.notes === undefined ? undefined : dto.notes?.trim() || null,
        date: dto.date ? parseDate(dto.date) : undefined,
        yearly: dto.yearly,
      },
    });
    await this.audit.log(actor.id, 'UPDATE', 'Reminder', id, before, r);
    return r;
  }

  /** Выполнено: разовое — закрывается, ежегодное — переносится на следующий год */
  async completeReminder(id: string, actor: AuthUser) {
    const r = await this.findReminder(id, actor);
    if (r.yearly) {
      const today = await this.today(actor.organizationId);
      const current = toDateStr(r.date);
      const base = current > today ? current : today;
      const next = nextYearly(current, addDaysStr(base, 1));
      return this.prisma.reminder.update({ where: { id }, data: { date: parseDate(next) } });
    }
    return this.prisma.reminder.update({ where: { id }, data: { doneAt: new Date() } });
  }

  async removeReminder(id: string, actor: AuthUser) {
    const before = await this.findReminder(id, actor);
    await this.prisma.reminder.delete({ where: { id } });
    await this.audit.log(actor.id, 'DELETE', 'Reminder', id, before, null);
    return { success: true };
  }
}
