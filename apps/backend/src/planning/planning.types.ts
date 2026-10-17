import { ClassroomType, ControlForm, CurriculumItemType, LessonType } from '@prisma/client';

/**
 * Поток спроса — минимальная единица планирования:
 * группа (или подгруппа) × дисциплина семестра × вид занятия × преподаватель.
 * Для каждого потока известно, сколько часов/пар нужно поставить в расписание.
 */
export interface DemandStream {
  key: string;
  groupId: string;
  groupCode: string;
  programId: string;
  subgroupNumber: number | null;
  /** Численность группы или подгруппы */
  size: number;
  semesterId: string;
  semesterNumber: number;
  semesterStart: string;
  semesterEnd: string;
  semesterItemId: string;
  curriculumItemId: string;
  itemCode: string;
  itemName: string;
  itemType: CurriculumItemType;
  isDifficult: boolean;
  controlForm: ControlForm;
  lessonType: LessonType;
  assignmentId: string | null;
  teacherId: string | null;
  teacherName: string | null;
  plannedHours: number;
  /** Всего пар, включая неполную */
  plannedLessons: number;
  /** Часов в неполной паре (0 — нет неполной пары) */
  partialHours: number;
  weeklyTarget: number | null;
  priority: number;
  roomTypes: ClassroomType[];
  preferredClassroomId: string | null;
  streamKey: string | null;
  allowHoursExcess: boolean;
}

export interface StreamFilter {
  organizationId: string;
  semesterIds?: string[];
  groupIds?: string[];
  programId?: string;
  teacherId?: string;
  semesterItemId?: string;
  /** Включать неактивные группы */
  includeInactiveGroups?: boolean;
}

/** Причина блокировки даты для группы */
export interface DateBlock {
  eventId: string;
  eventType: string;
  title: string;
}

export interface GroupDayInfo {
  date: string;
  weekday: number;
  isWorkingDay: boolean;
  /** Можно ставить обычные занятия */
  regularAllowed: boolean;
  /** Типы практик, идущих в этот день (для занятий PRACTICE) */
  practiceTypes: string[];
  blocks: DateBlock[];
}
