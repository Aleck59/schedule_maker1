import { computeHolidayCalendar } from './holiday-rules';
import { DECREE_TRANSFERS, FEDERAL_HOLIDAYS } from './holiday-presets';

const FIVE_DAY = [1, 2, 3, 4, 5];
const SIX_DAY = [1, 2, 3, 4, 5, 6];

function calendar(year: number, workingDays: number[]) {
  return computeHolidayCalendar(year, workingDays, FEDERAL_HOLIDAYS, DECREE_TRANSFERS);
}

function kinds(year: number, workingDays: number[], kind: string) {
  return calendar(year, workingDays)
    .days.filter((d) => d.kind === kind)
    .map((d) => d.date.slice(5));
}

describe('computeHolidayCalendar — пятидневная неделя (производственный календарь)', () => {
  it('2026: 247 рабочих дней, переносы по постановлению № 1466 и ст. 112 ТК РФ', () => {
    const c = calendar(2026, FIVE_DAY);
    expect(c.summary.workingDays).toBe(247);
    expect(kinds(2026, FIVE_DAY, 'TRANSFERRED_DAY_OFF')).toEqual(['01-09', '03-09', '05-11', '12-31']);
    expect(kinds(2026, FIVE_DAY, 'SHORTENED')).toEqual(['04-30', '05-08', '06-11', '11-03']);
    expect(kinds(2026, FIVE_DAY, 'WORKING_WEEKEND')).toEqual([]);
    expect(c.warnings).toEqual([]);
  });

  it('2027: 247 рабочих дней, переносы по постановлению № 1187', () => {
    const c = calendar(2027, FIVE_DAY);
    expect(c.summary.workingDays).toBe(247);
    // 1–10 января, 21–23 февраля, 6–8 марта, 1–3 и 8–10 мая, 12–14 июня, 4–7 ноября, 31 декабря
    expect(kinds(2027, FIVE_DAY, 'TRANSFERRED_DAY_OFF')).toEqual([
      '02-22',
      '05-03',
      '05-10',
      '06-14',
      '11-05',
      '12-31',
    ]);
    expect(kinds(2027, FIVE_DAY, 'WORKING_WEEKEND')).toEqual(['02-20']);
    expect(kinds(2027, FIVE_DAY, 'SHORTENED')).toEqual(['02-20', '04-30', '06-11', '11-03']);
  });

  it('2025: постановление переносит выходные с праздников вместо ст. 112', () => {
    const c = calendar(2025, FIVE_DAY);
    expect(c.summary.workingDays).toBe(247);
    // 23 февраля (вс) → 8 мая, 8 марта (сб) → 13 июня; 24 февраля и 10 марта — рабочие
    expect(kinds(2025, FIVE_DAY, 'TRANSFERRED_DAY_OFF')).toEqual([
      '05-02',
      '05-08',
      '06-13',
      '11-03',
      '12-31',
    ]);
    expect(c.daysOff).not.toContain('2025-02-24');
    expect(c.daysOff).not.toContain('2025-03-10');
    expect(kinds(2025, FIVE_DAY, 'WORKING_WEEKEND')).toEqual(['11-01']);
    expect(kinds(2025, FIVE_DAY, 'SHORTENED')).toEqual(['03-07', '04-30', '05-07', '06-11', '11-01']);
  });
});

describe('computeHolidayCalendar — шестидневная неделя', () => {
  it('2026: переносы с субботы не применяются, с воскресенья — применяются', () => {
    const c = calendar(2026, SIX_DAY);
    // 3 января (сб) — рабочий день при шестидневке, перенос на 9 января не действует
    expect(c.daysOff).not.toContain('2026-01-09');
    // 4 января (вс) → 31 декабря, 8 марта (вс) → 9 марта
    expect(kinds(2026, SIX_DAY, 'TRANSFERRED_DAY_OFF')).toEqual(['03-09', '12-31']);
    // 9 мая (сб) — праздник, но не выходной при шестидневке — не переносится
    expect(c.daysOff).not.toContain('2026-05-11');
    expect(kinds(2026, SIX_DAY, 'SHORTENED')).toEqual(['03-07', '04-30', '05-08', '06-11', '11-03']);
    expect(c.warnings.length).toBe(1);
  });

  it('2027: 9 мая (вс) → 10 мая, 1 мая и 12 июня (сб) не переносятся', () => {
    const c = calendar(2027, SIX_DAY);
    expect(c.daysOff).toContain('2027-05-10');
    expect(c.daysOff).not.toContain('2027-05-03');
    expect(c.daysOff).not.toContain('2027-06-14');
    expect(c.daysOff).not.toContain('2027-02-22');
    expect(c.daysOff).toContain('2027-12-31');
  });
});

describe('computeHolidayCalendar — общие правила', () => {
  it('без постановления: ст. 112 работает, новогодние выходные не переносятся с предупреждением', () => {
    const c = computeHolidayCalendar(2028, FIVE_DAY, FEDERAL_HOLIDAYS, []);
    // 2028: 1 января — суббота
    expect(c.warnings.join(' ')).toContain('Нет постановления');
    // 23 февраля 2028 — среда, 8 марта — среда; 1 мая — понедельник; 9 мая — вторник
    // 12 июня 2028 — понедельник; 4 ноября 2028 — суббота → 6 ноября
    expect(c.days.filter((d) => d.kind === 'TRANSFERRED_DAY_OFF').map((d) => d.date)).toEqual(['2028-11-06']);
  });

  it('разовый региональный праздник и отключённый праздник', () => {
    const c = computeHolidayCalendar(
      2026,
      FIVE_DAY,
      [
        ...FEDERAL_HOLIDAYS.map((h) => (h.month === 11 ? { ...h, active: false } : h)),
        { date: '2026-03-20', title: 'Ураза-байрам', transferable: false },
      ],
      DECREE_TRANSFERS,
    );
    expect(c.daysOff).toContain('2026-03-20');
    expect(c.daysOff).not.toContain('2026-11-04');
  });

  it('отключение автопереноса', () => {
    const c = computeHolidayCalendar(2026, FIVE_DAY, FEDERAL_HOLIDAYS, DECREE_TRANSFERS, {
      autoTransfer: false,
    });
    expect(c.daysOff).not.toContain('2026-03-09');
    expect(c.daysOff).toContain('2026-01-09');
  });
});
