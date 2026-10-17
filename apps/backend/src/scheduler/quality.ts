import { SolverProblem, SolverResult } from './solver.types';

const DEFAULT_WEIGHTS: Record<string, number> = {
  groupWindows: 30,
  teacherWindows: 10,
  lateLessons: 8,
  groupDailyOverload: 25,
};

export interface QualitySummary {
  placed: number;
  groupWindows: number;
  teacherWindows: number;
  lateLessons: number;
  overloadedDays: number;
  /** Чем больше, тем лучше: поставленные пары важнее любых нарушений мягких ограничений */
  score: number;
}

function windows(map: Map<string, Set<number>>): number {
  let total = 0;
  for (const set of map.values()) {
    const arr = [...set];
    total += Math.max(...arr) - Math.min(...arr) + 1 - arr.length;
  }
  return total;
}

/**
 * Поздняя ли пара: номер не меньше «поздней» у группы без особого режима занятий.
 * Если режим группы сам включает поздние пары (вечерние и очно-заочные группы), они не нарушение.
 */
export function lateLessonCheck(problem: Pick<SolverProblem, 'groups' | 'settings'>) {
  const late = problem.settings.lateLessonNumber;
  const evening = new Set(
    problem.groups
      .filter((g) => g.allowedLessons?.length && Math.max(...g.allowedLessons) >= late)
      .map((g) => g.id),
  );
  return (groupIds: string[], lessonNumber: number) =>
    lessonNumber >= late && groupIds.some((g) => !evening.has(g));
}

/** Оценка результата решателя для выбора лучшего из нескольких вариантов */
export function qualityOf(problem: SolverProblem, result: SolverResult): QualitySummary {
  const demands = new Map(problem.demands.map((d) => [d.id, d]));
  const groups = new Map(problem.groups.map((g) => [g.id, g]));
  const byGroupDay = new Map<string, Set<number>>();
  const byTeacherDay = new Map<string, Set<number>>();
  const isLate = lateLessonCheck(problem);
  let lateLessons = 0;
  for (const p of result.placements) {
    const d = demands.get(p.demandId);
    if (!d) continue;
    if (isLate(d.groupIds, p.lessonNumber)) lateLessons++;
    for (const g of d.groupIds) {
      const key = `${g}#${d.subgroupNumber ?? 0}#${p.date}`;
      const set = byGroupDay.get(key) ?? new Set<number>();
      set.add(p.lessonNumber);
      byGroupDay.set(key, set);
    }
    const tKey = `${d.teacherId}#${p.date}`;
    const tSet = byTeacherDay.get(tKey) ?? new Set<number>();
    tSet.add(p.lessonNumber);
    byTeacherDay.set(tKey, tSet);
  }
  let overloadedDays = 0;
  for (const [key, set] of byGroupDay) {
    const group = groups.get(key.split('#')[0]);
    if (set.size > (group?.maxLessonsPerDay ?? 4)) overloadedDays++;
  }
  const w = { ...DEFAULT_WEIGHTS, ...problem.weights };
  const groupWindows = windows(byGroupDay);
  const teacherWindows = windows(byTeacherDay);
  const placed = result.placements.length;
  return {
    placed,
    groupWindows,
    teacherWindows,
    lateLessons,
    overloadedDays,
    score:
      placed * 1000 -
      groupWindows * w.groupWindows -
      teacherWindows * w.teacherWindows -
      lateLessons * w.lateLessons -
      overloadedDays * w.groupDailyOverload,
  };
}

export function describeQuality(q: QualitySummary): string {
  return `пар ${q.placed}, окон у групп ${q.groupWindows}, у преподавателей ${q.teacherWindows}, поздних пар ${q.lateLessons}, перегруженных дней ${q.overloadedDays}`;
}
