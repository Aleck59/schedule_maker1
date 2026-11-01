import { cumulativeTargetByDays, effectiveRate, pacingPhases, teacherLimits } from './pacing';

describe('Темп постановки занятий', () => {
  it('равномерный темп и желаемый темп', () => {
    expect(effectiveRate(17, 16, null)).toBeCloseTo(1.0625);
    expect(effectiveRate(10, 5, 3)).toBe(3);
    expect(effectiveRate(4, 0, null)).toBe(4);
  });

  it('накопительная цель пропорциональна доступным дням', () => {
    // 18 пар, 16 недель по 6 дней
    expect(cumulativeTargetByDays(18, 6, 96, 1, null)).toBe(1);
    expect(cumulativeTargetByDays(18, 48, 96, 8, null)).toBe(9);
    expect(cumulativeTargetByDays(18, 96, 96, 16, null)).toBe(18);
    // Короткая неделя (1 день) получает меньше пар
    expect(cumulativeTargetByDays(30, 1, 91, 1, null)).toBe(0);
  });

  it('желаемый темп может опережать равномерный график', () => {
    expect(cumulativeTargetByDays(10, 6, 60, 1, 2)).toBe(2);
    expect(cumulativeTargetByDays(10, 30, 60, 5, 2)).toBe(10);
  });

  it('сдвиги округления разносят «лишние» пары дробного темпа по разным неделям', () => {
    expect(pacingPhases(1)).toEqual([0]);
    const phases = pacingPhases(4);
    // 4 дисциплины по 1,5 пары в неделю: без сдвигов — 8, 4, 8, 4 пары, со сдвигами — по 6
    const weekly = (shift: number[]) =>
      [1, 2, 3, 4].map((w) =>
        shift.reduce(
          (sum, ph) =>
            sum +
            cumulativeTargetByDays(24, w * 6, 96, w, null, ph) -
            cumulativeTargetByDays(24, (w - 1) * 6, 96, w - 1, null, ph),
          0,
        ),
      );
    expect(weekly([0, 0, 0, 0])).toEqual([8, 4, 8, 4]);
    expect(weekly(phases)).toEqual([6, 6, 6, 6]);
  });

  it('после выхода из отсутствия с отработкой лимиты преподавателя увеличены', () => {
    const t = {
      maxDailyLessons: 4,
      maxWeeklyLessons: 18,
      relaxedFrom: '2025-10-06',
      extraDailyLessons: 1,
      extraWeeklyLessons: 4,
    };
    expect(teacherLimits(t, '2025-10-05')).toEqual({ daily: 4, weekly: 18 });
    expect(teacherLimits(t, '2025-10-06')).toEqual({ daily: 5, weekly: 22 });
    expect(teacherLimits({ maxDailyLessons: 4, maxWeeklyLessons: 18 }, '2025-10-06')).toEqual({
      daily: 4,
      weekly: 18,
    });
  });
});
