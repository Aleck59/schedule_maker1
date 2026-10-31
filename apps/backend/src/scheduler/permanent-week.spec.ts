import { solveHeuristic, weeklySlots } from './heuristic-solver';
import { baseProblem, demand, makeDays } from './__tests__/helpers';

describe('Постоянное расписание (типовая неделя)', () => {
  it('переводит темп в пары недели с числителем/знаменателем', () => {
    expect(weeklySlots(2, 36)).toEqual({ weekly: 2, biweekly: false });
    expect(weeklySlots(1.5, 27)).toEqual({ weekly: 1, biweekly: true });
    expect(weeklySlots(1.8, 32)).toEqual({ weekly: 2, biweekly: false });
    expect(weeklySlots(1.1, 20)).toEqual({ weekly: 1, biweekly: false });
    expect(weeklySlots(0.2, 4)).toEqual({ weekly: 0, biweekly: true });
    expect(weeklySlots(0, 0)).toEqual({ weekly: 0, biweekly: false });
  });

  it('строит одну неделю без накладок и объединяет пары «через неделю» в один слот', () => {
    const days = makeDays('2025-09-01', 4);
    const problem = baseProblem({ days, mode: 'WEEKLY_TEMPLATE' });
    problem.settings.maximizePlacement = true;
    problem.demands = [
      // 6 пар за 4 недели — 1,5 в неделю: одна каждую неделю и одна через неделю
      demand('a', ['g2'], 't1', 6, ['r_gen'], { size: 20, semesterItemId: 'a' }),
      // 2 пары за 4 недели — через неделю
      demand('b', ['g2'], 't2', 2, ['r_gen'], { size: 20, semesterItemId: 'b' }),
    ];
    const result = solveHeuristic(problem, { templateOnly: true });
    expect(result.placements.every((p) => /^T\d$/.test(p.date))).toBe(true);
    expect(result.unplaced).toEqual([]);
    const halves = result.placements.filter((p) => p.parity);
    expect(halves.map((p) => p.parity).sort()).toEqual(['EVEN', 'ODD']);
    // Пары через неделю стоят в одном слоте
    expect(new Set(halves.map((p) => `${p.date}#${p.lessonNumber}`)).size).toBe(1);
    expect(result.stats.placedLessons).toBe(2);
    // Каждую неделю — без накладок группы
    const weekly = result.placements.filter((p) => !p.parity).map((p) => `${p.date}#${p.lessonNumber}`);
    expect(new Set([...weekly, `${halves[0].date}#${halves[0].lessonNumber}`]).size).toBe(weekly.length + 1);
  });

  it('при нехватке аудиторий ставит пару без аудитории (расстановка по максимуму)', () => {
    const days = makeDays('2025-09-01', 1);
    const problem = baseProblem({ days, mode: 'WEEKLY_TEMPLATE', lessonsPerDay: 1, workingDays: [1] });
    problem.groups.forEach((g) => (g.allowedDates = [days[0].date]));
    problem.teachers.forEach((t) => (t.unavailable = []));
    problem.settings.maximizePlacement = true;
    problem.demands = [
      demand('a', ['g1'], 't1', 1, ['r_gen'], { size: 20, semesterItemId: 'a' }),
      demand('b', ['g2'], 't2', 1, ['r_gen'], { size: 20, semesterItemId: 'b' }),
    ];
    const result = solveHeuristic(problem, { templateOnly: true });
    expect(result.placements).toHaveLength(2);
    expect(result.placements.filter((p) => p.roomId === null)).toHaveLength(1);
  });
});
