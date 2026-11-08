import { isoWeekday } from './dates';
import {
  academicYearOf,
  academicYearRange,
  DEFAULT_ACADEMIC_CALENDAR,
  isValidMonthDay,
  semesterTemplates,
} from './academic-year';
import { academicWeekNumber } from '../../planning/availability-rules';

describe('academic-year', () => {
  it('проверяет даты «ММ-ДД»', () => {
    expect(isValidMonthDay('09-01')).toBe(true);
    expect(isValidMonthDay('02-29')).toBe(false);
    expect(isValidMonthDay('04-31')).toBe(false);
    expect(isValidMonthDay('9-1')).toBe(false);
  });

  it('определяет учебный год по началу года', () => {
    expect(academicYearOf('2026-08-31')).toBe(2025);
    expect(academicYearOf('2026-09-01')).toBe(2026);
    expect(academicYearOf('2026-09-15', '10-01')).toBe(2025);
    expect(academicYearRange(2026, '10-01')).toEqual({ start: '2026-10-01', end: '2027-09-30' });
  });

  it('типовые семестры по умолчанию совпадают с прежними', () => {
    const [first, second] = semesterTemplates(2026, DEFAULT_ACADEMIC_CALENDAR);
    expect(first).toMatchObject({
      start: '2026-09-01',
      end: '2026-12-31',
      theoreticalWeeks: 16,
      examWeeks: 1,
      vacationWeeks: 2,
    });
    expect(second).toMatchObject({ start: '2027-01-12', end: '2027-06-30', examWeeks: 2, vacationWeeks: 9 });
  });

  it('переносит начало семестра на ближайший учебный день', () => {
    // 01.09.2029 — суббота; учебные дни пн–пт, понедельник 03.09 — праздник колледжа
    const off = (d: string) => isoWeekday(d) > 5 || d === '2029-09-03';
    const [first] = semesterTemplates(2029, DEFAULT_ACADEMIC_CALENDAR, off);
    expect(first.start).toBe('2029-09-04');
  });

  it('считает недели (числитель/знаменатель) от начала учебного года', () => {
    expect(academicWeekNumber('2026-09-01')).toBe(1);
    expect(academicWeekNumber('2026-09-08')).toBe(2);
    expect(academicWeekNumber('2026-10-01', '10-01')).toBe(1);
    expect(academicWeekNumber('2026-09-30', '10-01')).toBeGreaterThan(50);
  });
});
