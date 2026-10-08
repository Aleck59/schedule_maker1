import { Injectable, NotFoundException } from '@nestjs/common';
import { ConductedStatus, LessonType, Prisma } from '@prisma/client';
import { addDaysStr, parseDate, toDateStr, todayInTimezone, weekStart } from '../common/utils/dates';
import {
  ACTIVE_STATUSES,
  computeStreamHours,
  emptyStreamHours,
  HourStatus,
  hourStatus,
  LessonForHours,
  matchLessonsToStreams,
  StreamHours,
  sumHours,
} from '../planning/hours-calculator';
import { PlanningService } from '../planning/planning.service';
import { DemandStream, StreamFilter } from '../planning/planning.types';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

export interface HourControlRow {
  key: string;
  groupId: string;
  groupCode: string;
  subgroupNumber: number | null;
  programId: string;
  semesterId: string;
  semesterNumber: number;
  semesterStart: string;
  semesterEnd: string;
  semesterItemId: string;
  itemCode: string;
  itemName: string;
  itemType: string;
  controlForm: string;
  teachers: Array<{ id: string | null; name: string | null; lessonType: LessonType }>;
  byType: Partial<Record<LessonType, StreamHours>>;
  total: StreamHours;
  status: HourStatus;
  expectedByNow: number;
  completionPercent: number;
  forecastPercent: number;
  unassigned: boolean;
}

export interface HourControlSummary {
  rows: number;
  total: StreamHours;
  byStatus: Record<HourStatus, number>;
  completionPercent: number;
  forecastPercent: number;
}

const STATUS_RANK: Record<HourStatus, number> = { EXCESS: 3, DEFICIT: 2, RISK: 1, NORMAL: 0 };

/** Контроль выполнения часов учебного плана */
@Injectable()
export class HourControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planning: PlanningService,
    private readonly settings: SettingsService,
  ) {}

  private async loadLessons(streams: DemandStream[]): Promise<LessonForHours[]> {
    if (streams.length === 0) return [];
    const groupIds = Array.from(new Set(streams.map((s) => s.groupId)));
    const itemIds = Array.from(new Set(streams.map((s) => s.semesterItemId)));
    const lessons = await this.prisma.scheduleLesson.findMany({
      where: { studentGroupId: { in: groupIds }, semesterCurriculumItemId: { in: itemIds } },
      select: {
        id: true,
        studentGroupId: true,
        semesterCurriculumItemId: true,
        lessonType: true,
        subgroupNumber: true,
        status: true,
        academicHours: true,
        date: true,
        teacherId: true,
        allowHoursExcess: true,
        conducted: { select: { status: true, actualHours: true, actualTeacherId: true } },
      },
    });
    return lessons.map((l) => ({ ...l, date: toDateStr(l.date) }));
  }

  async rows(
    filter: StreamFilter,
  ): Promise<{ rows: HourControlRow[]; summary: HourControlSummary; today: string }> {
    const settings = await this.settings.getEffective(filter.organizationId);
    const today = todayInTimezone(settings.timezone);
    const streams = await this.planning.getStreams(filter);
    const lessons = await this.loadLessons(streams);
    const { matched } = matchLessonsToStreams(streams, lessons);

    const byRow = new Map<string, HourControlRow>();
    for (const s of streams) {
      const key = `${s.groupId}|${s.semesterItemId}|${s.subgroupNumber ?? 0}`;
      let row = byRow.get(key);
      if (!row) {
        row = {
          key,
          groupId: s.groupId,
          groupCode: s.groupCode,
          subgroupNumber: s.subgroupNumber,
          programId: s.programId,
          semesterId: s.semesterId,
          semesterNumber: s.semesterNumber,
          semesterStart: s.semesterStart,
          semesterEnd: s.semesterEnd,
          semesterItemId: s.semesterItemId,
          itemCode: s.itemCode,
          itemName: s.itemName,
          itemType: s.itemType,
          controlForm: s.controlForm,
          teachers: [],
          byType: {},
          total: emptyStreamHours(0),
          status: 'NORMAL',
          expectedByNow: 0,
          completionPercent: 0,
          forecastPercent: 0,
          unassigned: false,
        };
        byRow.set(key, row);
      }
      const h = computeStreamHours(s, matched.get(s.key) ?? [], today);
      row.byType[s.lessonType] = h;
      row.teachers.push({ id: s.teacherId, name: s.teacherName, lessonType: s.lessonType });
      if (!s.teacherId) row.unassigned = true;
    }
    const rows = [...byRow.values()].map((row) => {
      row.total = sumHours(Object.values(row.byType) as StreamHours[]);
      const semester = { start: row.semesterStart, end: row.semesterEnd };
      // Статус строки — худший из статусов по видам занятий
      let worst: HourStatus = 'NORMAL';
      for (const h of Object.values(row.byType) as StreamHours[]) {
        const st = hourStatus(h, semester, today).status;
        if (STATUS_RANK[st] > STATUS_RANK[worst]) worst = st;
      }
      const totalStatus = hourStatus(row.total, semester, today);
      row.status = worst;
      row.expectedByNow = totalStatus.expectedByNow;
      row.completionPercent = totalStatus.completionPercent;
      row.forecastPercent = row.total.planned
        ? Math.round((row.total.forecast / row.total.planned) * 1000) / 10
        : 0;
      return row;
    });
    rows.sort(
      (a, b) =>
        a.groupCode.localeCompare(b.groupCode) ||
        a.semesterNumber - b.semesterNumber ||
        a.itemCode.localeCompare(b.itemCode, 'ru', { numeric: true }) ||
        (a.subgroupNumber ?? 0) - (b.subgroupNumber ?? 0),
    );
    return { rows, summary: this.summarize(rows), today };
  }

  summarize(rows: HourControlRow[]): HourControlSummary {
    const total = sumHours(rows.map((r) => r.total));
    const byStatus: Record<HourStatus, number> = { NORMAL: 0, RISK: 0, DEFICIT: 0, EXCESS: 0 };
    for (const r of rows) byStatus[r.status]++;
    return {
      rows: rows.length,
      total,
      byStatus,
      completionPercent: total.planned ? Math.round((total.conducted / total.planned) * 1000) / 10 : 0,
      forecastPercent: total.planned ? Math.round((total.forecast / total.planned) * 1000) / 10 : 0,
    };
  }

  /** Агрегация строк по разрезам: группа, дисциплина, преподаватель, семестр, программа, колледж */
  async aggregate(
    filter: StreamFilter,
    by: 'group' | 'discipline' | 'teacher' | 'semester' | 'program' | 'college',
  ) {
    const { rows, today } = await this.rows(filter);
    const groups = new Map<string, { key: string; label: string; rows: HourControlRow[] }>();
    const push = (key: string, label: string, row: HourControlRow) => {
      const g = groups.get(key) ?? { key, label, rows: [] };
      g.rows.push(row);
      groups.set(key, g);
    };
    let programTitles = new Map<string, string>();
    if (by === 'program') {
      const programs = await this.prisma.educationalProgram.findMany({
        where: { id: { in: Array.from(new Set(rows.map((r) => r.programId))) } },
        select: { id: true, title: true },
      });
      programTitles = new Map(programs.map((p) => [p.id, p.title]));
    }
    for (const r of rows) {
      switch (by) {
        case 'group':
          push(r.groupId, r.groupCode, r);
          break;
        case 'discipline':
          push(`${r.itemCode}|${r.itemName}`, `${r.itemCode} ${r.itemName}`, r);
          break;
        case 'semester':
          push(r.semesterId, `${r.semesterNumber} семестр (${r.semesterStart.slice(0, 4)})`, r);
          break;
        case 'program':
          push(r.programId, programTitles.get(r.programId) ?? r.programId, r);
          break;
        case 'college':
          push('college', 'Колледж в целом', r);
          break;
        case 'teacher': {
          const seen = new Set<string>();
          for (const t of r.teachers) {
            const key = t.id ?? 'none';
            if (seen.has(key)) continue;
            seen.add(key);
            push(key, t.name ?? 'Преподаватель не назначен', r);
          }
          break;
        }
      }
    }
    return {
      by,
      today,
      items: [...groups.values()]
        .map((g) => ({
          key: g.key,
          label: g.label,
          ...this.summarize(g.rows),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'ru', { numeric: true })),
    };
  }

  /**
   * Нагрузка преподавателя: плановая (по назначениям), в расписании и фактическая
   * (проведённые занятия, включая замены). Потоковые лекции учитываются один раз.
   */
  async teacherWorkload(organizationId: string, teacherId: string, semesterId?: string) {
    const teacher = await this.prisma.teacher.findFirst({ where: { id: teacherId, organizationId } });
    if (!teacher) throw new NotFoundException('Преподаватель не найден');
    const settings = await this.settings.getEffective(organizationId);
    const today = todayInTimezone(settings.timezone);
    const streams = await this.planning.getStreams({
      organizationId,
      teacherId,
      semesterIds: semesterId ? [semesterId] : undefined,
      includeInactiveGroups: true,
    });
    const lessonWhere: Prisma.ScheduleLessonWhereInput = {
      schedulePeriod: { organizationId },
      semesterItem: semesterId ? { semesterId } : undefined,
    };
    const [asTeacher, conductedByTeacher] = await Promise.all([
      this.prisma.scheduleLesson.findMany({
        where: { ...lessonWhere, teacherId },
        select: {
          id: true,
          date: true,
          lessonNumber: true,
          status: true,
          academicHours: true,
          lessonType: true,
          streamKey: true,
          studentGroupId: true,
          semesterCurriculumItemId: true,
          conducted: { select: { status: true, actualHours: true, actualTeacherId: true } },
        },
      }),
      this.prisma.conductedLesson.findMany({
        where: {
          actualTeacherId: teacherId,
          status: ConductedStatus.CONDUCTED,
          scheduleLesson: lessonWhere,
        },
        include: {
          scheduleLesson: {
            select: { date: true, lessonNumber: true, streamKey: true, lessonType: true, teacherId: true },
          },
        },
      }),
    ]);

    // План: потоки (лекции потока — один раз)
    const plannedByType: Record<string, number> = {};
    const seenStream = new Set<string>();
    for (const s of streams) {
      if (s.streamKey && s.subgroupNumber === null) {
        const k = `${s.streamKey}|${s.lessonType}`;
        if (seenStream.has(k)) continue;
        seenStream.add(k);
      }
      plannedByType[s.lessonType] = (plannedByType[s.lessonType] ?? 0) + s.plannedHours;
    }
    const unitKey = (l: { id: string; streamKey: string | null; date: Date; lessonNumber: number }) =>
      l.streamKey ? `${l.streamKey}|${toDateStr(l.date)}|${l.lessonNumber}` : l.id;
    const scheduledByType: Record<string, number> = {};
    const seenUnits = new Set<string>();
    for (const l of asTeacher) {
      if (!ACTIVE_STATUSES.includes(l.status)) continue;
      const u = unitKey(l);
      if (seenUnits.has(u)) continue;
      seenUnits.add(u);
      scheduledByType[l.lessonType] = (scheduledByType[l.lessonType] ?? 0) + l.academicHours;
    }
    const conductedByType: Record<string, number> = {};
    const seenConducted = new Set<string>();
    let substitutedHours = 0;
    for (const c of conductedByTeacher) {
      const u = unitKey({ id: c.scheduleLessonId, ...c.scheduleLesson });
      if (seenConducted.has(u)) continue;
      seenConducted.add(u);
      conductedByType[c.scheduleLesson.lessonType] =
        (conductedByType[c.scheduleLesson.lessonType] ?? 0) + c.actualHours;
      if (c.scheduleLesson.teacherId !== teacherId) substitutedHours += c.actualHours;
    }
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

    // Недельная нагрузка (текущая неделя) и по неделям
    const weekFrom = weekStart(today);
    const weekTo = addDaysStr(weekFrom, 6);
    const weekLessons = new Set(
      asTeacher
        .filter(
          (l) =>
            ACTIVE_STATUSES.includes(l.status) &&
            toDateStr(l.date) >= weekFrom &&
            toDateStr(l.date) <= weekTo,
        )
        .map(unitKey),
    ).size;
    const byWeek = new Map<string, Set<string>>();
    for (const l of asTeacher) {
      if (!ACTIVE_STATUSES.includes(l.status)) continue;
      const w = weekStart(toDateStr(l.date));
      const set = byWeek.get(w) ?? new Set<string>();
      set.add(unitKey(l));
      byWeek.set(w, set);
    }
    const weeks = [...byWeek.entries()]
      .map(([week, set]) => ({ week, lessons: set.size, overload: set.size > teacher.maxWeeklyLessons }))
      .sort((a, b) => a.week.localeCompare(b.week));

    // Разбивка по группам и дисциплинам
    const { rows } = await this.rows({
      organizationId,
      teacherId,
      semesterIds: semesterId ? [semesterId] : undefined,
      includeInactiveGroups: true,
    });
    return {
      teacher: {
        id: teacher.id,
        fullName: teacher.fullName,
        department: teacher.department,
        maxWeeklyLessons: teacher.maxWeeklyLessons,
        maxDailyLessons: teacher.maxDailyLessons,
      },
      planned: { total: sum(plannedByType), byType: plannedByType },
      scheduled: { total: sum(scheduledByType), byType: scheduledByType },
      conducted: { total: sum(conductedByType), byType: conductedByType, substitutedHours },
      remaining: Math.max(0, sum(plannedByType) - sum(conductedByType) + substitutedHours),
      currentWeek: {
        from: weekFrom,
        to: weekTo,
        lessons: weekLessons,
        limit: teacher.maxWeeklyLessons,
        overload: weekLessons > teacher.maxWeeklyLessons,
      },
      weeks,
      overloadWeeks: weeks.filter((w) => w.overload).length,
      rows: rows.map((r) => ({
        ...r,
        // В строке показываем только виды занятий этого преподавателя
        byType: Object.fromEntries(
          Object.entries(r.byType).filter(([type]) =>
            r.teachers.some((t) => t.id === teacherId && t.lessonType === type),
          ),
        ),
      })),
    };
  }

  /** Сводка нагрузки всех преподавателей (для списка и отчёта) */
  async allTeachersWorkload(organizationId: string, semesterId?: string) {
    const teachers = await this.prisma.teacher.findMany({
      where: { organizationId },
      orderBy: { fullName: 'asc' },
    });
    const result = [];
    for (const t of teachers) {
      const w = await this.teacherWorkload(organizationId, t.id, semesterId);
      result.push({
        teacherId: t.id,
        fullName: t.fullName,
        department: t.department,
        isActive: t.isActive,
        planned: w.planned.total,
        scheduled: w.scheduled.total,
        conducted: w.conducted.total,
        substitutedHours: w.conducted.substitutedHours,
        currentWeekLessons: w.currentWeek.lessons,
        maxWeeklyLessons: t.maxWeeklyLessons,
        overloadWeeks: w.overloadWeeks,
        disciplines: Array.from(new Set(w.rows.map((r) => `${r.itemCode} ${r.itemName}`))),
        groups: Array.from(new Set(w.rows.map((r) => r.groupCode))),
        byType: { planned: w.planned.byType, scheduled: w.scheduled.byType, conducted: w.conducted.byType },
      });
    }
    return result;
  }

  /** Сводные данные для дашборда: процент выполнения по текущим семестрам */
  async currentSemestersProgress(organizationId: string) {
    const settings = await this.settings.getEffective(organizationId);
    const today = todayInTimezone(settings.timezone);
    const semesters = await this.prisma.semester.findMany({
      where: {
        program: { organizationId },
        startDate: { lte: parseDate(today) },
        endDate: { gte: parseDate(today) },
      },
      select: { id: true },
    });
    if (semesters.length === 0) return null;
    return this.rows({ organizationId, semesterIds: semesters.map((s) => s.id) });
  }

  static statusLabel(status: HourStatus): string {
    return { NORMAL: 'Норма', RISK: 'Риск', DEFICIT: 'Дефицит', EXCESS: 'Превышение' }[status];
  }
}
