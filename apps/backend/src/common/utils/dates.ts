/**
 * Работа с датами без времени (YYYY-MM-DD). В БД даты хранятся как DATE,
 * Prisma возвращает их как Date в 00:00 UTC — поэтому все вычисления ведутся в UTC.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type DateStr = string;

export function parseDate(value: string | Date): Date {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    throw new Error(`Некорректная дата: ${value}`);
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function toDateStr(value: Date | string): DateStr {
  if (typeof value === 'string') {
    return value.slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

export function addDays(value: Date | string, days: number): Date {
  const d = parseDate(value);
  return new Date(d.getTime() + days * DAY_MS);
}

export function addDaysStr(value: Date | string, days: number): DateStr {
  return toDateStr(addDays(value, days));
}

/** ISO-день недели: 1 — понедельник ... 7 — воскресенье */
export function isoWeekday(value: Date | string): number {
  const d = parseDate(value);
  const js = d.getUTCDay();
  return js === 0 ? 7 : js;
}

/** Понедельник недели, в которую входит дата */
export function weekStart(value: Date | string): DateStr {
  const wd = isoWeekday(value);
  return addDaysStr(value, -(wd - 1));
}

export function diffDays(a: Date | string, b: Date | string): number {
  return Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / DAY_MS);
}

export function eachDay(from: Date | string, to: Date | string): DateStr[] {
  const result: DateStr[] = [];
  const start = parseDate(from);
  const end = parseDate(to);
  for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) {
    result.push(new Date(t).toISOString().slice(0, 10));
  }
  return result;
}

export function maxDate(a: DateStr, b: DateStr): DateStr {
  return a > b ? a : b;
}

export function minDate(a: DateStr, b: DateStr): DateStr {
  return a < b ? a : b;
}

export function isWithin(date: DateStr, from: DateStr, to: DateStr): boolean {
  return date >= from && date <= to;
}

/** Пересекаются ли два интервала дат (включительно) */
export function rangesOverlap(aFrom: DateStr, aTo: DateStr, bFrom: DateStr, bTo: DateStr): boolean {
  return aFrom <= bTo && bFrom <= aTo;
}

/** Текущая дата в часовом поясе организации */
export function todayInTimezone(timezone = 'Europe/Moscow', now: Date = new Date()): DateStr {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    return parts.slice(0, 10);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

const RU_WEEKDAYS = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const RU_WEEKDAYS_SHORT = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function weekdayName(weekday: number, short = false): string {
  return (short ? RU_WEEKDAYS_SHORT : RU_WEEKDAYS)[weekday] ?? String(weekday);
}

/** 01.09.2025 */
export function formatDateRu(value: Date | string): string {
  const s = toDateStr(value);
  return `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
}
