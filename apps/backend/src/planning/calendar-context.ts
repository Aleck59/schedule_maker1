import { CalendarEvent, CalendarEventType, CurriculumItemType } from '@prisma/client';
import { isoWeekday, toDateStr } from '../common/utils/dates';
import { DateBlock, GroupDayInfo } from './planning.types';

export interface ContextGroup {
  id: string;
  code: string;
  programId: string;
  courseNumber: number;
  /** Учебные годы программы (для определения курса группы на дату) */
  academicYears: Array<{ start: string; end: string; courseNumber: number | null }>;
}

export interface NormalizedEvent {
  id: string;
  eventType: CalendarEventType;
  title: string;
  start: string;
  end: string;
  blocksSchedule: boolean;
  programId: string | null;
  groupId: string | null;
  courseNumber: number | null;
  teacherId: string | null;
}

export const PRACTICE_EVENT_TYPES: CalendarEventType[] = [
  CalendarEventType.EDUCATIONAL_PRACTICE,
  CalendarEventType.INDUSTRIAL_PRACTICE,
  CalendarEventType.PRE_DIPLOMA_PRACTICE,
];

/** Тип события календаря, в котором проводятся занятия практики данного элемента плана */
export function practiceEventTypeFor(itemType: CurriculumItemType): CalendarEventType | null {
  switch (itemType) {
    case CurriculumItemType.EDUCATIONAL_PRACTICE:
      return CalendarEventType.EDUCATIONAL_PRACTICE;
    case CurriculumItemType.INDUSTRIAL_PRACTICE:
      return CalendarEventType.INDUSTRIAL_PRACTICE;
    case CurriculumItemType.PRE_DIPLOMA_PRACTICE:
      return CalendarEventType.PRE_DIPLOMA_PRACTICE;
    default:
      return null;
  }
}

/** Блокирует ли тип события обычные занятия по умолчанию */
export function defaultBlocksSchedule(type: CalendarEventType): boolean {
  return type !== CalendarEventType.THEORETICAL_TRAINING;
}

export function normalizeEvent(e: CalendarEvent): NormalizedEvent {
  return {
    id: e.id,
    eventType: e.eventType,
    title: e.title,
    start: toDateStr(e.startDate),
    end: toDateStr(e.endDate),
    blocksSchedule: e.blocksSchedule,
    programId: e.educationalProgramId,
    groupId: e.studentGroupId,
    courseNumber: e.courseNumber,
    teacherId: e.teacherId,
  };
}

/**
 * Календарный контекст: какие даты доступны группам и преподавателям с учётом
 * каникул, праздников, практик, сессий, ГИА и других периодов календарного графика.
 */
export class CalendarContext {
  private readonly dayCache = new Map<string, GroupDayInfo>();

  constructor(
    readonly events: NormalizedEvent[],
    readonly workingDays: number[],
    readonly groups: Map<string, ContextGroup>,
  ) {}

  /** Курс группы на дату (по учебным годам программы) */
  courseAt(group: ContextGroup, date: string): number {
    const year = group.academicYears.find((y) => date >= y.start && date <= y.end);
    return year?.courseNumber ?? group.courseNumber;
  }

  appliesToGroup(e: NormalizedEvent, group: ContextGroup, date: string): boolean {
    if (e.teacherId) return false;
    if (e.groupId && e.groupId !== group.id) return false;
    if (e.programId && e.programId !== group.programId) return false;
    if (e.courseNumber && e.courseNumber !== this.courseAt(group, date)) return false;
    return true;
  }

  groupDay(groupId: string, date: string): GroupDayInfo {
    const cacheKey = `${groupId}#${date}`;
    const cached = this.dayCache.get(cacheKey);
    if (cached) return cached;
    const group = this.groups.get(groupId);
    const weekday = isoWeekday(date);
    const isWorkingDay = this.workingDays.includes(weekday);
    const blocks: DateBlock[] = [];
    const practiceTypes: string[] = [];
    if (group) {
      for (const e of this.events) {
        if (date < e.start || date > e.end) continue;
        if (!this.appliesToGroup(e, group, date)) continue;
        if (PRACTICE_EVENT_TYPES.includes(e.eventType)) {
          practiceTypes.push(e.eventType);
        }
        if (e.blocksSchedule) {
          blocks.push({ eventId: e.id, eventType: e.eventType, title: e.title });
        }
      }
    }
    const info: GroupDayInfo = {
      date,
      weekday,
      isWorkingDay,
      regularAllowed: isWorkingDay && blocks.length === 0,
      practiceTypes,
      blocks,
    };
    this.dayCache.set(cacheKey, info);
    return info;
  }

  isRegularAllowed(groupId: string, date: string): boolean {
    return this.groupDay(groupId, date).regularAllowed;
  }

  /** Можно ли в эту дату проводить занятия практики (в период практики группы) */
  isPracticeAllowed(groupId: string, date: string, itemType: CurriculumItemType): boolean {
    const eventType = practiceEventTypeFor(itemType);
    if (!eventType) return false;
    const day = this.groupDay(groupId, date);
    if (!day.isWorkingDay || !day.practiceTypes.includes(eventType)) return false;
    // Другие блокирующие события (праздник, каникулы) запрещают и практику
    return day.blocks.every((b) => PRACTICE_EVENT_TYPES.includes(b.eventType as CalendarEventType));
  }

  /** Блокировки преподавателя на дату (курсы, отпуск, праздники организации) */
  teacherBlocks(teacherId: string, date: string): DateBlock[] {
    const result: DateBlock[] = [];
    for (const e of this.events) {
      if (!e.blocksSchedule || date < e.start || date > e.end) continue;
      const orgWide = !e.teacherId && !e.groupId && !e.programId && !e.courseNumber;
      if (e.teacherId === teacherId || (orgWide && e.eventType === CalendarEventType.HOLIDAY)) {
        result.push({ eventId: e.id, eventType: e.eventType, title: e.title });
      }
    }
    return result;
  }
}
