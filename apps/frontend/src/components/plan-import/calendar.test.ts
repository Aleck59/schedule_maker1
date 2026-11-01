import { describe, expect, it } from 'vitest';
import { addDays, deriveFromCalendar, runs } from './calendar';
import type { RecognizedCalendar } from './types';

function year(startYear: number, codeOf: (week: number) => string): RecognizedCalendar {
  const sep1 = new Date(Date.UTC(startYear, 8, 1));
  const monday = addDays(sep1.toISOString().slice(0, 10), -((sep1.getUTCDay() + 6) % 7));
  return {
    course: 1,
    startYear,
    uncertain: [],
    weeks: Array.from({ length: 53 }, (_, w) => ({
      number: w + 1,
      monday: addDays(monday, 7 * w),
      days: Array(6).fill(codeOf(w)),
    })),
  };
}

describe('календарный график из скана', () => {
  it('семестры делятся по зимним каникулам, периоды объединяются через воскресенье', () => {
    const cal = year(2026, (w) => (w === 19 || w === 20 ? 'Э' : w === 21 || w === 22 || w >= 44 ? 'К' : ''));
    const { semesters, periods } = deriveFromCalendar([cal], [1, 2]);
    expect(semesters.map((s) => [s.number, s.startDate, s.endDate])).toEqual([
      [1, '2026-09-01', '2027-02-07'],
      [2, '2027-02-08', '2027-08-31'],
    ]);
    expect(semesters[0].examWeeks).toBe(2);
    expect(semesters[0].vacationWeeks).toBe(2);
    expect(periods.map((p) => [p.type, p.startDate, p.endDate])).toEqual([
      ['EXAM_SESSION', '2027-01-11', '2027-01-23'],
      ['VACATION', '2027-01-25', '2027-02-06'],
      ['VACATION', '2027-07-05', '2027-08-31'],
    ]);
  });

  it('последний год заканчивается до недель «=»', () => {
    const cal = year(2028, (w) => (w >= 44 ? '=' : w === 21 ? 'К' : ''));
    const { semesters } = deriveFromCalendar([cal], [1, 2]);
    expect(semesters[1].endDate).toBe('2029-06-30');
  });

  it('runs: разные коды подряд дают отдельные периоды', () => {
    expect(
      runs([
        ['2026-09-01', ''],
        ['2026-09-02', 'Э'],
        ['2026-09-03', 'Э'],
      ]).map((r) => r.code),
    ).toEqual(['', 'Э']);
  });
});
