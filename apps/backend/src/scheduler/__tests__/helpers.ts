import { addDaysStr, diffDays, isoWeekday, weekStart } from '../../common/utils/dates';
import { SolverDemand, SolverDay, SolverProblem, SolverResult } from '../solver.types';

/** Построение тестовой задачи генерации */
export function makeDays(start: string, weeks: number, working = [1, 2, 3, 4, 5, 6]): SolverDay[] {
  const monday = weekStart(start);
  const days: SolverDay[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const date = addDaysStr(start, i);
    const wd = isoWeekday(date);
    if (working.includes(wd)) days.push({ date, weekday: wd, week: Math.floor(diffDays(date, monday) / 7) });
  }
  return days;
}

export function baseProblem(overrides: Partial<SolverProblem> = {}): SolverProblem {
  const days = overrides.days ?? makeDays('2025-09-01', 4);
  const all = days.map((d) => d.date);
  return {
    version: 1,
    mode: 'CALENDAR',
    timeLimitSeconds: 10,
    lessonsPerDay: 6,
    workingDays: [1, 2, 3, 4, 5, 6],
    days,
    groups: [
      { id: 'g1', code: 'ИСП-1', size: 25, subgroups: [1, 2], allowedDates: all, maxLessonsPerDay: 4 },
      { id: 'g2', code: 'ИСП-2', size: 20, subgroups: [], allowedDates: all, maxLessonsPerDay: 4 },
    ],
    teachers: [
      {
        id: 't1',
        name: 'Иванова',
        maxDailyLessons: 4,
        maxWeeklyLessons: 20,
        preferredStartLesson: 1,
        preferredEndLesson: 6,
        unavailable: [1, 2, 3, 4, 5, 6].map((n) => [6, n] as [number, number]),
        preferences: [],
        blockedDates: [],
      },
      {
        id: 't2',
        name: 'Петров',
        maxDailyLessons: 4,
        maxWeeklyLessons: 20,
        preferredStartLesson: 1,
        preferredEndLesson: 6,
        unavailable: [],
        preferences: [],
        blockedDates: [],
      },
      {
        id: 't3',
        name: 'Смирнова',
        maxDailyLessons: 4,
        maxWeeklyLessons: 20,
        preferredStartLesson: 1,
        preferredEndLesson: 6,
        unavailable: [],
        preferences: [],
        blockedDates: [],
      },
    ],
    rooms: [
      {
        id: 'r_lec',
        code: 'А-101',
        building: 'A',
        capacity: 60,
        type: 'LECTURE',
        unavailable: [],
        unlimited: false,
      },
      {
        id: 'r_gen',
        code: 'А-201',
        building: 'A',
        capacity: 30,
        type: 'GENERAL',
        unavailable: [],
        unlimited: false,
      },
      {
        id: 'r_pc1',
        code: 'А-301',
        building: 'A',
        capacity: 26,
        type: 'COMPUTER_LAB',
        unavailable: [],
        unlimited: false,
      },
      {
        id: 'r_pc2',
        code: 'А-303',
        building: 'A',
        capacity: 15,
        type: 'COMPUTER_LAB',
        unavailable: [],
        unlimited: false,
      },
    ],
    demands: [],
    occupied: [],
    settings: {
      maxSameDisciplinePerDay: 2,
      maxSameDisciplinePerWeek: 2,
      lateLessonNumber: 5,
      forbidLateLessons: false,
      avoidWindows: true,
      respectTeacherPreferences: true,
    },
    weights: {},
    seed: 42,
    ...overrides,
  };
}

export function demand(
  id: string,
  groups: string[],
  teacher: string,
  lessons: number,
  rooms: string[],
  extra: Partial<SolverDemand> = {},
): SolverDemand {
  const key = extra.semesterItemId ?? id;
  return {
    id,
    groupIds: groups,
    subgroupNumber: null,
    semesterItemId: key,
    disciplineKeys: groups.map((g) => `${g}|${key}`),
    title: id,
    lessonType: 'LECTURE',
    teacherId: teacher,
    lessonsRequired: lessons,
    weeklyRate: null,
    priority: 5,
    size: 25,
    roomIds: rooms,
    preferredRoomId: null,
    allowedDates: null,
    isDifficult: false,
    ...extra,
  };
}

/** Проверка жёстких ограничений результата */
export function assertHardConstraints(problem: SolverProblem, result: SolverResult) {
  const demands = new Map(problem.demands.map((d) => [d.id, d]));
  const teacherSlots = new Map<string, number>();
  const roomSlots = new Map<string, number>();
  const groupSlots = new Map<string, Array<number | null>>();
  const disciplineDay = new Map<string, Set<number>>();
  for (const p of result.placements) {
    const d = demands.get(p.demandId)!;
    const ts = `${d.teacherId}#${p.date}#${p.lessonNumber}`;
    teacherSlots.set(ts, (teacherSlots.get(ts) ?? 0) + 1);
    if (p.roomId) {
      expect(d.roomIds).toContain(p.roomId);
      const rs = `${p.roomId}#${p.date}#${p.lessonNumber}`;
      roomSlots.set(rs, (roomSlots.get(rs) ?? 0) + 1);
    }
    for (const g of d.groupIds) {
      const gs = `${g}#${p.date}#${p.lessonNumber}`;
      groupSlots.set(gs, [...(groupSlots.get(gs) ?? []), d.subgroupNumber]);
    }
    for (const k of d.disciplineKeys) {
      const set = disciplineDay.get(`${k}#${p.date}`) ?? new Set<number>();
      set.add(p.lessonNumber);
      disciplineDay.set(`${k}#${p.date}`, set);
    }
    const teacher = problem.teachers.find((t) => t.id === d.teacherId)!;
    expect(teacher.unavailable.some(([w, l]) => w === isoWeekday(p.date) && l === p.lessonNumber)).toBe(
      false,
    );
    expect(teacher.blockedDates).not.toContain(p.date);
    const allowed = d.allowedDates ?? problem.groups.find((g) => g.id === d.groupIds[0])!.allowedDates;
    expect(allowed).toContain(p.date);
  }
  for (const c of teacherSlots.values()) expect(c).toBe(1);
  for (const c of roomSlots.values()) expect(c).toBe(1);
  for (const subs of groupSlots.values()) {
    if (subs.length > 1) {
      expect(subs).not.toContain(null);
      expect(new Set(subs).size).toBe(subs.length);
    }
  }
  for (const set of disciplineDay.values())
    expect(set.size).toBeLessThanOrEqual(problem.settings.maxSameDisciplinePerDay);
}
