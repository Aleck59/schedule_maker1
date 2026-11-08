import { today } from './format';

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** Начало учебного года и типовые семестры по умолчанию, «ММ-ДД» */
export const DEFAULT_YEAR_START = '09-01';

/** «09-01» → «1 сентября» */
export function monthDayText(monthDay: string): string {
  const [m, d] = monthDay.split('-').map(Number);
  return m && d ? `${d} ${MONTHS_GEN[m - 1]}` : monthDay;
}

/** «09-01» → «01.09» */
export function monthDayShort(monthDay: string): string {
  const [m, d] = monthDay.split('-');
  return m && d ? `${d}.${m}` : monthDay;
}

/** «1.9», «01.09» → «09-01»; null — не дата */
export function parseMonthDay(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})[./-](\d{1,2})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12 || day < 1) return null;
  if (day > new Date(Date.UTC(2023, month, 0)).getUTCDate()) return null;
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Год, в котором начался учебный год, содержащий дату */
export function academicYearOf(date: string = today(), yearStart = DEFAULT_YEAR_START): number {
  const y = Number(date.slice(0, 4));
  return date.slice(5, 10) >= yearStart ? y : y - 1;
}
