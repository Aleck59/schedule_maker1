import { cumulativeTargetByDays, effectiveRate } from './pacing';

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
});
