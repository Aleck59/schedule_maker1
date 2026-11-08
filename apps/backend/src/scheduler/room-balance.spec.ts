import { assertHardConstraints, baseProblem, demand, makeDays } from './__tests__/helpers';
import { solveHeuristic } from './heuristic-solver';
import { rebalanceRooms } from './room-balance';
import { SolverRoom } from './solver.types';

const general = (id: string, extra: Partial<SolverRoom> = {}): SolverRoom => ({
  id,
  code: id,
  building: 'A',
  capacity: 30,
  type: 'GENERAL',
  unavailable: [],
  unlimited: false,
  ...extra,
});

describe('аудитории: равномерность, предпочтительная аудитория и метки', () => {
  const rooms = ['k1', 'k2', 'k3', 'k4'].map((id) => general(id));
  const ids = rooms.map((r) => r.id);

  it('пары распределяются по аудиториям, а не скапливаются в первой', () => {
    const problem = baseProblem({
      rooms,
      demands: [demand('a', ['g1'], 't2', 12, ids), demand('b', ['g2'], 't3', 12, ids, { size: 20 })],
    });
    const result = solveHeuristic(problem);
    assertHardConstraints(problem, result);
    const use = new Map<string, number>();
    for (const p of result.placements) use.set(p.roomId!, (use.get(p.roomId!) ?? 0) + 1);
    expect(result.placements).toHaveLength(24);
    expect(use.size).toBe(4);
    expect(Math.max(...use.values()) - Math.min(...use.values())).toBeLessThanOrEqual(4);
  });

  it('предпочтительная аудитория из нагрузки соблюдается', () => {
    const problem = baseProblem({
      rooms,
      demands: [
        demand('law', ['g1'], 't2', 10, ['k3', ...ids.filter((x) => x !== 'k3')], { preferredRoomId: 'k3' }),
        demand('math', ['g2'], 't3', 10, ids, { size: 20 }),
      ],
    });
    const result = solveHeuristic(problem);
    const law = result.placements.filter((p) => p.demandId === 'law');
    expect(law).toHaveLength(10);
    expect(law.every((p) => p.roomId === 'k3')).toBe(true);
  });

  it('аудитория с меткой — для своей дисциплины, другие туда без нужды не идут', () => {
    const tagged = rooms.map((r) => (r.id === 'k4' ? { ...r, tagged: true } : r));
    const problem = baseProblem({
      rooms: tagged,
      demands: [
        demand('eng', ['g1'], 't2', 8, ['k4', 'k1', 'k2', 'k3'], { taggedRoomIds: ['k4'] }),
        demand('math', ['g2'], 't3', 8, ids, { size: 20 }),
      ],
    });
    const result = solveHeuristic(problem);
    expect(result.placements.filter((p) => p.demandId === 'eng').every((p) => p.roomId === 'k4')).toBe(true);
    expect(result.placements.filter((p) => p.demandId === 'math').some((p) => p.roomId === 'k4')).toBe(false);
  });

  it('перестановка аудиторий не меняет время пар и не создаёт накладок', () => {
    const problem = baseProblem({
      rooms,
      demands: [demand('a', ['g1'], 't2', 6, ids), demand('b', ['g2'], 't3', 6, ids, { size: 20 })],
    });
    const days = problem.days.slice(0, 6).map((d) => d.date);
    const placements = days.flatMap((date) => [
      { demandId: 'a', date, lessonNumber: 1, roomId: 'k1' },
      { demandId: 'b', date, lessonNumber: 1, roomId: 'k2' },
    ]);
    const { placements: out } = rebalanceRooms(problem, placements);
    expect(out.map((p) => `${p.demandId}${p.date}${p.lessonNumber}`)).toEqual(
      placements.map((p) => `${p.demandId}${p.date}${p.lessonNumber}`),
    );
    for (const date of days) {
      const slot = out.filter((p) => p.date === date);
      expect(new Set(slot.map((p) => p.roomId)).size).toBe(2);
    }
    expect(new Set(out.map((p) => p.roomId)).size).toBeGreaterThan(2);
  });
});

describe('равномерность пар группы по неделям', () => {
  it('отставание первой недели не превращается в перегруженную вторую', () => {
    const days = makeDays('2025-09-01', 4, [1, 2, 3, 4, 5]);
    const firstWeek = days.filter((d) => d.week === 0).map((d) => d.date);
    // Преподаватель дисциплин «b», «c» в первую неделю отсутствует
    const problem = baseProblem({
      days,
      demands: ['a', 'b', 'c', 'd'].map((id, i) =>
        demand(id, ['g2'], i < 2 ? 't2' : 't3', 8, ['r_gen', 'r_lec'], { size: 20 }),
      ),
    });
    problem.teachers = problem.teachers.map((t) => (t.id === 't2' ? { ...t, blockedDates: firstWeek } : t));
    const result = solveHeuristic(problem);
    assertHardConstraints(problem, result);
    const weekOf = new Map(days.map((d) => [d.date, d.week]));
    const perWeek = [0, 0, 0, 0];
    for (const p of result.placements) perWeek[weekOf.get(p.date)!]++;
    expect(result.placements).toHaveLength(32);
    // Отставание догоняется постепенно: ни одна неделя не получает вдвое больше обычного
    expect(Math.max(...perWeek.slice(1))).toBeLessThanOrEqual(12);
  });
});
