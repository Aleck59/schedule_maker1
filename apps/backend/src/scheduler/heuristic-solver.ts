import { cumulativeTargetByDays, effectiveRate } from './pacing';
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

  const unavailableTeacher = new Map<string, Set<string>>();
  const preferenceTeacher = new Map<string, Map<string, number>>();
  for (const t of problem.teachers) {
    unavailableTeacher.set(t.id, new Set(t.unavailable.map(([w, l]) => `${w}#${l}`)));
    preferenceTeacher.set(t.id, new Map(t.preferences.map(([w, l, v]) => [`${w}#${l}`, v])));
  }
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
      placed: 0,
    });
  }

  const makeState = () => new ScheduleState(problem, roomsById, subgroupsByGroup);
  /** Накопительная цель демандa к концу недели w (с учётом доступных дней) */
  const paceProgress = new Map<DemandState, { days: number; weeks: number }>();
  const targetThrough = (ds: DemandState, w: number) => {
    const p = paceProgress.get(ds) ?? { days: 0, weeks: 0 };
    p.days += ds.daysByWeek.get(w) ?? 0;
    p.weeks += 1;
    paceProgress.set(ds, p);
    return cumulativeTargetByDays(ds.d.lessonsRequired, p.days, ds.totalDays, p.weeks, ds.d.weeklyRate);
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
    if (unavailableTeacher.get(t.id)?.has(`${day.weekday}#${lesson}`)) return false;
    if (st.teacherSlot.has(`${t.id}#${day.key}#${lesson}`)) return false;
    const td = st.teacherDay.get(`${t.id}#${day.key}`);
    if (td && td.size >= t.maxDailyLessons && !td.has(lesson)) return false;
    if (weekLimit && (st.teacherWeek.get(`${t.id}#${day.week}`) ?? 0) >= t.maxWeeklyLessons) return false;
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

  const slotAllowed = (ds: DemandState, day: DayRef, lesson: number) => {
    if (lesson > lessonsPerDay) return false;
    if (settings.forbidLateLessons && lesson >= settings.lateLessonNumber) return false;
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
      const pref = preferenceTeacher.get(t.id)?.get(`${day.weekday}#${lesson}`) ?? 0;
      cost -= pref * (weights.teacherPreference / 5);
    }
    if (d.isDifficult && lesson >= Math.max(4, settings.lateLessonNumber - 1)) cost += weights.difficultLate;
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
        for (const roomId of ds.d.roomIds) {
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
        if (unavailableTeacher.get(ds.teacher.id)?.has(`${day.weekday}#${lesson}`)) continue;
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
          const room = ds.d.roomIds
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
          if (slotAllowed(ds, day, l) && !unavailableTeacher.get(ds.teacher.id)?.has(`${day.weekday}#${l}`))
            slots++;
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

  const repairLimit = options.repairLimit ?? 60;
  let timeExceeded = false;

  if (problem.mode === 'WEEKLY_TEMPLATE') {
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
          const preferred = t.roomId ? roomsById.get(t.roomId) : undefined;
          const room =
            preferred && roomFree(state, preferred, day, t.lesson)
              ? preferred
              : ds.d.roomIds
                  .map((r) => roomsById.get(r)!)
                  .find((r) => r && roomFree(state, r, day, t.lesson));
          if (!room) continue;
          state.apply({ demand: ds, day, lesson: t.lesson, roomId: room.id, fixed: false });
          ds.placed++;
          need--;
        }
      }
    }
  }
  // --- Календарный проход: весь спрос (календарный режим) или практика/консультации (режим шаблона)
  const calendarDemands =
    problem.mode === 'WEEKLY_TEMPLATE' ? demands.filter((ds) => ds.d.allowedDates !== null) : demands;
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
  const catchUp = (spread: boolean) => {
    const leftovers = demands.filter((ds) => ds.placed < ds.d.lessonsRequired);
    if (leftovers.length === 0) return;
    if (spread) log.push(`Компенсационный проход: ${leftovers.length} дисциплин с недопоставленными парами`);
    weeks.forEach((w, i) => {
      if (timeExceeded || Date.now() > deadline) {
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
