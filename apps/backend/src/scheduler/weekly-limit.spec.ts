import { diagnoseDemand } from './diagnostics';
import { solveHeuristic } from './heuristic-solver';
import { assertHardConstraints, baseProblem, demand, makeDays } from './__tests__/helpers';
import { SolverProblem, SolverResult } from './solver.types';
import { fullTimeLimitOnExtramural, weeklyLessonLimit } from '../common/utils/weekly-limits';

/** Занятых слотов группы по неделям (параллельные подгруппы — одна пара) */
function groupWeekSlots(problem: SolverProblem, result: SolverResult, groupId: string): Map<number, number> {
  const demands = new Map(problem.demands.map((d) => [d.id, d]));
  const weekOf = new Map(problem.days.map((d) => [d.date, d.week]));
  const slots = new Set<string>();
  for (const p of result.placements) {
    if (demands.get(p.demandId)!.groupIds.includes(groupId)) slots.add(`${p.date}#${p.lessonNumber}`);
  }
  const perWeek = new Map<number, number>();
  for (const s of slots) {
    const w = weekOf.get(s.split('#')[0])!;
    perWeek.set(w, (perWeek.get(w) ?? 0) + 1);
  }
  return perWeek;
}

const subgroupDemands = () => [
  demand('lec', ['g1'], 't2', 12, ['r_lec'], { semesterItemId: 'lec' }),
  demand('lab1', ['g1'], 't1', 8, ['r_pc1'], {
    semesterItemId: 'lab',
    subgroupNumber: 1,
    lessonType: 'LABORATORY',
    size: 13,
  }),
  demand('lab2', ['g1'], 't3', 8, ['r_pc2'], {
    semesterItemId: 'lab',
    subgroupNumber: 2,
    lessonType: 'LABORATORY',
    size: 12,
  }),
];

describe('Максимум пар группы в неделю', () => {
  it('не превышает лимит и особый лимит недели, даже «по максимуму»', () => {
    const problem = baseProblem({ demands: subgroupDemands() });
    problem.groups[0].maxLessonsPerWeek = 3;
    problem.groups[0].weekLimits = [[1, 1]];
    problem.settings.maximizePlacement = true;
    const result = solveHeuristic(problem);
    assertHardConstraints(problem, result);
    const perWeek = groupWeekSlots(problem, result, 'g1');
    for (const [w, n] of perWeek) expect(n).toBeLessThanOrEqual(w === 1 ? 1 : 3);
    // Подгруппы параллельно занимают один слот: пар больше, чем слотов
    expect(result.placements.length).toBeGreaterThan([...perWeek.values()].reduce((a, b) => a + b, 0));
    // Недопоставленное объясняется лимитом группы
    const lec = result.unplaced.find((u) => u.demandId === 'lec');
    expect(lec).toBeDefined();
    const { reasons } = diagnoseDemand(problem, result, problem.demands[0], lec!.count);
    expect(reasons.map((r) => r.code)).toContain('GROUP_WEEKLY_LIMIT');
  });

  it('без лимита ставит больше пар в неделю', () => {
    const problem = baseProblem({ demands: subgroupDemands() });
    const result = solveHeuristic(problem);
    const max = Math.max(...groupWeekSlots(problem, result, 'g1').values());
    expect(max).toBeGreaterThan(3);
  });

  it('учитывает уже стоящие пары группы', () => {
    const days = makeDays('2025-09-01', 1);
    const problem = baseProblem({ days });
    problem.groups.forEach((g) => (g.allowedDates = days.map((d) => d.date)));
    problem.groups[1].maxLessonsPerWeek = 4;
    problem.occupied = [1, 2, 3].map((n) => ({
      date: days[0].date,
      lessonNumber: n,
      groupId: 'g2',
      subgroupNumber: null,
      teacherId: 't3',
      roomId: 'r_gen',
      disciplineKey: null,
    }));
    problem.demands = [demand('a', ['g2'], 't2', 6, ['r_lec'], { size: 20 })];
    const result = solveHeuristic(problem);
    expect(result.stats.placedLessons).toBe(1);
    const { reasons } = diagnoseDemand(problem, result, problem.demands[0], 5);
    expect(reasons[0].code).toBe('GROUP_WEEKLY_LIMIT');
  });

  it('лимит по форме обучения и снижение для очников', () => {
    const settings = {
      maxWeeklyLessonsFullTime: 18,
      maxWeeklyLessonsPartTime: 8,
      maxWeeklyLessonsExtramural: null,
      reduceFullTimeOnExtramural: false,
      fullTimeWeeklyOnExtramural: 14,
    };
    expect(weeklyLessonLimit(settings, 'FULL_TIME')).toBe(18);
    expect(weeklyLessonLimit(settings, 'PART_TIME')).toBe(8);
    expect(weeklyLessonLimit(settings, 'EXTRAMURAL')).toBeNull();
    expect(fullTimeLimitOnExtramural(settings)).toBeNull();
    expect(fullTimeLimitOnExtramural({ ...settings, reduceFullTimeOnExtramural: true })).toBe(14);
    expect(
      fullTimeLimitOnExtramural({
        ...settings,
        reduceFullTimeOnExtramural: true,
        fullTimeWeeklyOnExtramural: 20,
      }),
    ).toBe(18);
  });
});
