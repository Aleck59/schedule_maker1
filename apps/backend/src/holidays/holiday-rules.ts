import { addDaysStr, eachDay, isoWeekday } from '../common/utils/dates';

/**
 * Расчёт производственного календаря на год: нерабочие праздничные дни,
 * переносы выходных по постановлению Правительства и по ст. 112 ТК РФ,
 * рабочие выходные и сокращённые предпраздничные дни.
 *
 * Правила:
 * 1. Праздник (постоянный по дню и месяцу или разовый по дате) — нерабочий день.
 * 2. Перенос по постановлению «с X на Y» применяется, только если X — выходной
 *    при режиме недели организации. Y становится днём отдыха, а X (если это не праздник) — рабочим днём.
 *    При шестидневной неделе суббота рабочая, поэтому переносы с субботы не применяются.
 * 3. Если переносимый праздник (все, кроме новогодних 1–8 января) выпал на выходной и
 *    постановление его не переносит, выходной переносится на следующий рабочий день
 *    (ст. 112 ТК РФ): 8 марта в субботу — отдыхаем в понедельник 10 марта.
 * 4. Выходные, совпавшие с новогодними праздниками, переносятся только постановлением.
 * 5. Сокращённый (на 1 час) день — рабочий день перед праздником, в том числе через цепочку
 *    перенесённых дней отдыха; рабочий выходной по переносу сокращается, если сокращённым
 *    был бы день, с которого перенесён выходной.
 */

export type HolidayDayKind = 'HOLIDAY' | 'TRANSFERRED_DAY_OFF' | 'WORKING_WEEKEND' | 'SHORTENED';

export interface HolidayRuleInput {
  id?: string;
  title: string;
  /** Постоянный праздник: месяц и день */
  month?: number | null;
  day?: number | null;
  /** Разовый праздник: дата YYYY-MM-DD */
  date?: string | null;
  /** Переносится ли выходной, совпавший с праздником, на следующий рабочий день */
  transferable: boolean;
  active?: boolean;
}

export interface TransferRuleInput {
  id?: string;
  fromDate: string;
  toDate: string;
  basis?: string | null;
}

export interface HolidayDay {
  date: string;
  kind: HolidayDayKind;
  title: string;
  /** Пояснение: откуда взялся день (праздник, постановление, ст. 112 ТК РФ) */
  reason: string;
  holidayId?: string;
  transferId?: string;
}

export interface HolidayCalendar {
  year: number;
  workingDays: number[];
  days: HolidayDay[];
  /** Даты, когда занятия не проводятся (праздники и перенесённые выходные) */
  daysOff: string[];
  warnings: string[];
  summary: {
    calendarDays: number;
    workingDays: number;
    daysOff: number;
    holidays: number;
    transferredDaysOff: number;
    workingWeekends: number;
    shortenedDays: number;
  };
}

export interface ComputeOptions {
  /** Автоматический перенос по ст. 112 ТК РФ (по умолчанию включён) */
  autoTransfer?: boolean;
}

const WEEKDAY_SHORT = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const MONTHS_GEN = [
  '',
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

/** «8 марта (вс)» */
export function formatDayRu(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS_GEN[m]} (${WEEKDAY_SHORT[isoWeekday(date)]})`;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** Дата праздника в заданном году или null (например, 29 февраля в невисокосный год) */
export function holidayDateInYear(h: HolidayRuleInput, year: number): string | null {
  if (h.date) return h.date.startsWith(`${year}-`) ? h.date : null;
  if (!h.month || !h.day) return null;
  const date = `${year}-${pad(h.month)}-${pad(h.day)}`;
  const check = new Date(`${date}T00:00:00.000Z`);
  return check.getUTCMonth() + 1 === h.month ? date : null;
}

export function computeHolidayCalendar(
  year: number,
  workingDays: number[],
  holidays: HolidayRuleInput[],
  transfers: TransferRuleInput[],
  options: ComputeOptions = {},
): HolidayCalendar {
  const autoTransfer = options.autoTransfer ?? true;
  const isWeekend = (d: string) => !workingDays.includes(isoWeekday(d));
  const warnings: string[] = [];

  // 1. Праздники года
  const holidayByDate = new Map<string, { title: string; transferable: boolean; id?: string }>();
  for (const h of holidays) {
    if (h.active === false) continue;
    const date = holidayDateInYear(h, year);
    if (!date) continue;
    const prev = holidayByDate.get(date);
    if (prev) {
      // Один день — несколько праздников: объединяем названия
      if (!prev.title.includes(h.title)) prev.title = `${prev.title}; ${h.title}`;
      prev.transferable = prev.transferable || h.transferable;
      continue;
    }
    holidayByDate.set(date, { title: h.title, transferable: h.transferable, id: h.id });
  }

  const off = new Map<string, HolidayDay>();
  for (const [date, h] of holidayByDate) {
    off.set(date, {
      date,
      kind: 'HOLIDAY',
      title: h.title,
      reason: 'Нерабочий праздничный день',
      holidayId: h.id,
    });
  }
  const workingWeekends = new Map<string, HolidayDay>();

  // 2. Переносы по постановлению
  const yearTransfers = transfers
    .filter((t) => t.fromDate.startsWith(`${year}-`) || t.toDate.startsWith(`${year}-`))
    .sort((a, b) => a.fromDate.localeCompare(b.fromDate));
  const transferredFrom = new Set<string>();
  const appliedTransfers: TransferRuleInput[] = [];
  for (const t of yearTransfers) {
    if (!isWeekend(t.fromDate)) {
      warnings.push(
        `Перенос с ${formatDayRu(t.fromDate)} на ${formatDayRu(t.toDate)} не применяется: при вашем режиме недели это рабочий день.`,
      );
      continue;
    }
    appliedTransfers.push(t);
    transferredFrom.add(t.fromDate);
    const basis = t.basis ? ` (${t.basis})` : '';
    if (t.toDate.startsWith(`${year}-`) && !off.has(t.toDate)) {
      const fromHoliday = holidayByDate.get(t.fromDate);
      off.set(t.toDate, {
        date: t.toDate,
        kind: 'TRANSFERRED_DAY_OFF',
        title: fromHoliday ? `Перенос выходного (${fromHoliday.title})` : 'Перенос выходного',
        reason: `Выходной с ${formatDayRu(t.fromDate)} перенесён${basis}`,
        transferId: t.id,
      });
    }
    if (t.fromDate.startsWith(`${year}-`) && !holidayByDate.has(t.fromDate)) {
      workingWeekends.set(t.fromDate, {
        date: t.fromDate,
        kind: 'WORKING_WEEKEND',
        title: 'Рабочий день (перенос)',
        reason: `Выходной перенесён на ${formatDayRu(t.toDate)}${basis}`,
        transferId: t.id,
      });
    }
  }

  const isWorking = (d: string) => (!isWeekend(d) || workingWeekends.has(d)) && !off.has(d);

  // 3. Перенос по ст. 112 ТК РФ
  if (autoTransfer) {
    for (const date of [...holidayByDate.keys()].sort()) {
      const h = holidayByDate.get(date)!;
      if (!h.transferable || !isWeekend(date) || transferredFrom.has(date)) continue;
      let d = addDaysStr(date, 1);
      for (let guard = 0; guard < 30 && !isWorking(d); guard++) d = addDaysStr(d, 1);
      if (!d.startsWith(`${year}-`)) continue;
      off.set(d, {
        date: d,
        kind: 'TRANSFERRED_DAY_OFF',
        title: `Перенос выходного (${h.title})`,
        reason: `${h.title} выпал на ${formatDayRu(date)} — выходной переносится на следующий рабочий день (ст. 112 ТК РФ)`,
        holidayId: h.id,
      });
    }
  }

  // 4. Новогодние праздники на выходных без постановления
  const unmovedNonTransferable = [...holidayByDate.entries()].filter(
    ([date, h]) => !h.transferable && isWeekend(date) && !transferredFrom.has(date),
  );
  if (unmovedNonTransferable.length && appliedTransfers.length === 0 && yearTransfers.length === 0) {
    warnings.push(
      `Нет постановления о переносе выходных на ${year} год: выходные, совпавшие с новогодними праздниками ` +
        `(${unmovedNonTransferable.map(([d]) => formatDayRu(d)).join(', ')}), не перенесены. ` +
        'Добавьте переносы из постановления Правительства, когда оно будет опубликовано.',
    );
  }

  // 5. Сокращённые предпраздничные дни
  const shortened = new Map<string, HolidayDay>();
  const leadsToHoliday = (start: string): string | null => {
    // День start — праздник или цепочка перенесённых выходных, заканчивающаяся праздником в этом году
    let d = start;
    for (let guard = 0; guard < 15; guard++) {
      if (!d.startsWith(`${year}-`)) return null;
      if (holidayByDate.has(d)) return d;
      if (off.get(d)?.kind !== 'TRANSFERRED_DAY_OFF') return null;
      d = addDaysStr(d, 1);
    }
    return null;
  };
  for (const d of eachDay(`${year}-01-01`, `${year}-12-31`)) {
    if (!isWorking(d)) continue;
    const holiday = leadsToHoliday(addDaysStr(d, 1));
    if (holiday) {
      shortened.set(d, {
        date: d,
        kind: 'SHORTENED',
        title: 'Предпраздничный день',
        reason: `Сокращён на 1 час: накануне — ${holidayByDate.get(holiday)!.title}`,
      });
    }
  }
  for (const t of appliedTransfers) {
    if (!workingWeekends.has(t.fromDate) || shortened.has(t.fromDate)) continue;
    const holiday = leadsToHoliday(addDaysStr(t.toDate, 1));
    if (holiday && holiday !== t.toDate) {
      shortened.set(t.fromDate, {
        date: t.fromDate,
        kind: 'SHORTENED',
        title: 'Предпраздничный день',
        reason: `Рабочий день вместо ${formatDayRu(t.toDate)}, который был бы предпраздничным — сокращён на 1 час`,
      });
    }
  }

  const days = [...off.values(), ...workingWeekends.values(), ...shortened.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind),
  );
  const all = eachDay(`${year}-01-01`, `${year}-12-31`);
  const daysOff = [...off.keys()].sort();
  return {
    year,
    workingDays,
    days,
    daysOff,
    warnings,
    summary: {
      calendarDays: all.length,
      workingDays: all.filter(isWorking).length,
      daysOff: all.filter((d) => !isWorking(d)).length,
      holidays: [...off.values()].filter((d) => d.kind === 'HOLIDAY').length,
      transferredDaysOff: [...off.values()].filter((d) => d.kind === 'TRANSFERRED_DAY_OFF').length,
      workingWeekends: workingWeekends.size,
      shortenedDays: shortened.size,
    },
  };
}
