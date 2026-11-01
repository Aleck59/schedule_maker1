import { cumulativeTargetByDays, effectiveRate, pacingPhases, teacherLimits } from './pacing';
import {
  SolverDemand,
  SolverPlacement,
  SolverProblem,
  SolverResult,
  SolverRoom,
  SolverTeacher,
} from './solver.types';

/**
 * Встроенный эвристический генератор расписания (резервный к OR-Tools CP-SAT).
 *
 * Алгоритм:
 *  1. Горизонт планирования разбивается на недели. Для каждой дисциплины (потока спроса)
 *     вычисляется накопительная цель — сколько пар должно быть поставлено к концу недели
 *     (равномерное распределение + компенсация отставания).
 *  2. Внутри недели занятия ставятся «жадно» по принципу «самый ограниченный — первым»:
 *     для каждой пары перебираются все допустимые слоты (дата × номер пары × аудитория),
 *     проверяются жёсткие ограничения и выбирается слот с минимальным штрафом мягких ограничений.
 *  3. Если слот не найден — выполняется ремонт (backtracking глубины 1): блокирующее занятие
 *     переносится в другой допустимый слот, освобождая место.
 *  4. Финальный проход компенсации ставит оставшиеся пары в любые свободные слоты.
 *  5. Для режима постоянного недельного расписания сначала строится шаблон недели,
 *     затем он разворачивается по датам с учётом блокировок, после чего выполняется компенсация.
 */

interface DayRef {
  key: string;
  weekday: number;
  week: number;
}

interface Placed {
  id: number;
  demand: DemandState;
  day: DayRef;
  lesson: number;
  roomId: string | null;
  fixed: boolean;
}

interface DemandState {
  d: SolverDemand;
  teacher: SolverTeacher;
  allowedDays: Set<string>;
  rate: number;
  availableWeeks: number[];
  /** Число доступных дней по неделям */
  daysByWeek: Map<number, number>;
  totalDays: number;
  /** Сдвиг округления темпа (см. pacingPhases) */
  phase: number;
  placed: number;
}

const DEFAULT_WEIGHTS: Record<string, number> = {
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
  maxPlacementOverflow: 40,
};

function gaps(set: Set<number> | undefined, extra?: number): number {
  if (!set || set.size === 0) {
    return 0;
  }
  let min = Infinity;
  let max = -Infinity;
  let count = 0;
  for (const v of set) {
    min = Math.min(min, v);
    max = Math.max(max, v);
    count++;
  }
  if (extra !== undefined && !set.has(extra)) {
    min = Math.min(min, extra);
    max = Math.max(max, extra);
    count++;
  }
  return max - min + 1 - count;
}

class ScheduleState {
  readonly groupSlot = new Map<string, Set<number>>();
  readonly teacherSlot = new Set<string>();
  readonly roomSlot = new Map<string, number>();
  readonly teacherDay = new Map<string, Set<number>>();
  readonly teacherWeek = new Map<string, number>();
  readonly perspectiveDay = new Map<string, Set<number>>();
  readonly disciplineDay = new Map<string, Set<number>>();
  readonly disciplineDayCount = new Map<string, number>();
  readonly disciplineWeek = new Map<string, number>();
  readonly groupDayBuildings = new Map<string, Map<string, number>>();
  readonly slotIndex = new Map<string, Placed[]>();
  readonly placements: Placed[] = [];
  private seq = 0;

  constructor(
    private readonly problem: SolverProblem,
    private readonly roomsById: Map<string, SolverRoom>,
    private readonly subgroupsByGroup: Map<string, number[]>,
  ) {}

  perspectivesFor(groupId: string, subgroup: number | null): number[] {
    const subs = this.subgroupsByGroup.get(groupId) ?? [];
    if (subs.length === 0) return [0];
    return subgroup === null ? subs : [subgroup];
  }

  apply(p: Omit<Placed, 'id'>): Placed {
    const placed: Placed = { ...p, id: ++this.seq };
    this.mutate(placed, +1);
    this.placements.push(placed);
    return placed;
  }

  remove(p: Placed) {
    const idx = this.placements.indexOf(p);
    if (idx >= 0) this.placements.splice(idx, 1);
    this.mutate(p, -1);
  }

  private mutate(p: Placed, sign: 1 | -1) {
    const { demand, day, lesson, roomId } = p;
    const d = demand.d;
    const slot = `${day.key}#${lesson}`;
    for (const g of d.groupIds) {
      const key = `${g}#${slot}`;
      const set = this.groupSlot.get(key) ?? new Set<number>();
      const marker = d.subgroupNumber ?? 0;
      if (sign > 0) set.add(marker);
      else set.delete(marker);
      this.groupSlot.set(key, set);
      for (const persp of this.perspectivesFor(g, d.subgroupNumber)) {
        const pk = `${g}#${persp}#${day.key}`;
        const ps = this.perspectiveDay.get(pk) ?? new Set<number>();
        if (sign > 0) ps.add(lesson);
        else ps.delete(lesson);
        this.perspectiveDay.set(pk, ps);
      }
      const room = roomId ? this.roomsById.get(roomId) : undefined;
      if (room?.building) {
        const bk = `${g}#${day.key}`;
        const map = this.groupDayBuildings.get(bk) ?? new Map<string, number>();
        map.set(room.building, (map.get(room.building) ?? 0) + sign);
        if ((map.get(room.building) ?? 0) <= 0) map.delete(room.building);
        this.groupDayBuildings.set(bk, map);
      }
    }
    if (d.teacherId) {
      const tk = `${d.teacherId}#${slot}`;
      if (sign > 0) this.teacherSlot.add(tk);
      else this.teacherSlot.delete(tk);
      const tdk = `${d.teacherId}#${day.key}`;
      const td = this.teacherDay.get(tdk) ?? new Set<number>();
      if (sign > 0) td.add(lesson);
      else td.delete(lesson);
      this.teacherDay.set(tdk, td);
      const twk = `${d.teacherId}#${day.week}`;
      this.teacherWeek.set(twk, (this.teacherWeek.get(twk) ?? 0) + sign);
    }
    if (roomId) {
      const rk = `${roomId}#${slot}`;
      this.roomSlot.set(rk, (this.roomSlot.get(rk) ?? 0) + sign);
    }
    for (const dk of d.disciplineKeys) {
      const ddk = `${dk}#${day.key}`;
      const countKey = `${ddk}#${lesson}`;
      const c = (this.disciplineDayCount.get(countKey) ?? 0) + sign;
      this.disciplineDayCount.set(countKey, c);
      const set = this.disciplineDay.get(ddk) ?? new Set<number>();
      if (c > 0) set.add(lesson);
      else set.delete(lesson);
      this.disciplineDay.set(ddk, set);
      const dwk = `${dk}#${day.week}`;
      this.disciplineWeek.set(dwk, (this.disciplineWeek.get(dwk) ?? 0) + sign);
    }
    const list = this.slotIndex.get(slot) ?? [];
    if (sign > 0) list.push(p);
    else {
      const i = list.indexOf(p);
      if (i >= 0) list.splice(i, 1);
    }
    this.slotIndex.set(slot, list);
  }

  /** Фиксированная занятость (занятия, уже существующие в БД) */
  occupy(o: {
    dayKey: string;
    week: number;
    lesson: number;
    groupId: string | null;
    subgroup: number | null;
    teacherId: string | null;
    roomId: string | null;
    disciplineKey: string | null;
  }) {
    const slot = `${o.dayKey}#${o.lesson}`;
    if (o.groupId) {
      const key = `${o.groupId}#${slot}`;
      const set = this.groupSlot.get(key) ?? new Set<number>();
      set.add(o.subgroup ?? 0);
      this.groupSlot.set(key, set);
      for (const persp of this.perspectivesFor(o.groupId, o.subgroup)) {
        const pk = `${o.groupId}#${persp}#${o.dayKey}`;
        const ps = this.perspectiveDay.get(pk) ?? new Set<number>();
        ps.add(o.lesson);
        this.perspectiveDay.set(pk, ps);
      }
    }
    if (o.teacherId) {
      this.teacherSlot.add(`${o.teacherId}#${slot}`);
      const tdk = `${o.teacherId}#${o.dayKey}`;
      const td = this.teacherDay.get(tdk) ?? new Set<number>();
      td.add(o.lesson);
      this.teacherDay.set(tdk, td);
      const twk = `${o.teacherId}#${o.week}`;
      this.teacherWeek.set(twk, (this.teacherWeek.get(twk) ?? 0) + 1);
    }
    if (o.roomId) {
      const rk = `${o.roomId}#${slot}`;
      this.roomSlot.set(rk, (this.roomSlot.get(rk) ?? 0) + 1);
    }
    if (o.disciplineKey) {
      const ddk = `${o.disciplineKey}#${o.dayKey}`;
      const countKey = `${ddk}#${o.lesson}`;
      this.disciplineDayCount.set(countKey, (this.disciplineDayCount.get(countKey) ?? 0) + 1);
      const set = this.disciplineDay.get(ddk) ?? new Set<number>();
      set.add(o.lesson);
      this.disciplineDay.set(ddk, set);
      const dwk = `${o.disciplineKey}#${o.week}`;
      this.disciplineWeek.set(dwk, (this.disciplineWeek.get(dwk) ?? 0) + 1);
    }
  }
}

export interface HeuristicOptions {
  onProgress?: (fraction: number, message: string) => void;
  /** Ограничение на число попыток ремонта в неделе */
  repairLimit?: number;
  /**
   * Доработка готового решения (например, CP-SAT): занятия берутся как есть, затем недопоставленные
   * пары досаживаются по оставшимся неделям и выполняется доводка окон
   */
  initial?: SolverPlacement[];
  /**
   * Только шаблон недели (постоянное расписание для руководства): без развёртки по датам.
   * Дата размещения — «T<день недели>», дробный темп даёт пары по числителю/знаменателю.
   */
  templateOnly?: boolean;
}

/**
 * Число пар дисциплины в типовой неделе по темпу (пар в неделю): целая часть каждую неделю,
 * дробная от ¼ до ¾ — одна пара через неделю (числитель/знаменатель), больше ¾ — ещё пара каждую неделю
 */
export function weeklySlots(rate: number, required: number): { weekly: number; biweekly: boolean } {
  if (required <= 0 || rate <= 0) return { weekly: 0, biweekly: false };
  let weekly = Math.floor(rate + 1e-9);
  const frac = rate - weekly;
  let biweekly = false;
  if (frac >= 0.75 - 1e-9) weekly++;
  else if (frac >= 0.25 - 1e-9) biweekly = true;
  if (weekly === 0 && !biweekly) biweekly = true;
  return { weekly: Math.min(weekly, required), biweekly };
}

export function solveHeuristic(problem: SolverProblem, options: HeuristicOptions = {}): SolverResult {
  const started = Date.now();
  const log: string[] = [];
  const weights = { ...DEFAULT_WEIGHTS, ...(problem.weights ?? {}) };
  const deadline = started + Math.max(5, problem.timeLimitSeconds) * 1000;
  const roomsById = new Map(problem.rooms.map((r) => [r.id, r]));
  const teachersById = new Map(problem.teachers.map((t) => [t.id, t]));
  const groupsById = new Map(problem.groups.map((g) => [g.id, g]));
  const subgroupsByGroup = new Map<string, number[]>();
  for (const g of problem.groups) subgroupsByGroup.set(g.id, [...g.subgroups]);
  for (const d of problem.demands) {
    if (d.subgroupNumber !== null) {
      for (const g of d.groupIds) {
        const list = subgroupsByGroup.get(g) ?? [];
        if (!list.includes(d.subgroupNumber)) list.push(d.subgroupNumber);
        subgroupsByGroup.set(g, list);
      }
    }
  }
  const lessonsPerDay = problem.lessonsPerDay;
  const settings = problem.settings;
  /**
   * Проход «по максимуму»: лимиты пар преподавателя в день и в неделю, число пар дисциплины в день
   * и запрет поздних пар не отсекают слоты, а только штрафуются
   */
  let relaxed = false;

  const unavailableTeacher = new Map<string, Set<string>>();
  const preferenceTeacher = new Map<string, Map<string, number>>();
  for (const t of problem.teachers) {
    unavailableTeacher.set(t.id, new Set(t.unavailable.map(([w, l]) => `${w}#${l}`)));
    preferenceTeacher.set(t.id, new Map(t.preferences.map(([w, l, v]) => [`${w}#${l}`, v])));
  }
  // Гибкие правила доступности: слоты конкретных дат (недели месяца, чётность, время, онлайн)
  const blockedSlotTeacher = new Map<string, Set<string>>();
  const slotPrefTeacher = new Map<string, Map<string, number>>();
  const onlineSlotTeacher = new Map<string, Set<string>>();
  for (const t of problem.teachers) {
    blockedSlotTeacher.set(t.id, new Set((t.blockedSlots ?? []).map(([d, l]) => `${d}#${l}`)));
    slotPrefTeacher.set(t.id, new Map((t.slotPreferences ?? []).map(([d, l, v]) => [`${d}#${l}`, v])));
    onlineSlotTeacher.set(t.id, new Set((t.onlineSlots ?? []).map(([d, l]) => `${d}#${l}`)));
  }
  const onlineRoom = problem.onlineRoomId ? (roomsById.get(problem.onlineRoomId) ?? null) : null;
  const teacherUnavailableAt = (teacherId: string, day: DayRef, lesson: number) =>
    unavailableTeacher.get(teacherId)?.has(`${day.weekday}#${lesson}`) ||
    blockedSlotTeacher.get(teacherId)?.has(`${day.key}#${lesson}`) ||
    false;
  /** Аудитории для слота: онлайн-слот преподавателя — только онлайн-аудитория */
  const roomIdsFor = (ds: DemandState, day: DayRef, lesson: number): string[] =>
    onlineRoom && onlineSlotTeacher.get(ds.teacher.id)?.has(`${day.key}#${lesson}`)
      ? [onlineRoom.id]
      : ds.d.roomIds;

  const unavailableRoom = new Map<string, Set<string>>();
  for (const r of problem.rooms)
    unavailableRoom.set(r.id, new Set(r.unavailable.map(([w, l]) => `${w}#${l}`)));

  const daysByWeek = new Map<number, DayRef[]>();
  for (const day of problem.days) {
    const list = daysByWeek.get(day.week) ?? [];
    list.push({ key: day.date, weekday: day.weekday, week: day.week });
    daysByWeek.set(day.week, list);
  }
  const weeks = [...daysByWeek.keys()].sort((a, b) => a - b);

  // --- Состояния спроса
  const demands: DemandState[] = [];
  for (const d of problem.demands) {
    const teacher = teachersById.get(d.teacherId);
    if (!teacher || d.lessonsRequired <= 0) continue;
    // Явно заданные даты (практика, консультации) заменяют даты обычных занятий группы
    let allowed = null as Set<string> | null;
    if (d.allowedDates) {
      allowed = new Set(d.allowedDates);
    } else {
      for (const gId of d.groupIds) {
        const g = groupsById.get(gId);
        const gs = new Set(g?.allowedDates ?? []);
        allowed = allowed ? new Set([...allowed].filter((x) => gs.has(x))) : gs;
      }
    }
    const blocked = new Set(teacher.blockedDates);
    const allowedDays = new Set([...(allowed ?? [])].filter((x) => !blocked.has(x)));
    const dayCounts = new Map<number, number>();
    for (const w of weeks) {
      const count = (daysByWeek.get(w) ?? []).filter((day) => allowedDays.has(day.key)).length;
      if (count > 0) dayCounts.set(w, count);
    }
    const availableWeeks = [...dayCounts.keys()];
    demands.push({
      d,
      teacher,
      allowedDays,
      availableWeeks,
      daysByWeek: dayCounts,
      totalDays: [...dayCounts.values()].reduce((a, b) => a + b, 0),
      rate: effectiveRate(d.lessonsRequired, availableWeeks.length, d.weeklyRate),
      phase: 0,
      placed: 0,
    });
  }
  // Дисциплины одного преподавателя получают разные сдвиги округления — нагрузка по неделям ровная
  const byTeacher = new Map<string, DemandState[]>();
  for (const ds of demands) byTeacher.set(ds.teacher.id, [...(byTeacher.get(ds.teacher.id) ?? []), ds]);
  for (const list of byTeacher.values()) {
    const phases = pacingPhases(list.length);
    [...list]
      .sort((a, b) => (a.d.id < b.d.id ? -1 : a.d.id > b.d.id ? 1 : 0))
      .forEach((ds, k) => (ds.phase = phases[k]));
  }

  const makeState = () => new ScheduleState(problem, roomsById, subgroupsByGroup);
  /** Накопительная цель демандa к концу недели w (с учётом доступных дней) */
  const paceProgress = new Map<DemandState, { days: number; weeks: number }>();
  const targetThrough = (ds: DemandState, w: number) => {
    const p = paceProgress.get(ds) ?? { days: 0, weeks: 0 };
    p.days += ds.daysByWeek.get(w) ?? 0;
    p.weeks += 1;
    paceProgress.set(ds, p);
    return cumulativeTargetByDays(
      ds.d.lessonsRequired,
      p.days,
      ds.totalDays,
      p.weeks,
      ds.d.weeklyRate,
      ds.phase,
    );
  };
  const state = makeState();
  const dayRefByDate = new Map(
    problem.days.map((d) => [d.date, { key: d.date, weekday: d.weekday, week: d.week }]),
  );
  for (const o of problem.occupied) {
    const day = dayRefByDate.get(o.date);
    if (!day) continue;
    state.occupy({
      dayKey: o.date,
      week: day.week,
      lesson: o.lessonNumber,
      groupId: o.groupId,
      subgroup: o.subgroupNumber,
      teacherId: o.teacherId,
      roomId: o.roomId,
      disciplineKey: o.disciplineKey,
    });
  }

  // --- Проверки и штрафы
  const teacherFree = (st: ScheduleState, ds: DemandState, day: DayRef, lesson: number, weekLimit = true) => {
    const t = ds.teacher;
    if (teacherUnavailableAt(t.id, day, lesson)) return false;
    if (st.teacherSlot.has(`${t.id}#${day.key}#${lesson}`)) return false;
    if (relaxed) return true;
    const limits = teacherLimits(t, day.key);
    const td = st.teacherDay.get(`${t.id}#${day.key}`);
    if (td && td.size >= limits.daily && !td.has(lesson)) return false;
    if (weekLimit && (st.teacherWeek.get(`${t.id}#${day.week}`) ?? 0) >= limits.weekly) return false;
    return true;
  };

  const groupFree = (st: ScheduleState, ds: DemandState, day: DayRef, lesson: number) => {
    const sub = ds.d.subgroupNumber;
    for (const g of ds.d.groupIds) {
      const set = st.groupSlot.get(`${g}#${day.key}#${lesson}`);
      if (!set || set.size === 0) continue;
      if (sub === null) return false;
      if (set.has(0) || set.has(sub)) return false;
    }
    return true;
  };

  const disciplineOk = (st: ScheduleState, ds: DemandState, day: DayRef, lesson: number) => {
    if (relaxed) return true;
    for (const dk of ds.d.disciplineKeys) {
      const set = st.disciplineDay.get(`${dk}#${day.key}`);
      if (set && !set.has(lesson) && set.size >= settings.maxSameDisciplinePerDay) return false;
    }
    return true;
  };

  const roomFree = (st: ScheduleState, room: SolverRoom, day: DayRef, lesson: number) => {
    if (unavailableRoom.get(room.id)?.has(`${day.weekday}#${lesson}`)) return false;
    if (room.unlimited) return true;
    return (st.roomSlot.get(`${room.id}#${day.key}#${lesson}`) ?? 0) === 0;
  };

  const groupLessons = new Map(
    problem.groups.filter((g) => g.allowedLessons?.length).map((g) => [g.id, new Set(g.allowedLessons)]),
  );
  const slotAllowed = (ds: DemandState, day: DayRef, lesson: number) => {
    if (lesson > lessonsPerDay) return false;
    if (settings.forbidLateLessons && lesson >= settings.lateLessonNumber && !relaxed) return false;
    for (const g of ds.d.groupIds) {
      const allowed = groupLessons.get(g);
      if (allowed && !allowed.has(lesson)) return false;
    }
    return ds.allowedDays.has(day.key);
  };

  const slotCost = (st: ScheduleState, ds: DemandState, day: DayRef, lesson: number): number => {
    const d = ds.d;
    let cost = 0;
    for (const g of d.groupIds) {
      const group = groupsById.get(g);
      for (const persp of st.perspectivesFor(g, d.subgroupNumber)) {
        const set = st.perspectiveDay.get(`${g}#${persp}#${day.key}`);
        if (settings.avoidWindows) {
          cost += (gaps(set, lesson) - gaps(set)) * weights.groupWindows;
        }
        const count = (set?.size ?? 0) + (set?.has(lesson) ? 0 : 1);
        if (group && count > group.maxLessonsPerDay)
          cost += weights.groupDailyOverload * (count - group.maxLessonsPerDay);
        cost += (weights.evenDistribution / 5) * (set?.size ?? 0);
      }
    }
    const td = st.teacherDay.get(`${d.teacherId}#${day.key}`);
    if (settings.avoidWindows) cost += (gaps(td, lesson) - gaps(td)) * weights.teacherWindows;
    if (lesson >= settings.lateLessonNumber)
      cost += weights.lateLessons * (lesson - settings.lateLessonNumber + 1);
    if (settings.respectTeacherPreferences) {
      const t = ds.teacher;
      if (lesson < t.preferredStartLesson || lesson > t.preferredEndLesson) cost += weights.teacherPreference;
      const pref =
        (preferenceTeacher.get(t.id)?.get(`${day.weekday}#${lesson}`) ?? 0) +
        (slotPrefTeacher.get(t.id)?.get(`${day.key}#${lesson}`) ?? 0);
      cost -= pref * (weights.teacherPreference / 5);
    }
    if (d.isDifficult && lesson >= Math.max(4, settings.lateLessonNumber - 1)) cost += weights.difficultLate;
    if (relaxed) cost += overflowCost(st, ds, day, lesson);
    for (const dk of d.disciplineKeys) {
      const wk = st.disciplineWeek.get(`${dk}#${day.week}`) ?? 0;
      if (wk >= settings.maxSameDisciplinePerWeek) cost += weights.disciplineWeekly;
      const dd = st.disciplineDay.get(`${dk}#${day.key}`);
      if (dd && dd.size > 0 && !dd.has(lesson)) {
        // Спаренные пары допустимы, разрывы между парами одной дисциплины — нет
        const adjacent = dd.has(lesson - 1) || dd.has(lesson + 1);
        cost += adjacent ? weights.sameDayDiscipline : weights.sameDayDiscipline * 2;
      }
    }
    cost += lesson * 0.3;
    return cost;
  };

  /** Штраф за выход за ослабленные ограничения в проходе «по максимуму» */
  const overflowCost = (st: ScheduleState, ds: DemandState, day: DayRef, lesson: number): number => {
    let over = 0;
    const t = ds.teacher;
    const limits = teacherLimits(t, day.key);
    const td = st.teacherDay.get(`${t.id}#${day.key}`);
    if (!td?.has(lesson) && (td?.size ?? 0) >= limits.daily) over++;
    if ((st.teacherWeek.get(`${t.id}#${day.week}`) ?? 0) >= limits.weekly) over++;
    for (const dk of ds.d.disciplineKeys) {
      const set = st.disciplineDay.get(`${dk}#${day.key}`);
      if (set && !set.has(lesson) && set.size >= settings.maxSameDisciplinePerDay) over++;
    }
    if (settings.forbidLateLessons && lesson >= settings.lateLessonNumber) over++;
    return over * weights.maxPlacementOverflow;
  };

  const roomCost = (st: ScheduleState, ds: DemandState, room: SolverRoom, day: DayRef): number => {
    let cost = 0;
    if (ds.d.preferredRoomId === room.id) cost -= 3;
    cost += Math.max(0, room.capacity - ds.d.size) / 100;
    if (room.building) {
      for (const g of ds.d.groupIds) {
        const map = st.groupDayBuildings.get(`${g}#${day.key}`);
        if (map && map.size > 0 && !map.has(room.building)) cost += weights.buildingChanges;
      }
    }
    return cost;
  };

  interface Candidate {
    day: DayRef;
    lesson: number;
    roomId: string | null;
    cost: number;
  }

  const bestCandidate = (
    st: ScheduleState,
    ds: DemandState,
    days: DayRef[],
    exclude?: { dayKey: string; lesson: number },
    weekLimit = true,
  ): Candidate | null => {
    let best: Candidate | null = null;
    for (const day of days) {
      if (!ds.allowedDays.has(day.key)) continue;
      for (let lesson = 1; lesson <= lessonsPerDay; lesson++) {
        if (exclude && exclude.dayKey === day.key && exclude.lesson === lesson) continue;
        if (!slotAllowed(ds, day, lesson)) continue;
        if (!teacherFree(st, ds, day, lesson, weekLimit)) continue;
        if (!groupFree(st, ds, day, lesson)) continue;
        if (!disciplineOk(st, ds, day, lesson)) continue;
        const base = slotCost(st, ds, day, lesson);
        if (best && base >= best.cost + 50) continue;
        for (const roomId of roomIdsFor(ds, day, lesson)) {
          const room = roomsById.get(roomId);
          if (!room || !roomFree(st, room, day, lesson)) continue;
          const cost = base + roomCost(st, ds, room, day);
          if (!best || cost < best.cost) best = { day, lesson, roomId, cost };
        }
      }
    }
    return best;
  };

  /** Ремонт: освобождаем слот, перенося одно блокирующее занятие */
  const repair = (st: ScheduleState, ds: DemandState, days: DayRef[]): boolean => {
    for (const day of days) {
      if (!ds.allowedDays.has(day.key)) continue;
      for (let lesson = 1; lesson <= lessonsPerDay; lesson++) {
        if (!slotAllowed(ds, day, lesson)) continue;
        if (teacherUnavailableAt(ds.teacher.id, day, lesson)) continue;
        const occupants = (st.slotIndex.get(`${day.key}#${lesson}`) ?? []).filter((p) => !p.fixed);
        const blockers = occupants.filter(
          (p) =>
            p.demand.d.teacherId === ds.d.teacherId ||
            p.demand.d.groupIds.some(
              (g) =>
                ds.d.groupIds.includes(g) &&
                (ds.d.subgroupNumber === null ||
                  p.demand.d.subgroupNumber === null ||
                  p.demand.d.subgroupNumber === ds.d.subgroupNumber),
            ),
        );
        if (blockers.length !== 1) continue;
        const blocker = blockers[0];
        st.remove(blocker);
        blocker.demand.placed--;
        const canPlace =
          teacherFree(st, ds, day, lesson) &&
          groupFree(st, ds, day, lesson) &&
          disciplineOk(st, ds, day, lesson);
        if (canPlace) {
          const room = roomIdsFor(ds, day, lesson)
            .map((r) => roomsById.get(r)!)
            .find((r) => r && roomFree(st, r, day, lesson));
          if (room) {
            const mine = st.apply({ demand: ds, day, lesson, roomId: room.id, fixed: false });
            const alt = bestCandidate(st, blocker.demand, days, { dayKey: day.key, lesson });
            if (alt) {
              st.apply({
                demand: blocker.demand,
                day: alt.day,
                lesson: alt.lesson,
                roomId: alt.roomId,
                fixed: false,
              });
              blocker.demand.placed++;
              ds.placed++;
              return true;
            }
            st.remove(mine);
          }
        }
        st.apply({
          demand: blocker.demand,
          day: blocker.day,
          lesson: blocker.lesson,
          roomId: blocker.roomId,
          fixed: false,
        });
        blocker.demand.placed++;
      }
    }
    return false;
  };

  /** Постановка занятий одной недели по целям */
  const solveWeek = (
    st: ScheduleState,
    days: DayRef[],
    targets: Map<DemandState, number>,
    repairLimit: number,
  ) => {
    const active = [...targets.entries()].filter(([, t]) => t > 0).map(([ds]) => ds);
    // Самые ограниченные — первыми
    const freedom = new Map<DemandState, number>();
    for (const ds of active) {
      let slots = 0;
      for (const day of days) {
        if (!ds.allowedDays.has(day.key)) continue;
        for (let l = 1; l <= lessonsPerDay; l++) {
          if (slotAllowed(ds, day, l) && !teacherUnavailableAt(ds.teacher.id, day, l)) slots++;
        }
      }
      freedom.set(ds, slots * Math.max(1, ds.d.roomIds.length));
    }
    active.sort(
      (a, b) =>
        (freedom.get(a) ?? 0) / (targets.get(a) ?? 1) - (freedom.get(b) ?? 0) / (targets.get(b) ?? 1) ||
        b.d.priority - a.d.priority ||
        b.d.size - a.d.size,
    );
    const remaining = new Map(active.map((ds) => [ds, targets.get(ds) ?? 0]));
    let repairs = 0;
    let progress = true;
    while (progress) {
      progress = false;
      for (const ds of active) {
        const left = remaining.get(ds) ?? 0;
        if (left <= 0) continue;
        const cand = bestCandidate(st, ds, days);
        if (cand) {
          st.apply({ demand: ds, day: cand.day, lesson: cand.lesson, roomId: cand.roomId, fixed: false });
          ds.placed++;
          remaining.set(ds, left - 1);
          progress = true;
        } else if (repairs < repairLimit && repair(st, ds, days)) {
          repairs++;
          remaining.set(ds, left - 1);
          progress = true;
        } else {
          remaining.set(ds, 0);
        }
      }
    }
  };

  /** Окна групп и преподавателя в этот день (для доводки) */
  const dayWindowsCost = (st: ScheduleState, ds: DemandState, day: DayRef): number => {
    let cost = 0;
    for (const g of ds.d.groupIds) {
      for (const persp of st.perspectivesFor(g, ds.d.subgroupNumber)) {
        cost += gaps(st.perspectiveDay.get(`${g}#${persp}#${day.key}`)) * weights.groupWindows;
      }
    }
    return cost + gaps(st.teacherDay.get(`${ds.d.teacherId}#${day.key}`)) * weights.teacherWindows;
  };
  /** Стоимость самой пары: поздние пары, пожелания преподавателя, сложные дисциплины в конце дня */
  const lessonPointCost = (ds: DemandState, day: DayRef, lesson: number): number => {
    let cost = lesson * 0.3;
    if (lesson >= settings.lateLessonNumber)
      cost += weights.lateLessons * (lesson - settings.lateLessonNumber + 1);
    if (settings.respectTeacherPreferences) {
      const t = ds.teacher;
      if (lesson < t.preferredStartLesson || lesson > t.preferredEndLesson) cost += weights.teacherPreference;
      const pref =
        (preferenceTeacher.get(t.id)?.get(`${day.weekday}#${lesson}`) ?? 0) +
        (slotPrefTeacher.get(t.id)?.get(`${day.key}#${lesson}`) ?? 0);
      cost -= pref * (weights.teacherPreference / 5);
    }
    if (ds.d.isDifficult && lesson >= Math.max(4, settings.lateLessonNumber - 1))
      cost += weights.difficultLate;
    return cost;
  };
  /** Свободная аудитория для пары: та же, затем в том же корпусе, затем любая подходящая */
  const roomForMove = (
    st: ScheduleState,
    ds: DemandState,
    day: DayRef,
    lesson: number,
    current: string | null,
  ) => {
    const options = roomIdsFor(ds, day, lesson)
      .map((id) => roomsById.get(id))
      .filter((r): r is SolverRoom => !!r && roomFree(st, r, day, lesson));
    const building = current ? roomsById.get(current)?.building : undefined;
    return (
      options.find((r) => r.id === current) ??
      options.find((r) => building && r.building === building) ??
      options[0] ??
      null
    );
  };
  const compact = (st: ScheduleState, until: number): number => {
    let moved = 0;
    for (let round = 0; round < 4; round++) {
      let changed = 0;
      for (const p of [...st.placements]) {
        if (Date.now() > until) return moved + changed;
        if (p.fixed) continue;
        const ds = p.demand;
        const before = dayWindowsCost(st, ds, p.day) + lessonPointCost(ds, p.day, p.lesson);
        st.remove(p);
        let best: { lesson: number; roomId: string; cost: number } | null = null;
        for (let lesson = 1; lesson <= lessonsPerDay; lesson++) {
          if (lesson === p.lesson || !slotAllowed(ds, p.day, lesson)) continue;
          if (!teacherFree(st, ds, p.day, lesson) || !groupFree(st, ds, p.day, lesson)) continue;
          if (!disciplineOk(st, ds, p.day, lesson)) continue;
          const room = roomForMove(st, ds, p.day, lesson, p.roomId);
          if (!room) continue;
          const trial = st.apply({ demand: ds, day: p.day, lesson, roomId: room.id, fixed: false });
          const cost = dayWindowsCost(st, ds, p.day) + lessonPointCost(ds, p.day, lesson);
          st.remove(trial);
          if (cost < before - 0.5 && (!best || cost < best.cost)) best = { lesson, roomId: room.id, cost };
        }
        if (best) {
          st.apply({ demand: ds, day: p.day, lesson: best.lesson, roomId: best.roomId, fixed: false });
          changed++;
        } else {
          st.apply({ demand: ds, day: p.day, lesson: p.lesson, roomId: p.roomId, fixed: false });
        }
      }
      moved += changed;
      if (changed === 0) break;
    }
    return moved;
  };
  /** Стоимость дня для переноса между днями: окна, перегрузка групп, разрывы одной дисциплины */
  const dayFullCost = (st: ScheduleState, ds: DemandState, day: DayRef): number => {
    let cost = dayWindowsCost(st, ds, day);
    for (const g of ds.d.groupIds) {
      const group = groupsById.get(g);
      for (const persp of st.perspectivesFor(g, ds.d.subgroupNumber)) {
        const size = st.perspectiveDay.get(`${g}#${persp}#${day.key}`)?.size ?? 0;
        if (group && size > group.maxLessonsPerDay)
          cost += weights.groupDailyOverload * (size - group.maxLessonsPerDay);
      }
    }
    for (const dk of ds.d.disciplineKeys) {
      const set = st.disciplineDay.get(`${dk}#${day.key}`);
      if (set && set.size > 1) cost += (gaps(set) > 0 ? 2 : 1) * weights.sameDayDiscipline * (set.size - 1);
    }
    return cost;
  };
  /** Занятие участвует в окне группы или преподавателя */
  const inWindow = (st: ScheduleState, p: Placed): boolean => {
    if (gaps(st.teacherDay.get(`${p.demand.d.teacherId}#${p.day.key}`)) > 0) return true;
    return p.demand.d.groupIds.some((g) =>
      st
        .perspectivesFor(g, p.demand.d.subgroupNumber)
        .some((persp) => gaps(st.perspectiveDay.get(`${g}#${persp}#${p.day.key}`)) > 0),
    );
  };
  /** Перенос занятия, участвующего в окне, на другой день той же недели */
  const shiftDays = (st: ScheduleState, until: number): number => {
    let moved = 0;
    for (const p of [...st.placements]) {
      if (Date.now() > until) break;
      if (p.fixed || !inWindow(st, p)) continue;
      const ds = p.demand;
      const days = (daysByWeek.get(p.day.week) ?? []).filter(
        (d) => d.key !== p.day.key && ds.allowedDays.has(d.key),
      );
      if (days.length === 0) continue;
      const baseOld = dayFullCost(st, ds, p.day) + lessonPointCost(ds, p.day, p.lesson);
      st.remove(p);
      const oldAfter = dayFullCost(st, ds, p.day);
      let best: { day: DayRef; lesson: number; roomId: string; gain: number } | null = null;
      for (const day of days) {
        const newBefore = dayFullCost(st, ds, day);
        for (let lesson = 1; lesson <= lessonsPerDay; lesson++) {
          if (
            !slotAllowed(ds, day, lesson) ||
            !teacherFree(st, ds, day, lesson) ||
            !groupFree(st, ds, day, lesson)
          )
            continue;
          if (!disciplineOk(st, ds, day, lesson)) continue;
          const room = roomForMove(st, ds, day, lesson, p.roomId);
          if (!room) continue;
          const trial = st.apply({ demand: ds, day, lesson, roomId: room.id, fixed: false });
          const gain =
            baseOld + newBefore - (oldAfter + dayFullCost(st, ds, day) + lessonPointCost(ds, day, lesson));
          st.remove(trial);
          if (gain > 0.5 && (!best || gain > best.gain)) best = { day, lesson, roomId: room.id, gain };
        }
      }
      if (best) {
        st.apply({ demand: ds, day: best.day, lesson: best.lesson, roomId: best.roomId, fixed: false });
        moved++;
      } else {
        st.apply({ demand: ds, day: p.day, lesson: p.lesson, roomId: p.roomId, fixed: false });
      }
    }
    return moved;
  };
  const countWindows = (st: ScheduleState) => {
    let groups = 0;
    for (const set of st.perspectiveDay.values()) groups += gaps(set);
    let teachers = 0;
    for (const set of st.teacherDay.values()) teachers += gaps(set);
    return { groups, teachers };
  };

  const repairLimit = options.repairLimit ?? 60;
  let timeExceeded = false;

  /** Постоянное расписание: одна типовая неделя, пары «через неделю» объединяются в числитель/знаменатель */
  const solveTemplateOnly = (): SolverResult => {
    const templateDays: DayRef[] = problem.workingDays.map((w) => ({ key: `T${w}`, weekday: w, week: -1 }));
    daysByWeek.set(-1, templateDays);
    const st = makeState();
    const targets = new Map<DemandState, number>();
    const biweekly = new Set<DemandState>();
    let skipped = 0;
    for (const ds of demands) {
      // Практика и консультации проводятся по датам — в типовую неделю не входят
      if (ds.d.allowedDates !== null || ds.availableWeeks.length === 0) {
        skipped++;
        continue;
      }
      const weekdays = new Set<number>();
      for (const key of ds.allowedDays) {
        const ref = dayRefByDate.get(key);
        if (ref) weekdays.add(ref.weekday);
      }
      const base = { ...ds, allowedDays: new Set([...weekdays].map((w) => `T${w}`)), placed: 0 };
      const slots = weeklySlots(ds.rate, ds.d.lessonsRequired);
      if (slots.weekly > 0) targets.set(base, slots.weekly);
      if (slots.biweekly) {
        const half = { ...base, placed: 0 };
        targets.set(half, 1);
        biweekly.add(half);
      }
    }
    solveWeek(st, templateDays, targets, repairLimit * 4);
    if (settings.maximizePlacement) {
      const rest = new Map<DemandState, number>();
      for (const [ds, t] of targets) if (ds.placed < t) rest.set(ds, t - ds.placed);
      if (rest.size > 0) {
        const before = st.placements.length;
        relaxed = true;
        solveWeek(st, templateDays, rest, repairLimit * 4);
        // Аудиторий не хватает на всю сетку — пара ставится без аудитории, её назначат вручную
        let withoutRoom = 0;
        for (const [ds, t] of targets) {
          while (ds.placed < t) {
            let best: { day: DayRef; lesson: number; cost: number } | null = null;
            for (const day of templateDays) {
              if (!ds.allowedDays.has(day.key)) continue;
              for (let lesson = 1; lesson <= lessonsPerDay; lesson++) {
                if (!slotAllowed(ds, day, lesson) || !teacherFree(st, ds, day, lesson)) continue;
                if (!groupFree(st, ds, day, lesson)) continue;
                const cost = slotCost(st, ds, day, lesson);
                if (!best || cost < best.cost) best = { day, lesson, cost };
              }
            }
            if (!best) break;
            st.apply({ demand: ds, day: best.day, lesson: best.lesson, roomId: null, fixed: false });
            ds.placed++;
            withoutRoom++;
          }
        }
        relaxed = false;
        log.push(
          `Расстановка по максимуму: дополнительно поставлено ${st.placements.length - before} пар` +
            (withoutRoom ? `, из них ${withoutRoom} без аудитории (свободных подходящих аудиторий нет)` : ''),
        );
      }
    }
    options.onProgress?.(0.7, 'Доводка окон');
    if (settings.avoidWindows) {
      const until = Date.now() + Math.min(20, Math.max(3, problem.timeLimitSeconds / 4)) * 1000;
      let moved = compact(st, until);
      for (let round = 0; round < 3 && Date.now() < until; round++) {
        const shifted = shiftDays(st, until);
        if (shifted === 0) break;
        moved += shifted + compact(st, until);
      }
      if (moved > 0) log.push(`Доводка: переставлено ${moved} пар, чтобы убрать окна`);
    }

    // Пары «через неделю» одной группы (подгруппы) объединяются в один слот: числитель / знаменатель
    const parity = new Map<Placed, 'ODD' | 'EVEN'>();
    const merged: Array<{ p: Placed; day: DayRef; lesson: number; roomId: string | null }> = [];
    const halves = st.placements.filter((p) => biweekly.has(p.demand));
    const audience = (p: Placed) =>
      `${[...p.demand.d.groupIds].sort().join(',')}#${p.demand.d.subgroupNumber ?? ''}`;
    const taken = new Set<Placed>();
    for (const a of halves) {
      if (taken.has(a)) continue;
      taken.add(a);
      parity.set(a, 'ODD');
      for (const b of halves) {
        if (taken.has(b) || audience(b) !== audience(a)) continue;
        const sameTeacher = b.demand.d.teacherId === a.demand.d.teacherId;
        st.remove(b);
        const teacherOk =
          sameTeacher || !st.teacherSlot.has(`${b.demand.d.teacherId}#${a.day.key}#${a.lesson}`);
        let roomId: string | null = null;
        if (teacherOk) {
          const options = roomIdsFor(b.demand, a.day, a.lesson);
          if (a.roomId && options.includes(a.roomId)) roomId = a.roomId;
          else
            roomId =
              options.find((id) => {
                const r = roomsById.get(id);
                return !!r && roomFree(st, r, a.day, a.lesson);
              }) ?? null;
        }
        // Без аудитории объединяются только при расстановке по максимуму
        if (teacherOk && (roomId || settings.maximizePlacement)) {
          taken.add(b);
          merged.push({ p: b, day: a.day, lesson: a.lesson, roomId });
          if (!sameTeacher) st.teacherSlot.add(`${b.demand.d.teacherId}#${a.day.key}#${a.lesson}`);
          if (roomId && roomId !== a.roomId) st.roomSlot.set(`${roomId}#${a.day.key}#${a.lesson}`, 1);
          break;
        }
        const back = st.apply({
          demand: b.demand,
          day: b.day,
          lesson: b.lesson,
          roomId: b.roomId,
          fixed: false,
        });
        halves[halves.indexOf(b)] = back;
      }
    }
    if (merged.length > 0) log.push(`Числитель/знаменатель: объединено ${merged.length} пар «через неделю»`);

    const placements: SolverPlacement[] = [
      ...st.placements.map((p) => ({
        demandId: p.demand.d.id,
        date: p.day.key,
        lessonNumber: p.lesson,
        roomId: p.roomId,
        ...(parity.has(p) ? { parity: parity.get(p)! } : {}),
      })),
      ...merged.map((m) => ({
        demandId: m.p.demand.d.id,
        date: m.day.key,
        lessonNumber: m.lesson,
        roomId: m.roomId,
        parity: 'EVEN' as const,
      })),
    ];
    placements.sort((a, b) => a.date.localeCompare(b.date) || a.lessonNumber - b.lessonNumber);
    // Счёт в парах недели: пара через неделю — половина
    const weight = (ds: DemandState) => (biweekly.has(ds) ? 0.5 : 1);
    const unplacedBy = new Map<string, number>();
    for (const [ds, t] of targets) {
      if (ds.placed < t)
        unplacedBy.set(ds.d.id, (unplacedBy.get(ds.d.id) ?? 0) + (t - ds.placed) * weight(ds));
    }
    const required = [...targets].reduce((a, [ds, t]) => a + t * weight(ds), 0);
    const placedWeekly = placements.reduce((a, p) => a + (p.parity ? 0.5 : 1), 0);
    log.push(
      `Типовая неделя: ${placedWeekly} пар из ${required}` +
        (skipped ? `; практика и консультации по датам (${skipped}) в сетку не входят` : ''),
    );
    options.onProgress?.(1, 'Готово');
    return {
      status:
        placements.length === 0 && required > 0 ? 'EMPTY' : unplacedBy.size > 0 ? 'PARTIAL' : 'FEASIBLE',
      solver: 'heuristic',
      placements,
      unplaced: [...unplacedBy].map(([demandId, count]) => ({ demandId, count })),
      stats: {
        requiredLessons: required,
        placedLessons: placedWeekly,
        durationMs: Date.now() - started,
        weeks: weeks.length,
        objective: null,
      },
      log,
    };
  };
  if (options.templateOnly) return solveTemplateOnly();

  if (options.initial) {
    // --- Доработка готового решения: занятия переносятся в состояние с проверкой ограничений
    const byId = new Map(demands.map((ds) => [ds.d.id, ds]));
    let rejected = 0;
    // Решение «по максимуму» может выходить за ослабляемые ограничения — проверяются только жёсткие
    relaxed = settings.maximizePlacement === true;
    for (const p of options.initial) {
      const ds = byId.get(p.demandId);
      const day = dayRefByDate.get(p.date);
      const room = p.roomId ? roomsById.get(p.roomId) : undefined;
      const ok =
        !!ds &&
        !!day &&
        ds.placed < ds.d.lessonsRequired &&
        slotAllowed(ds, day, p.lessonNumber) &&
        teacherFree(state, ds, day, p.lessonNumber) &&
        groupFree(state, ds, day, p.lessonNumber) &&
        disciplineOk(state, ds, day, p.lessonNumber) &&
        (!room || roomFree(state, room, day, p.lessonNumber));
      if (!ok) {
        rejected++;
        continue;
      }
      state.apply({ demand: ds, day, lesson: p.lessonNumber, roomId: p.roomId, fixed: false });
      ds.placed++;
    }
    relaxed = false;
    if (rejected)
      log.push(`Доработка: ${rejected} занятий исходного решения не прошли проверку и поставлены заново`);
  } else if (problem.mode === 'WEEKLY_TEMPLATE') {
    // --- 1. Шаблон недели
    const templateDays: DayRef[] = problem.workingDays.map((w) => ({ key: `T${w}`, weekday: w, week: -1 }));
    const templateState = makeState();
    // Регулярная занятость (встречается в большинстве недель) переносится в шаблон
    const recurring = new Map<string, number>();
    for (const o of problem.occupied) {
      const day = dayRefByDate.get(o.date);
      if (!day) continue;
      const key = JSON.stringify([
        day.weekday,
        o.lessonNumber,
        o.groupId,
        o.subgroupNumber,
        o.teacherId,
        o.roomId,
        o.disciplineKey,
      ]);
      recurring.set(key, (recurring.get(key) ?? 0) + 1);
    }
    for (const [key, count] of recurring) {
      if (count < Math.max(2, weeks.length / 2)) continue;
      const [weekday, lesson, groupId, subgroup, teacherId, roomId, disciplineKey] = JSON.parse(key);
      templateState.occupy({
        dayKey: `T${weekday}`,
        week: -1,
        lesson,
        groupId,
        subgroup,
        teacherId,
        roomId,
        disciplineKey,
      });
    }
    // В шаблон недели входят только регулярные занятия; практика и консультации — календарным проходом
    const regular = demands.filter((ds) => ds.d.allowedDates === null);
    const templateDemands = regular.map((ds) => {
      const weekdays = new Set<number>();
      for (const key of ds.allowedDays) {
        const ref = dayRefByDate.get(key);
        if (ref) weekdays.add(ref.weekday);
      }
      return {
        ...ds,
        allowedDays: new Set([...weekdays].map((w) => `T${w}`)),
        placed: 0,
      } as DemandState;
    });
    const templateTargets = new Map<DemandState, number>();
    for (const ds of templateDemands) {
      // Постоянная неделя: число слотов в шаблоне — округлённый темп (не менее одного)
      templateTargets.set(
        ds,
        ds.availableWeeks.length === 0 ? 0 : Math.min(ds.d.lessonsRequired, Math.max(1, Math.round(ds.rate))),
      );
    }
    solveWeek(templateState, templateDays, templateTargets, repairLimit);
    const template = new Map<DemandState, Placed[]>();
    for (const p of templateState.placements) {
      const original = regular[templateDemands.indexOf(p.demand)];
      const list = template.get(original) ?? [];
      list.push(p);
      template.set(original, list);
    }
    log.push(`Шаблон недели: поставлено ${templateState.placements.length} пар`);

    // --- 2. Развёртка шаблона по датам: шаблон повторяется каждую неделю, пока не выработаны часы
    for (const w of weeks) {
      const days = daysByWeek.get(w) ?? [];
      for (const ds of regular) {
        if (!ds.daysByWeek.has(w)) continue;
        let need = ds.d.lessonsRequired - ds.placed;
        const slots = (template.get(ds) ?? [])
          .slice()
          .sort((a, b) => a.day.weekday - b.day.weekday || a.lesson - b.lesson);
        for (const t of slots) {
          if (need <= 0) break;
          const day = days.find((x) => x.weekday === t.day.weekday);
          if (!day || !slotAllowed(ds, day, t.lesson)) continue;
          if (
            !teacherFree(state, ds, day, t.lesson) ||
            !groupFree(state, ds, day, t.lesson) ||
            !disciplineOk(state, ds, day, t.lesson)
          ) {
            continue;
          }
          const options = roomIdsFor(ds, day, t.lesson);
          const preferred = t.roomId && options.includes(t.roomId) ? roomsById.get(t.roomId) : undefined;
          const room =
            preferred && roomFree(state, preferred, day, t.lesson)
              ? preferred
              : options.map((r) => roomsById.get(r)!).find((r) => r && roomFree(state, r, day, t.lesson));
          if (!room) continue;
          state.apply({ demand: ds, day, lesson: t.lesson, roomId: room.id, fixed: false });
          ds.placed++;
          need--;
        }
      }
    }
  }
  // --- Календарный проход: весь спрос (календарный режим) или практика/консультации (режим шаблона)
  const calendarDemands = options.initial
    ? []
    : problem.mode === 'WEEKLY_TEMPLATE'
      ? demands.filter((ds) => ds.d.allowedDates !== null)
      : demands;
  if (calendarDemands.length > 0) {
    weeks.forEach((w, idx) => {
      if (Date.now() > deadline) {
        timeExceeded = true;
        return;
      }
      const days = daysByWeek.get(w) ?? [];
      const targets = new Map<DemandState, number>();
      for (const ds of calendarDemands) {
        if (!ds.daysByWeek.has(w)) continue;
        const target = targetThrough(ds, w) - ds.placed;
        if (target > 0) targets.set(ds, target);
      }
      solveWeek(state, days, targets, repairLimit);
      options.onProgress?.((idx + 1) / (weeks.length + 1), `Неделя ${idx + 1} из ${weeks.length}`);
    });
  }

  // --- Компенсация: сначала равномерно по оставшимся неделям, затем в любые свободные слоты
  const catchUp = (spread: boolean, until = deadline) => {
    const leftovers = demands.filter((ds) => ds.placed < ds.d.lessonsRequired);
    if (leftovers.length === 0) return;
    if (spread) log.push(`Компенсационный проход: ${leftovers.length} дисциплин с недопоставленными парами`);
    weeks.forEach((w, i) => {
      if (timeExceeded || Date.now() > until) {
        timeExceeded = true;
        return;
      }
      const days = daysByWeek.get(w) ?? [];
      const targets = new Map<DemandState, number>();
      for (const ds of leftovers) {
        const left = ds.d.lessonsRequired - ds.placed;
        if (left <= 0 || !ds.daysByWeek.has(w)) continue;
        const weeksLeft = weeks.slice(i).filter((x) => ds.daysByWeek.has(x)).length;
        targets.set(ds, spread ? Math.ceil(left / Math.max(1, weeksLeft)) : left);
      }
      if (targets.size > 0) solveWeek(state, days, targets, Math.floor(repairLimit / 2));
    });
  };
  if (!timeExceeded) {
    catchUp(true);
    catchUp(false);
  }
  if (timeExceeded) log.push('Достигнут лимит времени — возвращён лучший найденный вариант');
  if (settings.maximizePlacement && demands.some((ds) => ds.placed < ds.d.lessonsRequired)) {
    // Проход «по максимуму» выполняется и после лимита времени: он жадный и быстрый
    const before = state.placements.length;
    relaxed = true;
    timeExceeded = false;
    catchUp(false, deadline + Math.min(30, Math.max(5, problem.timeLimitSeconds / 4)) * 1000);
    relaxed = false;
    log.push(
      `Расстановка по максимуму: дополнительно поставлено ${state.placements.length - before} пар ` +
        'сверх лимитов преподавателей, частоты дисциплины в день и запрета поздних пар',
    );
  }

  // --- Доводка: перестановка занятий внутри дня, если это убирает окна групп и преподавателей.
  // Дата не меняется, поэтому темп, недельные лимиты и календарь не нарушаются. В режиме шаблона
  // недели не выполняется: занятия должны повторяться одинаково каждую неделю.
  if (problem.mode !== 'WEEKLY_TEMPLATE' && settings.avoidWindows) {
    const polishDeadline = Date.now() + Math.min(30, Math.max(5, problem.timeLimitSeconds / 4)) * 1000;
    const windowsBefore = countWindows(state);
    let moved = compact(state, polishDeadline);
    for (let round = 0; round < 3 && Date.now() < polishDeadline; round++) {
      const shifted = shiftDays(state, polishDeadline);
      if (shifted === 0) break;
      moved += shifted + compact(state, polishDeadline);
    }
    if (moved > 0) {
      const after = countWindows(state);
      log.push(
        `Доводка: переставлено ${moved} занятий внутри дня и недели; окна у групп ${windowsBefore.groups} → ${after.groups}, ` +
          `у преподавателей ${windowsBefore.teachers} → ${after.teachers}`,
      );
    }
  }

  const placements: SolverPlacement[] = state.placements.map((p) => ({
    demandId: p.demand.d.id,
    date: p.day.key,
    lessonNumber: p.lesson,
    roomId: p.roomId,
  }));
  placements.sort((a, b) => a.date.localeCompare(b.date) || a.lessonNumber - b.lessonNumber);
  const unplaced = demands
    .filter((ds) => ds.placed < ds.d.lessonsRequired)
    .map((ds) => ({ demandId: ds.d.id, count: ds.d.lessonsRequired - ds.placed }));
  for (const d of problem.demands) {
    if (!demands.some((ds) => ds.d.id === d.id) && d.lessonsRequired > 0) {
      unplaced.push({ demandId: d.id, count: d.lessonsRequired });
    }
  }
  const required = problem.demands.reduce((a, d) => a + Math.max(0, d.lessonsRequired), 0);
  options.onProgress?.(1, 'Готово');
  return {
    status: placements.length === 0 && required > 0 ? 'EMPTY' : unplaced.length > 0 ? 'PARTIAL' : 'FEASIBLE',
    solver: 'heuristic',
    placements,
    unplaced,
    stats: {
      requiredLessons: required,
      placedLessons: placements.length,
      durationMs: Date.now() - started,
      weeks: weeks.length,
      objective: null,
    },
    log,
  };
}
