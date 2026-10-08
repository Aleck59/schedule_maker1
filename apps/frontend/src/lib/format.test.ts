import { describe, expect, it } from 'vitest';
import { addDays, formatDate, isoWeekday, pluralize, shortName, weekStart } from './format';

describe('форматирование', () => {
  it('даты', () => {
    expect(formatDate('2025-09-01')).toBe('01.09.2025');
    expect(formatDate('2025-09-01T00:00:00.000Z')).toBe('01.09.2025');
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(isoWeekday('2025-09-07')).toBe(7);
    expect(weekStart('2025-09-07')).toBe('2025-09-01');
  });

  it('склонение и инициалы', () => {
    expect(pluralize(1, 'пара', 'пары', 'пар')).toBe('пара');
    expect(pluralize(3, 'пара', 'пары', 'пар')).toBe('пары');
    expect(pluralize(11, 'пара', 'пары', 'пар')).toBe('пар');
    expect(pluralize(22, 'пара', 'пары', 'пар')).toBe('пары');
    expect(shortName('Петров Алексей Сергеевич')).toBe('Петров А. С.');
  });
});
