import { diagnoseDemand } from './diagnostics';
import { solveHeuristic } from './heuristic-solver';
import { assertHardConstraints, baseProblem, demand, makeDays } from './__tests__/helpers';

describe('Эвристический генератор расписания', () => {
  it('ставит все пары без пересечений групп, подгрупп, преподавателей и аудиторий', () => {
    const problem = baseProblem({
      demands: [
        demand('math_lec', ['g1'], 't1', 6, ['r_lec', 'r_gen'], { semesterItemId: 'math' }),
        demand('math_pr', ['g1'], 't1', 6, ['r_gen', 'r_lec'], {
          semesterItemId: 'math',
          lessonType: 'PRACTICAL',
        }),
        demand('prog_lec', ['g1'], 't2', 6, ['r_lec'], { semesterItemId: 'prog' }),
        demand('prog_lab_1', ['g1'], 't2', 4, ['r_pc1', 'r_pc2'], {
          semesterItemId: 'prog',
          subgroupNumber: 1,
          lessonType: 'LABORATORY',
          size: 13,
        }),
        demand('prog_lab_2', ['g1'], 't3', 4, ['r_pc1', 'r_pc2'], {
          semesterItemId: 'prog',
          subgroupNumber: 2,
          lessonType: 'LABORATORY',
          size: 12,
        }),
        demand('math_g2', ['g2'], 't1', 6, ['r_gen', 'r_lec'], { semesterItemId: 'math2', size: 20 }),
      ],
    });
    const result = solveHeuristic(problem);
    expect(result.solver).toBe('heuristic');
    expect(result.stats.placedLessons).toBe(32);
    expect(result.unplaced).toEqual([]);
    assertHardConstraints(problem, result);
  });

  it('распределяет занятия равномерно по неделям', () => {
    const problem = baseProblem({ demands: [demand('a', ['g2'], 't2', 8, ['r_gen'], { size: 20 })] });
    const result = solveHeuristic(problem);
    const perWeek = new Map<number, number>();
    for (const p of result.placements) {
      const week = problem.days.find((d) => d.date === p.date)!.week;
      perWeek.set(week, (perWeek.get(week) ?? 0) + 1);
    }
    expect([...perWeek.values()].every((c) => c === 2)).toBe(true);
  });

  it('не ставит занятия в заблокированные даты группы и преподавателя', () => {
    const problem = baseProblem();
    const firstWeek = problem.days.filter((d) => d.week === 0).map((d) => d.date);
    problem.groups[1].allowedDates = problem.days.map((d) => d.date).filter((d) => !firstWeek.includes(d));
    problem.teachers[1].blockedDates = problem.days.filter((d) => d.week === 1).map((d) => d.date);
    problem.demands = [demand('a', ['g2'], 't2', 8, ['r_gen'], { size: 20 })];
    const result = solveHeuristic(problem);
    expect(result.stats.placedLessons).toBe(8);
    assertHardConstraints(problem, result);
  });

  it('ставит практику только в период практики (явные даты)', () => {
    const problem = baseProblem();
    const practiceDays = problem.days.filter((d) => d.week === 3).map((d) => d.date);
    problem.groups[1].allowedDates = problem.days.filter((d) => d.week < 3).map((d) => d.date);
    problem.demands = [
      demand('practice', ['g2'], 't2', 12, ['r_pc1'], {
        lessonType: 'PRACTICE',
        size: 20,
        allowedDates: practiceDays,
        disciplineKeys: [],
      }),
    ];
    const result = solveHeuristic(problem);
    expect(result.stats.placedLessons).toBe(12);
    expect(result.placements.every((p) => practiceDays.includes(p.date))).toBe(true);
  });

  it('возвращает частичный результат и объясняет причины', () => {
    const days = makeDays('2025-09-01', 1);
    const problem = baseProblem({ days });
    problem.groups.forEach((g) => (g.allowedDates = days.map((d) => d.date)));
    problem.demands = [demand('big', ['g2'], 't1', 30, ['r_gen', 'r_lec'], { size: 20 })];
    const result = solveHeuristic(problem);
    expect(result.status).toBe('PARTIAL');
    expect(result.unplaced[0].count).toBe(30 - result.stats.placedLessons);
    const { reasons } = diagnoseDemand(problem, result, problem.demands[0], result.unplaced[0].count);
    expect(reasons.length).toBeGreaterThan(0);
    // 30 пар за неделю невозможны: не более 2 пар дисциплины в день
    expect(reasons[0].code).toBe('DAILY_LIMITS');
    assertHardConstraints(problem, result);
  });

  it('учитывает уже существующие занятия (занятость)', () => {
    const problem = baseProblem();
    problem.occupied = problem.days.flatMap((d) =>
      [1, 2, 3].map((n) => ({
        date: d.date,
        lessonNumber: n,
        groupId: null,
        subgroupNumber: null,
        teacherId: 't2',
        roomId: null,
        disciplineKey: null,
      })),
    );
    problem.demands = [demand('x', ['g2'], 't2', 8, ['r_gen'], { size: 20 })];
    const result = solveHeuristic(problem);
    expect(result.stats.placedLessons).toBe(8);
    expect(result.placements.every((p) => p.lessonNumber > 3)).toBe(true);
  });

  it('режим постоянной недели разворачивает шаблон по датам', () => {
    const problem = baseProblem({ mode: 'WEEKLY_TEMPLATE' });
    problem.demands = [
      demand('a', ['g2'], 't2', 8, ['r_gen'], { size: 20 }),
      demand('b', ['g2'], 't3', 4, ['r_gen', 'r_lec'], { size: 20 }),
    ];
    const result = solveHeuristic(problem);
    expect(result.stats.placedLessons).toBe(12);
    assertHardConstraints(problem, result);
    const slots = new Set(
      result.placements
        .filter((p) => p.demandId === 'a')
        .map((p) => `${new Date(p.date).getUTCDay()}#${p.lessonNumber}`),
    );
    expect(slots.size).toBeLessThanOrEqual(2);
  });

  it('без подходящих аудиторий сообщает о нехватке аудиторий', () => {
    const problem = baseProblem({ demands: [demand('x', ['g2'], 't2', 2, [], { size: 20 })] });
    const result = solveHeuristic(problem);
    const { reasons } = diagnoseDemand(problem, result, problem.demands[0], 2);
    expect(reasons[0].code).toBe('NO_SUITABLE_ROOM');
  });
});
