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

  it('гибкие правила: запрещённые слоты дат и онлайн-слоты в онлайн-аудитории', () => {
    const problem = baseProblem();
    const dates = problem.days.map((d) => d.date);
    const blocked = dates
      .slice(0, 6)
      .flatMap((d) => [1, 2, 3, 4, 5, 6].map((n) => [d, n] as [string, number]));
    const onlineDay = dates[7];
    problem.rooms.push({
      id: 'r_online',
      code: 'Онлайн',
      building: null,
      capacity: 500,
      type: 'ONLINE',
      unavailable: [],
      unlimited: true,
    });
    problem.onlineRoomId = 'r_online';
    problem.teachers[1].blockedSlots = blocked;
    problem.teachers[1].onlineSlots = [1, 2, 3, 4, 5, 6].map((n) => [onlineDay, n] as [string, number]);
    problem.teachers[1].slotPreferences = [[onlineDay, 1, 10]];
    problem.demands = [demand('a', ['g2'], 't2', 8, ['r_gen'], { size: 20 })];
    const result = solveHeuristic(problem);
    expect(result.stats.placedLessons).toBe(8);
    const blockedSet = new Set(blocked.map(([d, n]) => `${d}#${n}`));
    for (const p of result.placements) {
      expect(blockedSet.has(`${p.date}#${p.lessonNumber}`)).toBe(false);
      expect(p.roomId).toBe(p.date === onlineDay ? 'r_online' : 'r_gen');
    }
    expect(result.placements.some((p) => p.date === onlineDay)).toBe(true);
  });

  it('распределяет пары преподавателя по неделям ровно, без чередования «много — мало»', () => {
    const days = makeDays('2025-09-01', 8);
    const all = days.map((d) => d.date);
    const groups = ['a', 'b', 'c', 'd'].map((id) => ({
      id,
      code: id,
      size: 25,
      subgroups: [],
      allowedDates: all,
      maxLessonsPerDay: 4,
    }));
    const problem = baseProblem({
      days,
      groups,
      demands: groups.map((g) =>
        demand(`${g.id}-x`, [g.id], 't2', 12, ['r_gen', 'r_lec'], { semesterItemId: g.id }),
      ),
    });
    problem.teachers[1].maxWeeklyLessons = 8;
    const result = solveHeuristic(problem);
    assertHardConstraints(problem, result);
    expect(result.stats.placedLessons).toBe(48);
    const perWeek = new Map<number, number>();
    const weekOf = new Map(days.map((d) => [d.date, d.week]));
    for (const p of result.placements)
      perWeek.set(weekOf.get(p.date)!, (perWeek.get(weekOf.get(p.date)!) ?? 0) + 1);
    // 48 пар за 8 недель — по 6 в неделю
    expect([...perWeek.values()].every((n) => n === 6)).toBe(true);
  });

  it('отработка после отсутствия: после выхода лимит недели превышается, пары не теряются', () => {
    const days = makeDays('2025-09-01', 4);
    const all = days.map((d) => d.date);
    const absent = all.filter((d) => d < '2025-09-15');
    const make = (relief: boolean) => {
      const problem = baseProblem({
        days,
        groups: [{ id: 'g1', code: 'g1', size: 25, subgroups: [], allowedDates: all, maxLessonsPerDay: 6 }],
        demands: [demand('x', ['g1'], 't2', 16, ['r_gen', 'r_lec'], { semesterItemId: 'x' })],
        settings: { ...baseProblem().settings, maxSameDisciplinePerDay: 3, maxSameDisciplinePerWeek: 12 },
      });
      const t = problem.teachers[1];
      t.maxWeeklyLessons = 6;
      t.blockedDates = absent;
      if (relief)
        Object.assign(t, { relaxedFrom: '2025-09-15', extraDailyLessons: 1, extraWeeklyLessons: 4 });
      return problem;
    };
    // Без отработки: две недели по 6 пар — 4 пары не помещаются
    expect(solveHeuristic(make(false)).stats.placedLessons).toBe(12);
    const problem = make(true);
    const result = solveHeuristic(problem);
    assertHardConstraints(problem, result);
    expect(result.stats.placedLessons).toBe(16);
    expect(result.placements.every((p) => p.date >= '2025-09-15')).toBe(true);
  });

  describe('расстановка по максимуму', () => {
    const days = makeDays('2025-09-01', 1);
    const make = (maximizePlacement: boolean) => {
      const problem = baseProblem({ days });
      problem.groups.forEach((g) => (g.allowedDates = days.map((d) => d.date)));
      problem.settings.forbidLateLessons = true;
      problem.settings.maximizePlacement = maximizePlacement;
      problem.demands = [demand('big', ['g2'], 't1', 30, ['r_gen', 'r_lec'], { size: 20 })];
      return problem;
    };

    it('ставит все пары сверх лимитов, не нарушая недоступность и накладки', () => {
      expect(solveHeuristic(make(false)).stats.placedLessons).toBeLessThanOrEqual(10);
      const result = solveHeuristic(make(true));
      expect(result.stats.placedLessons).toBe(30);
      expect(result.unplaced).toEqual([]);
      // Иванова не работает по субботам
      const weekdays = new Map(days.map((d) => [d.date, d.weekday]));
      expect(result.placements.every((p) => weekdays.get(p.date) !== 6)).toBe(true);
      expect(new Set(result.placements.map((p) => `${p.date}#${p.lessonNumber}`)).size).toBe(30);
      expect(result.log.join(' ')).toContain('по максимуму');
    });

    it('доработка сохраняет занятия решения «по максимуму» сверх лимитов', () => {
      const problem = make(true);
      const initial = solveHeuristic(problem).placements;
      const refined = solveHeuristic(problem, { initial });
      expect(refined.stats.placedLessons).toBe(30);
      expect(refined.log.join(' ')).not.toContain('не прошли проверку');
    });

    it('причина непоставленных пар — жёсткое ограничение, а не ослабленные лимиты', () => {
      const problem = make(true);
      problem.demands[0].lessonsRequired = 40;
      const result = solveHeuristic(problem);
      expect(result.stats.placedLessons).toBe(30);
      const { reasons } = diagnoseDemand(problem, result, problem.demands[0], result.unplaced[0].count);
      // Все рабочие слоты Ивановой заняты её же парами; суббота недоступна
      expect(reasons[0].code).toBe('TEACHER_BUSY');
      expect(reasons.map((r) => r.code)).not.toContain('DAILY_LIMITS');
      expect(reasons.map((r) => r.code)).not.toContain('TEACHER_LIMIT');
    });
  });
});
