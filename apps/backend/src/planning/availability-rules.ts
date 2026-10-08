import { AvailabilityRuleKind, WeekParity } from '@prisma/client';
import { isoWeekday, parseDate, toDateStr } from '../common/utils/dates';

/**
 * Гибкие правила доступности преподавателя: дни недели, номера пар или интервал
 * времени, чётность недели учебного года, порядковый номер дня недели в месяце
 * («первая неделя месяца», «последняя суббота месяца»), период действия и онлайн.
 */
export interface AvailabilityRuleLike {
  id: string;
  kind: AvailabilityRuleKind;
  weekdays: number[];
  lessonNumbers: number[];
  timeFrom: string | null;
  timeTo: string | null;
  parity: WeekParity;
  monthWeeks: number[];
  validFrom: Date | string | null;
  validTo: Date | string | null;
  weight: number;
  note: string | null;
}

export interface LessonTimeLike {
  lessonNumber: number;
  startTime: string;
  endTime: string;
}

export interface SlotVerdict {
  /** Занятие в слоте невозможно */
  blocked: boolean;
  /** Правило, запрещающее слот (для сообщений) */
  blockedBy: AvailabilityRuleLike | null;
  /** Занятие проводится онлайн */
  online: boolean;
  onlineBy: AvailabilityRuleLike | null;
  /** Сумма весов предпочтений (> 0 — желательно, < 0 — нежелательно) */
  weight: number;
}

const DAY_NAMES = ['', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
/** Род названия дня недели: для «1-й понедельник», «1-я среда», «1-е воскресенье» */
const DAY_GENDER: Array<'m' | 'f' | 'n'> = ['m', 'm', 'm', 'f', 'm', 'f', 'f', 'n'];
const ORDINAL_SUFFIX = { m: 'й', f: 'я', n: 'е' } as const;
const LAST = { m: 'последний', f: 'последняя', n: 'последнее' } as const;
const KIND_TEXT: Record<AvailabilityRuleKind, string> = {
  UNAVAILABLE: 'Не может вести занятия',
  AVAILABLE_ONLY: 'Ведёт занятия только',
  PREFERRED: 'Желательно',
  UNDESIRED: 'Нежелательно',
  ONLINE: 'Занятия онлайн',
};

function minutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Номер недели учебного года: неделя 1 содержит 1 сентября (недели с понедельника) */
export function academicWeekNumber(date: string): number {
  const d = parseDate(date);
  const year = d.getUTCMonth() >= 8 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  const sep1 = parseDate(`${year}-09-01`);
  const firstMonday = sep1.getTime() - (isoWeekday(sep1) - 1) * 86_400_000;
  return Math.floor((d.getTime() - firstMonday) / (7 * 86_400_000)) + 1;
}

/** Порядковый номер дня недели в месяце (1 — первый понедельник месяца) и признак «последний» */
export function weekdayOccurrence(date: string): { index: number; last: boolean } {
  const d = parseDate(date);
  const day = d.getUTCDate();
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return { index: Math.ceil(day / 7), last: day + 7 > daysInMonth };
}

export function ruleMatchesDate(rule: AvailabilityRuleLike, date: string): boolean {
  if (rule.validFrom && date < toDateStr(rule.validFrom)) return false;
  if (rule.validTo && date > toDateStr(rule.validTo)) return false;
  if (rule.weekdays.length && !rule.weekdays.includes(isoWeekday(date))) return false;
  if (rule.parity !== WeekParity.ANY) {
    const odd = academicWeekNumber(date) % 2 === 1;
    if ((rule.parity === WeekParity.ODD) !== odd) return false;
  }
  if (rule.monthWeeks.length) {
    const occ = weekdayOccurrence(date);
    if (!rule.monthWeeks.includes(occ.index) && !(occ.last && rule.monthWeeks.includes(-1))) return false;
  }
  return true;
}

/**
 * Попадает ли пара в правило. Для «только в указанное время» пара должна целиком
 * входить в интервал, для остальных видов достаточно пересечения.
 */
export function ruleMatchesLesson(
  rule: AvailabilityRuleLike,
  lessonNumber: number,
  times: Map<number, LessonTimeLike>,
): boolean {
  if (rule.lessonNumbers.length && !rule.lessonNumbers.includes(lessonNumber)) return false;
  if (rule.timeFrom || rule.timeTo) {
    const t = times.get(lessonNumber);
    if (!t) return false;
    const from = rule.timeFrom ? minutes(rule.timeFrom) : 0;
    const to = rule.timeTo ? minutes(rule.timeTo) : 24 * 60;
    const start = minutes(t.startTime);
    const end = minutes(t.endTime);
    if (rule.kind === AvailabilityRuleKind.AVAILABLE_ONLY) return start >= from && end <= to;
    return start < to && end > from;
  }
  return true;
}

/** Правила одного преподавателя с быстрой проверкой слотов */
export class TeacherRules {
  private readonly times: Map<number, LessonTimeLike>;

  constructor(
    readonly rules: AvailabilityRuleLike[],
    lessonTimes: LessonTimeLike[],
  ) {
    this.times = new Map(lessonTimes.map((t) => [t.lessonNumber, t]));
  }

  get isEmpty(): boolean {
    return this.rules.length === 0;
  }

  evaluate(date: string, lessonNumber: number): SlotVerdict {
    const verdict: SlotVerdict = {
      blocked: false,
      blockedBy: null,
      online: false,
      onlineBy: null,
      weight: 0,
    };
    let onlyRules = 0;
    let onlyMatched = false;
    for (const rule of this.rules) {
      if (rule.kind === AvailabilityRuleKind.AVAILABLE_ONLY) {
        // «Только» ограничивает все дни в период действия правила
        const inPeriod =
          (!rule.validFrom || date >= toDateStr(rule.validFrom)) &&
          (!rule.validTo || date <= toDateStr(rule.validTo));
        if (!inPeriod) continue;
        onlyRules++;
        if (ruleMatchesDate(rule, date) && ruleMatchesLesson(rule, lessonNumber, this.times))
          onlyMatched = true;
        continue;
      }
      if (!ruleMatchesDate(rule, date) || !ruleMatchesLesson(rule, lessonNumber, this.times)) continue;
      switch (rule.kind) {
        case AvailabilityRuleKind.UNAVAILABLE:
          verdict.blocked = true;
          verdict.blockedBy ??= rule;
          break;
        case AvailabilityRuleKind.ONLINE:
          verdict.online = true;
          verdict.onlineBy ??= rule;
          break;
        case AvailabilityRuleKind.PREFERRED:
          verdict.weight += rule.weight;
          break;
        case AvailabilityRuleKind.UNDESIRED:
          verdict.weight -= rule.weight;
          break;
      }
    }
    if (onlyRules > 0 && !onlyMatched && !verdict.blocked) {
      verdict.blocked = true;
      verdict.blockedBy = this.rules.find((r) => r.kind === AvailabilityRuleKind.AVAILABLE_ONLY) ?? null;
    }
    return verdict;
  }
}

function list(values: string[]): string {
  if (values.length <= 1) return values.join('');
  return `${values.slice(0, -1).join(', ')} и ${values.at(-1)}`;
}

/** Описание правила на русском: «Не может вести занятия: последняя суббота месяца, все пары» */
export function describeRule(rule: AvailabilityRuleLike, lessonTimes: LessonTimeLike[] = []): string {
  const parts: string[] = [];
  const days = [...rule.weekdays].sort((a, b) => a - b);
  const occ = [...rule.monthWeeks].sort((a, b) => (a === -1 ? 99 : a) - (b === -1 ? 99 : b));
  if (occ.length) {
    if (days.length) {
      const phrases = days.map((d) => {
        const g = DAY_GENDER[d];
        return `${list(occ.map((n) => (n === -1 ? LAST[g] : `${n}-${ORDINAL_SUFFIX[g]}`)))} ${DAY_NAMES[d]}`;
      });
      parts.push(`${phrases.join(', ')} месяца`);
    } else {
      parts.push(`${list(occ.map((n) => (n === -1 ? 'последняя' : `${n}-я`)))} неделя месяца`);
    }
  } else if (days.length) {
    parts.push(days.length === 7 ? 'все дни' : days.map((d) => DAY_NAMES[d]).join(', '));
  } else {
    parts.push('любой день');
  }
  if (rule.parity === WeekParity.ODD) parts.push('нечётные недели');
  if (rule.parity === WeekParity.EVEN) parts.push('чётные недели');
  if (rule.lessonNumbers.length) {
    const times = new Map(lessonTimes.map((t) => [t.lessonNumber, t]));
    parts.push(
      `${[...rule.lessonNumbers]
        .sort((a, b) => a - b)
        .map((n) => (times.get(n) ? `${n} (${times.get(n)!.startTime}–${times.get(n)!.endTime})` : String(n)))
        .join(', ')} пара`,
    );
  }
  if (rule.timeFrom || rule.timeTo) {
    parts.push(
      rule.timeFrom && rule.timeTo
        ? `с ${rule.timeFrom} до ${rule.timeTo}`
        : rule.timeFrom
          ? `с ${rule.timeFrom}`
          : `до ${rule.timeTo}`,
    );
  }
  if (!rule.lessonNumbers.length && !rule.timeFrom && !rule.timeTo) parts.push('все пары');
  if (rule.validFrom || rule.validTo) {
    const from = rule.validFrom ? toDateStr(rule.validFrom).split('-').reverse().join('.') : null;
    const to = rule.validTo ? toDateStr(rule.validTo).split('-').reverse().join('.') : null;
    parts.push(from && to ? `с ${from} по ${to}` : from ? `с ${from}` : `по ${to}`);
  }
  return `${KIND_TEXT[rule.kind]}: ${parts.join(', ')}${rule.note ? ` (${rule.note})` : ''}`;
}
