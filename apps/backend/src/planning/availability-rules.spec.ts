import { AvailabilityRuleKind, WeekParity } from '@prisma/client';
import {
  academicWeekNumber,
  AvailabilityRuleLike,
  describeRule,
  ruleMatchesDate,
  TeacherRules,
  weekdayOccurrence,
} from './availability-rules';

const TIMES = [
  { lessonNumber: 1, startTime: '08:30', endTime: '10:00' },
  { lessonNumber: 2, startTime: '10:10', endTime: '11:40' },
  { lessonNumber: 3, startTime: '12:10', endTime: '13:40' },
  { lessonNumber: 4, startTime: '13:50', endTime: '15:20' },
  { lessonNumber: 5, startTime: '15:30', endTime: '17:00' },
  { lessonNumber: 6, startTime: '17:10', endTime: '18:40' },
];

function rule(patch: Partial<AvailabilityRuleLike>): AvailabilityRuleLike {
  return {
    id: 'r',
    kind: AvailabilityRuleKind.UNAVAILABLE,
    weekdays: [],
    lessonNumbers: [],
    timeFrom: null,
    timeTo: null,
    parity: WeekParity.ANY,
    monthWeeks: [],
    validFrom: null,
    validTo: null,
    weight: 5,
    note: null,
    ...patch,
  };
}

describe('гибкие правила доступности преподавателя', () => {
  it('номер недели учебного года и порядковый день недели в месяце', () => {
    expect(academicWeekNumber('2026-09-01')).toBe(1);
    expect(academicWeekNumber('2026-09-07')).toBe(2);
    expect(academicWeekNumber('2027-01-11')).toBe(20);
    expect(weekdayOccurrence('2026-10-03')).toEqual({ index: 1, last: false });
    expect(weekdayOccurrence('2026-10-31')).toEqual({ index: 5, last: true });
    expect(weekdayOccurrence('2026-10-24')).toEqual({ index: 4, last: false });
  });

  it('последняя суббота месяца и первая неделя месяца', () => {
    const lastSaturday = rule({ weekdays: [6], monthWeeks: [-1] });
    expect(ruleMatchesDate(lastSaturday, '2026-10-31')).toBe(true);
    expect(ruleMatchesDate(lastSaturday, '2026-10-24')).toBe(false);
    expect(ruleMatchesDate(lastSaturday, '2026-11-28')).toBe(true);
    const firstWeek = rule({ monthWeeks: [1] });
    expect(ruleMatchesDate(firstWeek, '2026-11-02')).toBe(true);
    expect(ruleMatchesDate(firstWeek, '2026-11-07')).toBe(true);
    expect(ruleMatchesDate(firstWeek, '2026-11-09')).toBe(false);
  });

  it('чётность недели и период действия', () => {
    const odd = rule({ parity: WeekParity.ODD, validFrom: '2026-09-01', validTo: '2026-12-31' });
    expect(ruleMatchesDate(odd, '2026-09-02')).toBe(true);
    expect(ruleMatchesDate(odd, '2026-09-09')).toBe(false);
    expect(ruleMatchesDate(odd, '2027-01-13')).toBe(false);
  });

  it('интервал времени: «не может» — при пересечении, «только» — пара целиком внутри', () => {
    const rules = new TeacherRules([rule({ weekdays: [3], timeFrom: '13:00', timeTo: '23:00' })], TIMES);
    expect(rules.evaluate('2026-10-07', 2).blocked).toBe(false);
    expect(rules.evaluate('2026-10-07', 3).blocked).toBe(true);
    expect(rules.evaluate('2026-10-08', 3).blocked).toBe(false);

    const only = new TeacherRules(
      [
        rule({
          kind: AvailabilityRuleKind.AVAILABLE_ONLY,
          weekdays: [1, 2],
          timeFrom: '08:00',
          timeTo: '13:45',
        }),
      ],
      TIMES,
    );
    expect(only.evaluate('2026-10-05', 3).blocked).toBe(false);
    expect(only.evaluate('2026-10-05', 4).blocked).toBe(true);
    expect(only.evaluate('2026-10-07', 1).blocked).toBe(true);
  });

  it('онлайн и предпочтения', () => {
    const rules = new TeacherRules(
      [
        rule({ kind: AvailabilityRuleKind.ONLINE, weekdays: [6] }),
        rule({ kind: AvailabilityRuleKind.PREFERRED, lessonNumbers: [1, 2], weight: 4 }),
        rule({ kind: AvailabilityRuleKind.UNDESIRED, weekdays: [6], lessonNumbers: [2], weight: 6 }),
      ],
      TIMES,
    );
    const sat = rules.evaluate('2026-10-10', 2);
    expect(sat).toMatchObject({ blocked: false, online: true, weight: -2 });
    expect(rules.evaluate('2026-10-09', 1)).toMatchObject({ online: false, weight: 4 });
  });

  it('описание правила на русском', () => {
    expect(describeRule(rule({ weekdays: [6], monthWeeks: [-1] }))).toBe(
      'Не может вести занятия: последняя суббота месяца, все пары',
    );
    expect(describeRule(rule({ kind: AvailabilityRuleKind.ONLINE, monthWeeks: [1] }))).toBe(
      'Занятия онлайн: 1-я неделя месяца, все пары',
    );
    expect(
      describeRule(
        rule({
          kind: AvailabilityRuleKind.AVAILABLE_ONLY,
          weekdays: [1, 3],
          lessonNumbers: [1, 2],
          parity: WeekParity.EVEN,
        }),
        TIMES,
      ),
    ).toBe('Ведёт занятия только: понедельник, среда, чётные недели, 1 (08:30–10:00), 2 (10:10–11:40) пара');
  });
});
