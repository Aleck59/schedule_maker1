import { Injectable, NotFoundException } from '@nestjs/common';
import { ConductedStatus, LessonStatus, LessonType, Prisma } from '@prisma/client';
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
import { PlanningService, streamKeyOf } from '../planning/planning.service';
import { DemandStream, StreamFilter } from '../planning/planning.types';
import { EDUCATION_LEVEL_LABELS } from '../common/utils/labels';
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

  /**
   * Занятия потоков для подсчёта часов. Занятия суммируются в SQL по ключу потока, статусам и
   * признаку «сегодня или позже»: вместо десятков тысяч строк приходят тысячи (см. LessonForHours.count)
   */
  private async loadLessons(streams: DemandStream[], today: string): Promise<LessonForHours[]> {
    if (streams.length === 0) return [];
    const groupIds = Array.from(new Set(streams.map((s) => s.groupId)));
    const itemIds = Array.from(new Set(streams.map((s) => s.semesterItemId)));
    const rows = await this.prisma.$queryRaw<
      Array<{
        g: string;
        i: string;
        t: LessonType;
        sg: number | null;
        s: LessonStatus;
        ax: boolean;
        cs: ConductedStatus | null;
        f: boolean;
        n: number;
        h: number;
        ah: number;
      }>
    >`
      SELECT l."studentGroupId" AS g, l."semesterCurriculumItemId" AS i, l."lessonType"::text AS t,
             l."subgroupNumber" AS sg, l.status::text AS s, l."allowHoursExcess" AS ax,
             c.status::text AS cs, (l.date >= ${today}::date) AS f,
             count(*)::int AS n, sum(l."academicHours")::int AS h, coalesce(sum(c."actualHours"), 0)::int AS ah
      FROM schedule_lessons l
      LEFT JOIN conducted_lessons c ON c."scheduleLessonId" = l.id
      WHERE l."studentGroupId" = ANY(${groupIds}::text[]) AND l."semesterCurriculumItemId" = ANY(${itemIds}::text[])
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8`;
    return rows.map((r, idx) => ({
      id: `agg${idx}`,
      studentGroupId: r.g,
      semesterCurriculumItemId: r.i,
      lessonType: r.t,
      subgroupNumber: r.sg,
      status: r.s,
      academicHours: r.h,
      // Только сравнение с «сегодня» имеет значение для расчёта
      date: r.f ? today : '0000-01-01',
      teacherId: null,
      allowHoursExcess: r.ax,
      conducted: r.cs ? { status: r.cs, actualHours: r.ah, actualTeacherId: null } : null,
      count: r.n,
    }));
  }

  /** @param known потоки этого же фильтра, если они уже прочитаны (чтобы не читать план второй раз) */
  async rows(
    filter: StreamFilter,
    known?: DemandStream[],
  ): Promise<{ rows: HourControlRow[]; summary: HourControlSummary; today: string }> {
    const settings = await this.settings.getEffective(filter.organizationId);
    const today = todayInTimezone(settings.timezone);
    const streams = known ?? (await this.planning.getStreams(filter));
    const lessons = await this.loadLessons(streams, today);
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

  /** Агрегация строк по разрезам: группа, дисциплина, преподаватель, семестр, программа, организация */
  async aggregate(
    filter: StreamFilter,
    by: 'group' | 'discipline' | 'teacher' | 'semester' | 'program' | 'level' | 'college',
  ) {
    const { rows, today } = await this.rows(filter);
    const groups = new Map<string, { key: string; label: string; rows: HourControlRow[] }>();
    const push = (key: string, label: string, row: HourControlRow) => {
      const g = groups.get(key) ?? { key, label, rows: [] };
      g.rows.push(row);
      groups.set(key, g);
    };
    let programTitles = new Map<string, string>();
    let programLevels = new Map<string, string>();
    if (by === 'program' || by === 'level') {
      const programs = await this.prisma.educationalProgram.findMany({
        where: { id: { in: Array.from(new Set(rows.map((r) => r.programId))) } },
        select: { id: true, title: true, specialty: { select: { educationLevel: true } } },
      });
      programTitles = new Map(programs.map((p) => [p.id, p.title]));
      programLevels = new Map(programs.map((p) => [p.id, p.specialty.educationLevel]));
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
        case 'level': {
          const level = programLevels.get(r.programId) ?? 'SPO';
          push(level, EDUCATION_LEVEL_LABELS[level] ?? level, r);
          break;
        }
        case 'college':
          push('college', 'Организация в целом', r);
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
  async teacherWorkload(organizationId: string, teacherId: string, semester?: string | string[]) {
    const semesterIds = semester === undefined ? undefined : Array.isArray(semester) ? semester : [semester];
    const teacher = await this.prisma.teacher.findFirst({ where: { id: teacherId, organizationId } });
    if (!teacher) throw new NotFoundException('Преподаватель не найден');
    const settings = await this.settings.getEffective(organizationId);
    const today = todayInTimezone(settings.timezone);
    const streams = await this.planning.getStreams({
      organizationId,
      teacherId,
      semesterIds,
      includeInactiveGroups: true,
    });
    const lessonWhere: Prisma.ScheduleLessonWhereInput = {
      schedulePeriod: { organizationId },
      semesterItem: semesterIds ? { semesterId: { in: semesterIds } } : undefined,
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

    // Смена преподавателя в середине семестра: часы, которые по дисциплине провёл (или ведёт) другой
    // преподаватель, остаются в его плане и вычитаются из плана текущего. Владелец часов занятия —
    // преподаватель по расписанию, а при замене — заменённый (замена не меняет план)
    const myKeys = new Set(streams.map((s) => s.key));
    const lessonOwner = (l: {
      teacherId: string | null;
      substitutions: { originalTeacherId: string | null }[];
    }) => l.substitutions[0]?.originalTeacherId ?? l.teacherId;
    const ownSelect = {
      id: true,
      date: true,
      lessonNumber: true,
      streamKey: true,
      teacherId: true,
      studentGroupId: true,
      semesterCurriculumItemId: true,
      lessonType: true,
      subgroupNumber: true,
      academicHours: true,
      substitutions: { select: { originalTeacherId: true }, orderBy: { createdAt: 'asc' as const } },
    } satisfies Prisma.ScheduleLessonSelect;
    const [inMyStreams, ownedLessons] = await Promise.all([
      streams.length
        ? this.prisma.scheduleLesson.findMany({
            where: {
              ...lessonWhere,
              studentGroupId: { in: [...new Set(streams.map((s) => s.groupId))] },
              semesterCurriculumItemId: { in: [...new Set(streams.map((s) => s.semesterItemId))] },
              status: { in: ACTIVE_STATUSES },
            },
            select: ownSelect,
          })
        : [],
      this.prisma.scheduleLesson.findMany({
        where: {
          ...lessonWhere,
          status: { in: ACTIVE_STATUSES },
          OR: [{ teacherId }, { substitutions: { some: { originalTeacherId: teacherId } } }],
        },
        select: ownSelect,
      }),
    ]);
    const handedOver = new Map<string, number>();
    for (const l of inMyStreams) {
      const owner = lessonOwner(l);
      if (!owner || owner === teacherId) continue;
      const key = streamKeyOf(l.studentGroupId, l.semesterCurriculumItemId, l.lessonType, l.subgroupNumber);
      if (myKeys.has(key)) handedOver.set(key, (handedOver.get(key) ?? 0) + l.academicHours);
    }

    // План: потоки (лекции потока — один раз)
    const plannedByType: Record<string, number> = {};
    const seenStream = new Set<string>();
    let handedOverHours = 0;
    for (const s of streams) {
      if (s.streamKey && s.subgroupNumber === null) {
        const k = `${s.streamKey}|${s.lessonType}`;
        if (seenStream.has(k)) continue;
        seenStream.add(k);
      }
      const other = Math.min(s.plannedHours, handedOver.get(s.key) ?? 0);
      handedOverHours += other;
      plannedByType[s.lessonType] = (plannedByType[s.lessonType] ?? 0) + s.plannedHours - other;
    }
    // Занятия по дисциплинам, которые теперь ведёт другой преподаватель, остаются в плане этого
    let previousHours = 0;
    const seenPrevious = new Set<string>();
    for (const l of ownedLessons) {
      if (lessonOwner(l) !== teacherId) continue;
      if (
        myKeys.has(streamKeyOf(l.studentGroupId, l.semesterCurriculumItemId, l.lessonType, l.subgroupNumber))
      )
        continue;
      const u = l.streamKey ? `${l.streamKey}|${toDateStr(l.date)}|${l.lessonNumber}` : l.id;
      if (seenPrevious.has(u)) continue;
      seenPrevious.add(u);
      previousHours += l.academicHours;
      plannedByType[l.lessonType] = (plannedByType[l.lessonType] ?? 0) + l.academicHours;
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
    const { rows } = await this.rows(
      { organizationId, teacherId, semesterIds, includeInactiveGroups: true },
      streams,
    );
    return {
      teacher: {
        id: teacher.id,
        fullName: teacher.fullName,
        department: teacher.department,
        maxWeeklyLessons: teacher.maxWeeklyLessons,
        maxDailyLessons: teacher.maxDailyLessons,
      },
      planned: { total: sum(plannedByType), byType: plannedByType, handedOverHours, previousHours },
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

  /**
   * Сводка нагрузки всех преподавателей (для списка и отчёта).
   * Считается теми же правилами, что и {@link teacherWorkload}, но данные загружаются одним
   * набором запросов на всю организацию, а не по каждому преподавателю
   */
  async allTeachersWorkload(organizationId: string, semesterId?: string, current = false) {
    const teachers = await this.prisma.teacher.findMany({
      where: { organizationId },
      orderBy: { fullName: 'asc' },
    });
    // «Текущие семестры» — все семестры организации (СПО и ВО), в которые попадает сегодняшний день
    const semesterIds = semesterId
      ? [semesterId]
      : current
        ? await this.currentSemesterIds(organizationId)
        : undefined;
    const settings = await this.settings.getEffective(organizationId);
    const today = todayInTimezone(settings.timezone);
    // Все занятия организации — десятки тысяч строк. Через SQL с JOIN, а не через связи Prisma:
    // так нет списков IN на десятки тысяч id и вдвое меньше работы по разбору строк
    const semFilter = semesterIds
      ? Prisma.sql`AND sci."semesterId" = ANY(${semesterIds}::text[])`
      : Prisma.empty;
    const [allStreams, lessons, conducted] = await Promise.all([
      this.planning.getStreams({ organizationId, semesterIds, includeInactiveGroups: true }),
      this.prisma.$queryRaw<
        Array<{
          id: string;
          date: Date;
          lessonNumber: number;
          status: LessonStatus;
          academicHours: number;
          lessonType: LessonType;
          streamKey: string | null;
          teacherId: string | null;
          studentGroupId: string;
          semesterCurriculumItemId: string;
          subgroupNumber: number | null;
          /** Заменённый преподаватель первой замены — владелец часов занятия */
          originalTeacherId: string | null;
        }>
      >`
        SELECT l.id, l.date, l."lessonNumber", l.status::text AS status, l."academicHours",
               l."lessonType"::text AS "lessonType", l."streamKey", l."teacherId", l."studentGroupId",
               l."semesterCurriculumItemId", l."subgroupNumber",
               (SELECT ts."originalTeacherId" FROM teacher_substitutions ts
                 WHERE ts."scheduleLessonId" = l.id ORDER BY ts."createdAt" ASC LIMIT 1) AS "originalTeacherId"
        FROM schedule_lessons l
        JOIN schedule_periods sp ON sp.id = l."schedulePeriodId"
        JOIN semester_curriculum_items sci ON sci.id = l."semesterCurriculumItemId"
        WHERE sp."organizationId" = ${organizationId} ${semFilter}`,
      this.prisma.$queryRaw<
        Array<{
          scheduleLessonId: string;
          actualHours: number;
          actualTeacherId: string;
          date: Date;
          lessonNumber: number;
          streamKey: string | null;
          lessonType: LessonType;
          teacherId: string | null;
        }>
      >`
        SELECT c."scheduleLessonId", c."actualHours", c."actualTeacherId", l.date, l."lessonNumber",
               l."streamKey", l."lessonType"::text AS "lessonType", l."teacherId"
        FROM conducted_lessons c
        JOIN schedule_lessons l ON l.id = c."scheduleLessonId"
        JOIN schedule_periods sp ON sp.id = l."schedulePeriodId"
        JOIN semester_curriculum_items sci ON sci.id = l."semesterCurriculumItemId"
        WHERE c.status = 'CONDUCTED' AND c."actualTeacherId" IS NOT NULL
          AND sp."organizationId" = ${organizationId} ${semFilter}`,
    ]);

    const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
      const list = map.get(key);
      if (list) list.push(value);
      else map.set(key, [value]);
    };
    type L = (typeof lessons)[number];
    const lessonOwner = (l: L) => l.originalTeacherId ?? l.teacherId;
    const keyOf = (l: L) =>
      streamKeyOf(l.studentGroupId, l.semesterCurriculumItemId, l.lessonType, l.subgroupNumber);
    const unitKey = (l: { id: string; streamKey: string | null; date: Date; lessonNumber: number }) =>
      l.streamKey ? `${l.streamKey}|${toDateStr(l.date)}|${l.lessonNumber}` : l.id;

    const streamsByTeacher = new Map<string, DemandStream[]>();
    for (const s of allStreams) if (s.teacherId) push(streamsByTeacher, s.teacherId, s);
    const asTeacherBy = new Map<string, L[]>();
    const ownedBy = new Map<string, L[]>();
    const activeByKey = new Map<string, L[]>();
    for (const l of lessons) {
      if (l.teacherId) push(asTeacherBy, l.teacherId, l);
      if (!ACTIVE_STATUSES.includes(l.status)) continue;
      const owner = lessonOwner(l);
      if (owner) push(ownedBy, owner, l);
      push(activeByKey, keyOf(l), l);
    }
    const conductedBy = new Map<string, typeof conducted>();
    for (const c of conducted) push(conductedBy, c.actualTeacherId, c);

    const weekFrom = weekStart(today);
    const weekTo = addDaysStr(weekFrom, 6);
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

    return teachers.map((t) => {
      const streams = streamsByTeacher.get(t.id) ?? [];
      const myKeys = new Set(streams.map((s) => s.key));
      // Часы по дисциплинам, которые провёл (или ведёт) другой преподаватель
      const handedOver = new Map<string, number>();
      for (const key of myKeys) {
        for (const l of activeByKey.get(key) ?? []) {
          const owner = lessonOwner(l);
          if (!owner || owner === t.id) continue;
          handedOver.set(key, (handedOver.get(key) ?? 0) + l.academicHours);
        }
      }
      const plannedByType: Record<string, number> = {};
      const seenStream = new Set<string>();
      for (const s of streams) {
        if (s.streamKey && s.subgroupNumber === null) {
          const k = `${s.streamKey}|${s.lessonType}`;
          if (seenStream.has(k)) continue;
          seenStream.add(k);
        }
        const other = Math.min(s.plannedHours, handedOver.get(s.key) ?? 0);
        plannedByType[s.lessonType] = (plannedByType[s.lessonType] ?? 0) + s.plannedHours - other;
      }
      const seenPrevious = new Set<string>();
      for (const l of ownedBy.get(t.id) ?? []) {
        if (myKeys.has(keyOf(l))) continue;
        const u = unitKey(l);
        if (seenPrevious.has(u)) continue;
        seenPrevious.add(u);
        plannedByType[l.lessonType] = (plannedByType[l.lessonType] ?? 0) + l.academicHours;
      }

      const scheduledByType: Record<string, number> = {};
      const byWeek = new Map<string, Set<string>>();
      const thisWeek = new Set<string>();
      const seenUnits = new Set<string>();
      for (const l of asTeacherBy.get(t.id) ?? []) {
        if (!ACTIVE_STATUSES.includes(l.status)) continue;
        const u = unitKey(l);
        const date = toDateStr(l.date);
        const w = weekStart(date);
        const set = byWeek.get(w) ?? new Set<string>();
        byWeek.set(w, set);
        set.add(u);
        if (date >= weekFrom && date <= weekTo) thisWeek.add(u);
        if (seenUnits.has(u)) continue;
        seenUnits.add(u);
        scheduledByType[l.lessonType] = (scheduledByType[l.lessonType] ?? 0) + l.academicHours;
      }

      const conductedByType: Record<string, number> = {};
      const seenConducted = new Set<string>();
      let substitutedHours = 0;
      for (const c of conductedBy.get(t.id) ?? []) {
        const u = unitKey({ id: c.scheduleLessonId, ...c });
        if (seenConducted.has(u)) continue;
        seenConducted.add(u);
        conductedByType[c.lessonType] = (conductedByType[c.lessonType] ?? 0) + c.actualHours;
        if (c.teacherId !== t.id) substitutedHours += c.actualHours;
      }

      const overloadWeeks = [...byWeek.values()].filter((set) => set.size > t.maxWeeklyLessons).length;
      // Группы и дисциплины — в том же порядке, что строки контроля часов преподавателя
      const rows = new Map<string, DemandStream>();
      for (const s of streams) {
        const key = `${s.groupId}|${s.semesterItemId}|${s.subgroupNumber ?? 0}`;
        if (!rows.has(key)) rows.set(key, s);
      }
      const sorted = [...rows.values()].sort(
        (a, b) =>
          a.groupCode.localeCompare(b.groupCode) ||
          a.semesterNumber - b.semesterNumber ||
          a.itemCode.localeCompare(b.itemCode, 'ru', { numeric: true }) ||
          (a.subgroupNumber ?? 0) - (b.subgroupNumber ?? 0),
      );
      return {
        teacherId: t.id,
        fullName: t.fullName,
        department: t.department,
        isActive: t.isActive,
        planned: sum(plannedByType),
        scheduled: sum(scheduledByType),
        conducted: sum(conductedByType),
        substitutedHours,
        currentWeekLessons: thisWeek.size,
        maxWeeklyLessons: t.maxWeeklyLessons,
        overloadWeeks,
        disciplines: Array.from(new Set(sorted.map((r) => `${r.itemCode} ${r.itemName}`))),
        groups: Array.from(new Set(sorted.map((r) => r.groupCode))),
        byType: { planned: plannedByType, scheduled: scheduledByType, conducted: conductedByType },
      };
    });
  }

  /** Семестры организации, в которые попадает сегодняшний день */
  async currentSemesterIds(organizationId: string): Promise<string[]> {
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
    return semesters.map((s) => s.id);
  }

  /** Сводные данные для дашборда: процент выполнения по текущим семестрам */
  async currentSemestersProgress(organizationId: string) {
    const semesterIds = await this.currentSemesterIds(organizationId);
    if (semesterIds.length === 0) return null;
    return this.rows({ organizationId, semesterIds });
  }

  static statusLabel(status: HourStatus): string {
    return { NORMAL: 'Норма', RISK: 'Риск', DEFICIT: 'Дефицит', EXCESS: 'Превышение' }[status];
  }
}
