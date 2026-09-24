import { WEEKDAYS, WEEKDAYS_SHORT } from './labels';

/** Работа с датами в формате YYYY-MM-DD без сдвига часовых поясов */

export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today(): string {
  return toDateStr(new Date());
}

export function addDays(s: string, days: number): string {
  const d = parseDate(s);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

export function isoWeekday(s: string): number {
  const js = parseDate(s).getDay();
  return js === 0 ? 7 : js;
}

export function weekStart(s: string): string {
  return addDays(s, -(isoWeekday(s) - 1));
}

export function formatDate(s: string | null | undefined): string {
  if (!s) return '—';
  const v = s.slice(0, 10);
  return `${v.slice(8, 10)}.${v.slice(5, 7)}.${v.slice(0, 4)}`;
}

export function formatDateShort(s: string): string {
  const v = s.slice(0, 10);
  return `${v.slice(8, 10)}.${v.slice(5, 7)}`;
}

export function formatDateTime(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function weekdayName(n: number, short = false): string {
  return (short ? WEEKDAYS_SHORT : WEEKDAYS)[n] ?? '';
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function formatDateLong(s: string): string {
  const d = parseDate(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatRange(from: string, to: string): string {
  return `${formatDate(from)} — ${formatDate(to)}`;
}

export function shortName(fullName: string | null | undefined): string {
  if (!fullName) return '—';
  const [last, first, middle] = fullName.split(' ');
  return [last, first ? `${first[0]}.` : '', middle ? `${middle[0]}.` : ''].join(' ').trim();
}

export function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('ru-RU', { maximumFractionDigits: digits });
}

export function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}
