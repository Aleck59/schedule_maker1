import { academicYearEnd, academicYearStart, groupStage, idsHash, isDismissed, nextYearly, sortEvents, TimelineEvent } from './event-rules';

const sem = (number: number, start: string, end: string) => ({
  id: `s${number}`,
  number,
  courseNumber: Math.ceil(number / 2),
  startDate: start,
  endDate: end,
});

describe('event-rules', () => {
  const semesters = [sem(1, '2025-09-01', '2025-12-31'), sem(2, '2026-01-12', '2026-06-30'), sem(3, '2026-09-01', '2026-12-31')];

  it('определяет выпуск, текущий семестр и каникулы', () => {
    expect(groupStage(semesters, '2027-01-10')).toEqual({ kind: 'graduated', lastEnd: '2026-12-31' });
    const studying = groupStage(semesters, '2026-11-14');
    expect(studying.kind).toBe('studying');
    if (studying.kind === 'studying') expect(studying.semester.number).toBe(3);
    const between = groupStage(semesters, '2026-07-15');
    expect(between.kind).toBe('between');
    if (between.kind === 'between') expect(between.next?.number).toBe(3);
    expect(groupStage([], '2026-01-01')).toEqual({ kind: 'no-semesters' });
  });

  it('последний день обучения — ещё не выпуск', () => {
    expect(groupStage(semesters, '2026-12-31').kind).toBe('studying');
  });

  it('хэш не зависит от порядка', () => {
    expect(idsHash(['b', 'a'])).toBe(idsHash(['a', 'b']));
    expect(idsHash(['a'])).not.toBe(idsHash(['a', 'b']));
  });

  it('скрытие навсегда и до даты', () => {
    expect(isDismissed(null, true, '2026-11-14')).toBe(true);
    expect(isDismissed('2026-11-14', true, '2026-11-14')).toBe(true);
    expect(isDismissed('2026-11-13', true, '2026-11-14')).toBe(false);
    expect(isDismissed(null, false, '2026-11-14')).toBe(false);
  });

  it('ежегодное напоминание и 29 февраля', () => {
    expect(nextYearly('2024-06-20', '2026-11-14')).toBe('2027-06-20');
    expect(nextYearly('2024-12-01', '2026-11-14')).toBe('2026-12-01');
    expect(nextYearly('2024-02-29', '2026-11-14')).toBe('2027-02-28');
  });

  it('границы учебного года', () => {
    expect(academicYearEnd('2026-11-14')).toBe('2027-06-30');
    expect(academicYearEnd('2027-03-01')).toBe('2027-06-30');
    expect(academicYearStart('2026-11-14')).toBe('2027-09-01');
    expect(academicYearStart('2026-08-20')).toBe('2026-09-01');
  });

  it('просроченные дела — сегодня, впереди требующие действий', () => {
    const e = (key: string, date: string, needsAction = false): TimelineEvent => ({
      key,
      category: 'reminders',
      severity: 'info',
      date,
      title: key,
      needsAction,
    });
    const sorted = sortEvents([e('later', '2026-12-01'), e('today', '2026-11-14'), e('overdue', '2026-11-01', true)], '2026-11-14');
    expect(sorted.map((x) => x.key)).toEqual(['overdue', 'today', 'later']);
  });
});
