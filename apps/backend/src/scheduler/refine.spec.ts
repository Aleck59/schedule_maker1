import { solveHeuristic } from './heuristic-solver';
import { lateLessonCheck, qualityOf } from './quality';
import { assertHardConstraints, baseProblem, demand, makeDays } from './__tests__/helpers';

describe('доработка решения и доводка окон', () => {
  const days = makeDays('2025-09-01', 1, [1]);
  const problem = baseProblem({
    days,
    demands: [
      demand('math', ['g2'], 't2', 1, ['r_gen'], { semesterItemId: 'math' }),
      demand('phys', ['g2'], 't3', 1, ['r_gen'], { semesterItemId: 'phys' }),
    ],
  });

  it('окно группы между парами убирается перестановкой внутри дня', () => {
    // Исходное решение с окном: 1-я и 3-я пары
    const initial = [
      { demandId: 'math', date: days[0].date, lessonNumber: 1, roomId: 'r_gen' },
      { demandId: 'phys', date: days[0].date, lessonNumber: 3, roomId: 'r_gen' },
    ];
    expect(qualityOf(problem, { placements: initial } as never).groupWindows).toBe(1);
    const refined = solveHeuristic(problem, { initial });
    assertHardConstraints(problem, refined);
    expect(refined.placements).toHaveLength(2);
    expect(qualityOf(problem, refined).groupWindows).toBe(0);
    expect(refined.log.join(' ')).toContain('Доводка');
  });

  it('недопоставленные пары исходного решения досаживаются', () => {
    const initial = [{ demandId: 'math', date: days[0].date, lessonNumber: 1, roomId: 'r_gen' }];
    const refined = solveHeuristic(problem, { initial });
    assertHardConstraints(problem, refined);
    expect(refined.placements).toHaveLength(2);
    expect(refined.unplaced).toEqual([]);
  });

  it('занятие исходного решения, нарушающее ограничения, ставится заново', () => {
    // Иванова не работает по субботам; исходное решение ставит её в субботу
    const sat = makeDays('2025-09-06', 1, [6, 1]);
    const p = baseProblem({ days: sat, demands: [demand('bio', ['g2'], 't1', 1, ['r_gen'])] });
    const refined = solveHeuristic(p, {
      initial: [{ demandId: 'bio', date: '2025-09-06', lessonNumber: 1, roomId: 'r_gen' }],
    });
    assertHardConstraints(p, refined);
    expect(refined.placements).toHaveLength(1);
    expect(refined.placements[0].date).not.toBe('2025-09-06');
  });
});

describe('поздние пары', () => {
  it('у вечерней группы (режим включает поздние пары) поздние пары не считаются нарушением', () => {
    const p = baseProblem();
    p.groups[1].allowedLessons = [4, 5, 6];
    const isLate = lateLessonCheck(p);
    expect(isLate(['g2'], 6)).toBe(false);
    expect(isLate(['g2'], 5)).toBe(false);
    expect(isLate(['g1'], 6)).toBe(true);
    expect(isLate(['g1', 'g2'], 5)).toBe(true);
    expect(isLate(['g1'], 4)).toBe(false);
    // Режим дневной смены (1–4) не делает группу вечерней
    p.groups[1].allowedLessons = [1, 2, 3, 4];
    expect(lateLessonCheck(p)(['g2'], 5)).toBe(true);
  });
});
