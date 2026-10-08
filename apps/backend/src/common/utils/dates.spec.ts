import {
  addDaysStr,
  diffDays,
  eachDay,
  formatDateRu,
  isoWeekday,
  rangesOverlap,
  todayInTimezone,
  weekStart,
} from './dates';

describe('Работа с датами', () => {
  it('ISO-день недели и понедельник недели', () => {
    expect(isoWeekday('2025-09-01')).toBe(1);
    expect(isoWeekday('2025-09-07')).toBe(7);
    expect(weekStart('2025-09-07')).toBe('2025-09-01');
    expect(weekStart('2026-09-01')).toBe('2026-08-31');
  });

  it('арифметика дат без сдвига часовых поясов', () => {
    expect(addDaysStr('2025-12-31', 1)).toBe('2026-01-01');
    expect(diffDays('2026-03-01', '2026-02-01')).toBe(28);
    expect(eachDay('2025-09-01', '2025-09-03')).toEqual(['2025-09-01', '2025-09-02', '2025-09-03']);
    expect(formatDateRu('2025-09-01')).toBe('01.09.2025');
  });

  it('пересечение интервалов', () => {
    expect(rangesOverlap('2025-09-01', '2025-09-10', '2025-09-10', '2025-09-20')).toBe(true);
    expect(rangesOverlap('2025-09-01', '2025-09-09', '2025-09-10', '2025-09-20')).toBe(false);
  });

  it('текущая дата в часовом поясе организации', () => {
    expect(todayInTimezone('Europe/Moscow', new Date('2025-09-01T22:30:00Z'))).toBe('2025-09-02');
    expect(todayInTimezone('UTC', new Date('2025-09-01T22:30:00Z'))).toBe('2025-09-01');
  });
});
