import { baseProblem, demand } from './__tests__/helpers';
import { qualityOf } from './quality';
import { SolverResult } from './solver.types';

const result = (placements: Array<[string, string, number]>): SolverResult => ({
  status: 'FEASIBLE',
  solver: 'heuristic',
  placements: placements.map(([demandId, date, lessonNumber]) => ({
    demandId,
    date,
    lessonNumber,
    roomId: null,
  })),
  unplaced: [],
  stats: { requiredLessons: placements.length, placedLessons: placements.length, durationMs: 0, weeks: 1 },
  log: [],
});

describe('оценка результата решателя', () => {
  const problem = baseProblem({
    demands: [
      demand('a', ['g2'], 't2', 3, ['r_gen'], { size: 20 }),
      demand('b', ['g2'], 't3', 1, ['r_gen'], { size: 20 }),
    ],
  });

  it('окна, поздние пары и количество поставленных пар', () => {
    const compact = qualityOf(
      problem,
      result([
        ['a', '2025-09-01', 1],
        ['a', '2025-09-01', 2],
        ['b', '2025-09-01', 3],
      ]),
    );
    const gappy = qualityOf(
      problem,
      result([
        ['a', '2025-09-01', 1],
        ['a', '2025-09-01', 3],
        ['b', '2025-09-01', 6],
      ]),
    );
    expect(compact).toMatchObject({ placed: 3, groupWindows: 0, lateLessons: 0 });
    expect(gappy.groupWindows).toBe(3);
    expect(gappy.lateLessons).toBe(1);
    expect(compact.score).toBeGreaterThan(gappy.score);
    // Поставленная пара важнее любых окон
    const more = qualityOf(
      problem,
      result([
        ['a', '2025-09-01', 1],
        ['a', '2025-09-01', 3],
        ['a', '2025-09-02', 6],
        ['b', '2025-09-01', 6],
      ]),
    );
    expect(more.score).toBeGreaterThan(compact.score);
  });
});
