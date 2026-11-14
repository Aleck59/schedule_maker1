import { createHash } from 'node:crypto';
import { DateStr, toDateStr } from '../common/utils/dates';

export type EventCategory =
  'assessments' | 'groups' | 'process' | 'holidays' | 'teachers' | 'schedule' | 'reminders';
export type EventSeverity = 'danger' | 'warning' | 'info' | 'success';
export type EventAction = 'archive-graduates' | 'sync-semesters';

export interface TimelineItem {
  id?: string;
  title: string;
  subtitle?: string | null;
  warning?: string | null;
  link?: string | null;
}

export interface TimelineEvent {
  /** Устойчивый ключ события (для «Скрыть») */
  key: string;
  category: EventCategory;
  severity: EventSeverity;
  /** Дата события; для просроченных и текущих дел — дата, с которой они требуют внимания */
  date: DateStr;
  endDate?: DateStr | null;
  /** Событие идёт сейчас (началось раньше сегодняшнего дня) */
  ongoing?: boolean;
  title: string;
  description?: string | null;
  link?: { to: string; label: string } | null;
  items?: TimelineItem[];
  /** Требует действий пользователя (счётчик на пункте меню) */
  needsAction: boolean;
  action?: EventAction | null;
  groupIds?: string[];
  reminderId?: string;
  notes?: string | null;
  yearly?: boolean;
  hidden?: boolean;
  hiddenUntil?: DateStr | null;
}

export interface SemesterLike {
  id: string;
  number: number;
  courseNumber: number;
  startDate: Date | string;
  endDate: Date | string;
}

export type GroupStage =
  | { kind: 'no-semesters' }
  | { kind: 'graduated'; lastEnd: DateStr }
  | { kind: 'studying'; semester: SemesterLike; lastEnd: DateStr }
  | { kind: 'between'; next: SemesterLike | null; lastEnd: DateStr };

/** Где группа находится по датам учебного плана на день `today` */
export function groupStage(semesters: SemesterLike[], today: DateStr): GroupStage {
  if (semesters.length === 0) return { kind: 'no-semesters' };
  const sorted = [...semesters].sort((a, b) => toDateStr(a.startDate).localeCompare(toDateStr(b.startDate)));
  const lastEnd = sorted.reduce((m, s) => (toDateStr(s.endDate) > m ? toDateStr(s.endDate) : m), '');
  if (lastEnd < today) return { kind: 'graduated', lastEnd };
  const current = sorted.find((s) => toDateStr(s.startDate) <= today && today <= toDateStr(s.endDate));
  if (current) return { kind: 'studying', semester: current, lastEnd };
  return { kind: 'between', next: sorted.find((s) => toDateStr(s.startDate) > today) ?? null, lastEnd };
}

/** Короткий устойчивый хэш набора идентификаторов: новое событие при изменении состава */
export function idsHash(ids: string[]): string {
  return createHash('sha1')
    .update([...ids].sort().join(','))
    .digest('hex')
    .slice(0, 10);
}

/** Скрыто ли событие: навсегда (until = null) или до даты включительно */
export function isDismissed(until: DateStr | null | undefined, exists: boolean, today: DateStr): boolean {
  if (!exists) return false;
  return until == null || until >= today;
}

/** Следующая дата ежегодного напоминания не раньше `from` */
export function nextYearly(date: DateStr, from: DateStr): DateStr {
  const [, m, d] = date.split('-');
  const fromYear = Number(from.slice(0, 4));
  for (let y = fromYear; y <= fromYear + 1; y++) {
    const candidate = safeDate(y, Number(m), Number(d));
    if (candidate >= from) return candidate;
  }
  return safeDate(fromYear + 1, Number(m), Number(d));
}

function safeDate(y: number, m: number, d: number): DateStr {
  // 29 февраля в невисокосный год — 28 февраля
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Конец учебного года (30 июня), ближайший к дате: с сентября — следующего календарного года */
export function academicYearEnd(today: DateStr): DateStr {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return `${m >= 9 ? y + 1 : y}-06-30`;
}

/** Начало учебного года (1 сентября), ближайшее не раньше сегодняшнего дня */
export function academicYearStart(today: DateStr): DateStr {
  const y = Number(today.slice(0, 4));
  const candidate = `${y}-09-01`;
  return candidate >= today ? candidate : `${y + 1}-09-01`;
}

/** Порядок событий: сначала требующие действий и текущие, затем по дате */
export function sortEvents(events: TimelineEvent[], today: DateStr): TimelineEvent[] {
  const eff = (e: TimelineEvent) => (e.date < today ? today : e.date);
  return [...events].sort(
    (a, b) => eff(a).localeCompare(eff(b)) || rank(a) - rank(b) || a.title.localeCompare(b.title, 'ru'),
  );
}

const SEVERITY_RANK: Record<EventSeverity, number> = { danger: 0, warning: 1, info: 2, success: 3 };
function rank(e: TimelineEvent) {
  return (e.needsAction ? 0 : 10) + SEVERITY_RANK[e.severity];
}
