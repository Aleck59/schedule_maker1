/** Модуль «Праздники»: подписи и сетка месяца для календаря года */

export type HolidayDayKind = 'HOLIDAY' | 'TRANSFERRED_DAY_OFF' | 'WORKING_WEEKEND' | 'SHORTENED';

export const HOLIDAY_DAY_KIND_LABELS: Record<HolidayDayKind, string> = {
  HOLIDAY: 'Праздник',
  TRANSFERRED_DAY_OFF: 'Перенесённый выходной',
  WORKING_WEEKEND: 'Рабочий выходной',
  SHORTENED: 'Сокращённый день',
};

export const HOLIDAY_KIND_LABELS: Record<string, string> = {
  FEDERAL: 'Федеральный',
  REGIONAL: 'Региональный',
  CUSTOM: 'Свой',
};

export const HOLIDAY_MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** «23 февраля» для постоянного праздника, «20.03.2026» — для разового */
export function holidayDateLabel(h: { month: number | null; day: number | null; date: string | null }): string {
  if (h.date) {
    const [y, m, d] = h.date.split('-');
    return `${d}.${m}.${y}`;
  }
  if (h.month && h.day) return `${h.day} ${MONTHS_GEN[h.month - 1]}`;
  return '—';
}

/** Ячейки месяца с понедельника: null — пустые клетки до 1-го числа */
export function monthMatrix(year: number, monthIndex: number): Array<{ date: string; day: number; weekday: number } | null> {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const cells: Array<{ date: string; day: number; weekday: number } | null> = Array(offset).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ date, day: d, weekday: ((offset + d - 1) % 7) + 1 });
  }
  return cells;
}
