import { ConductedStatus, LessonStatus, LessonType } from '@prisma/client';
import { DemandStream } from './planning.types';
import { streamKeyOf } from './planning.service';

/** Минимальные сведения о занятии для расчёта часов */
export interface LessonForHours {
  id: string;
  studentGroupId: string;
  semesterCurriculumItemId: string;
  lessonType: LessonType;
  subgroupNumber: number | null;
  status: LessonStatus;
  academicHours: number;
  date: string;
  teacherId: string | null;
  allowHoursExcess: boolean;
  conducted: { status: ConductedStatus; actualHours: number; actualTeacherId: string | null } | null;
}

export type HourStatus = 'NORMAL' | 'RISK' | 'DEFICIT' | 'EXCESS';

export interface StreamHours {
  planned: number;
  /** В расписании: запланированные + проведённые + с заменой преподавателя */
  scheduled: number;
  /** Фактически проведено (ConductedLesson со статусом CONDUCTED) */
  conducted: number;
  /** Остаток к проведению = план − проведено */
  remaining: number;
  /** Дефицит расписания = план − в расписании */
  scheduleDeficit: number;
  /** Превышение = в расписании − план */
  excess: number;
  /** Будущие запланированные часы (с сегодняшнего дня) */
  future: number;
  /** Прошедшие занятия без отметки о проведении */
  unmarkedPast: number;
  cancelled: number;
  /** Прогноз выполнения к концу семестра */
  forecast: number;
  forecastDeficit: number;
  lessons: number;
  conductedLessons: number;
  cancelledLessons: number;
  excessApproved: boolean;
}

export const ACTIVE_STATUSES: LessonStatus[] = [
  LessonStatus.PLANNED,
  LessonStatus.CONDUCTED,
  LessonStatus.REPLACED,
];

export function emptyStreamHours(planned = 0): StreamHours {
  return {
    planned,
    scheduled: 0,
    conducted: 0,
    remaining: planned,
    scheduleDeficit: planned,
    excess: 0,
    future: 0,
    unmarkedPast: 0,
    cancelled: 0,
    forecast: 0,
    forecastDeficit: planned,
    lessons: 0,
    conductedLessons: 0,
    cancelledLessons: 0,
    excessApproved: false,
  };
}

/**
 * Распределение занятий по потокам спроса. Занятие всей группы засчитывается
 * каждой подгруппе, если дисциплина по этому виду занятий делится на подгруппы.
 */
export function matchLessonsToStreams(streams: DemandStream[], lessons: LessonForHours[]) {
  const byKey = new Map(streams.map((s) => [s.key, s]));
  const subgroupStreams = new Map<string, DemandStream[]>();
  for (const s of streams) {
    if (s.subgroupNumber !== null) {
      const base = streamKeyOf(s.groupId, s.semesterItemId, s.lessonType, null);
      const list = subgroupStreams.get(base) ?? [];
      list.push(s);
      subgroupStreams.set(base, list);
    }
  }
  const matched = new Map<string, LessonForHours[]>();
  const unmatched: LessonForHours[] = [];
  const push = (key: string, l: LessonForHours) => {
    const list = matched.get(key) ?? [];
    list.push(l);
    matched.set(key, list);
  };
  for (const l of lessons) {
    const exact = streamKeyOf(l.studentGroupId, l.semesterCurriculumItemId, l.lessonType, l.subgroupNumber);
    if (byKey.has(exact)) {
      push(exact, l);
      continue;
    }
    if (l.subgroupNumber !== null) {
      const whole = streamKeyOf(l.studentGroupId, l.semesterCurriculumItemId, l.lessonType, null);
      if (byKey.has(whole)) {
        push(whole, l);
        continue;
      }
    } else {
      const subs = subgroupStreams.get(exact);
      if (subs && subs.length > 0) {
        for (const s of subs) push(s.key, l);
        continue;
      }
    }
    unmatched.push(l);
  }
  return { matched, unmatched };
}

export function computeStreamHours(
  stream: DemandStream,
  lessons: LessonForHours[],
  today: string,
): StreamHours {
  const h = emptyStreamHours(stream.plannedHours);
  h.excessApproved = stream.allowHoursExcess;
  for (const l of lessons) {
    const active = ACTIVE_STATUSES.includes(l.status);
    if (active) {
      h.scheduled += l.academicHours;
      h.lessons++;
      if (l.allowHoursExcess) h.excessApproved = true;
    }
    if (l.conducted?.status === ConductedStatus.CONDUCTED) {
      h.conducted += l.conducted.actualHours;
      h.conductedLessons++;
    } else if (active && l.status !== LessonStatus.CONDUCTED) {
      if (l.date >= today) h.future += l.academicHours;
      else h.unmarkedPast += l.academicHours;
    }
    if (l.status === LessonStatus.CANCELLED) {
      h.cancelled += l.academicHours;
      h.cancelledLessons++;
    }
  }
  h.remaining = Math.max(0, h.planned - h.conducted);
  h.scheduleDeficit = Math.max(0, h.planned - h.scheduled);
  h.excess = Math.max(0, h.scheduled - h.planned);
  h.forecast = h.conducted + h.future + h.unmarkedPast;
  h.forecastDeficit = Math.max(0, h.planned - h.forecast);
  return h;
}

export function sumHours(items: StreamHours[]): StreamHours {
  const acc = emptyStreamHours(0);
  acc.remaining = 0;
  acc.scheduleDeficit = 0;
  acc.forecastDeficit = 0;
  for (const h of items) {
    acc.planned += h.planned;
    acc.scheduled += h.scheduled;
    acc.conducted += h.conducted;
    acc.remaining += h.remaining;
    acc.scheduleDeficit += h.scheduleDeficit;
    acc.excess += h.excess;
    acc.future += h.future;
    acc.unmarkedPast += h.unmarkedPast;
    acc.cancelled += h.cancelled;
    acc.forecast += h.forecast;
    acc.forecastDeficit += h.forecastDeficit;
    acc.lessons += h.lessons;
    acc.conductedLessons += h.conductedLessons;
    acc.cancelledLessons += h.cancelledLessons;
    acc.excessApproved = acc.excessApproved || h.excessApproved;
  }
  return acc;
}

/**
 * Статус выполнения часов:
 *  EXCESS  — в расписании больше часов, чем по плану;
 *  DEFICIT — в расписании (или по прогнозу) не хватает часов до плана;
 *  RISK    — часы расставлены, но есть неотмеченные прошедшие занятия
 *            или фактическое выполнение заметно отстаёт от графика;
 *  NORMAL  — норма.
 */
export function hourStatus(
  h: StreamHours,
  semester: { start: string; end: string },
  today: string,
): { status: HourStatus; expectedByNow: number; completionPercent: number } {
  const completionPercent = h.planned > 0 ? Math.round((h.conducted / h.planned) * 1000) / 10 : 0;
  let expectedByNow = 0;
  if (today >= semester.end) expectedByNow = h.planned;
  else if (today > semester.start) {
    const total = dayNumber(semester.end) - dayNumber(semester.start) + 1;
    const elapsed = dayNumber(today) - dayNumber(semester.start);
    expectedByNow = Math.round((h.planned * elapsed) / total);
  }
  let status: HourStatus = 'NORMAL';
  if (h.excess > 0) status = 'EXCESS';
  else if (h.scheduleDeficit > 0 || h.forecastDeficit > 0) status = 'DEFICIT';
  else if (h.unmarkedPast >= 4 || (h.planned >= 8 && h.conducted + h.unmarkedPast < expectedByNow * 0.8))
    status = 'RISK';
  return { status, expectedByNow, completionPercent };
}

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86400000);
}
