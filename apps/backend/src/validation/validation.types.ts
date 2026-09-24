import { Severity } from '@prisma/client';

export interface ValidationIssue {
  severity: Severity;
  validationType: string;
  entityType: string;
  entityId: string | null;
  message: string;
  details?: Record<string, unknown>;
}

/** Типы проверок и их русские названия */
export const VALIDATION_TYPE_LABELS: Record<string, string> = {
  TEACHER_CONFLICT: 'Преподаватель на двух занятиях одновременно',
  GROUP_CONFLICT: 'Группа на двух занятиях одновременно',
  CLASSROOM_CONFLICT: 'Аудитория занята дважды',
  CAPACITY_EXCEEDED: 'Вместимость аудитории меньше размера группы',
  CLASSROOM_UNAVAILABLE: 'Недоступная аудитория',
  TEACHER_UNAVAILABLE: 'Недоступное время преподавателя',
  LESSON_IN_VACATION: 'Занятие в каникулы',
  LESSON_IN_PRACTICE: 'Занятие во время практики',
  LESSON_ON_HOLIDAY: 'Занятие в праздничный день',
  LESSON_IN_BLOCKED_PERIOD: 'Занятие в заблокированный период',
  LESSON_OUTSIDE_SEMESTER: 'Занятие вне дат семестра',
  LESSON_OUTSIDE_PERIOD: 'Занятие вне периода расписания',
  PRACTICE_OUTSIDE_PERIOD: 'Практика вне периода практики',
  NO_TEACHER: 'Занятие без преподавателя',
  NO_CLASSROOM: 'Занятие без аудитории',
  WRONG_CLASSROOM_TYPE: 'Неподходящий тип аудитории',
  HOURS_EXCEEDED: 'Превышение плановых часов',
  HOURS_EXCESS_APPROVED: 'Превышение часов (разрешено)',
  HOURS_DEFICIT: 'Дефицит часов',
  GROUP_DAILY_LIMIT: 'Превышение лимита пар группы в день',
  TEACHER_OVERLOAD: 'Перегрузка преподавателя',
  GROUP_WINDOWS: 'Окна у группы',
  TEACHER_WINDOWS: 'Окна у преподавателя',
  UNEVEN_DISTRIBUTION: 'Неравномерное распределение дисциплины',
  NOT_ENOUGH_WEEKS: 'Мало учебных недель для закрытия часов',
  TOO_MANY_EXAMS: 'Много экзаменов в одну неделю',
  LATE_LESSONS: 'Поздние пары',
  BUILDING_CHANGES: 'Частая смена корпуса',
  PARTIAL_LESSON: 'Неполная пара',
  LESSON_ON_DAY_OFF: 'Занятие в выходной день',
  LESSON_NUMBER_EXCEEDS: 'Пара вне расписания звонков',
  UNASSIGNED_TEACHER: 'Не назначен преподаватель',
};

/** Ошибки, блокирующие публикацию расписания */
export const BLOCKING_TYPES = new Set([
  'TEACHER_CONFLICT',
  'GROUP_CONFLICT',
  'CLASSROOM_CONFLICT',
  'CAPACITY_EXCEEDED',
  'CLASSROOM_UNAVAILABLE',
  'TEACHER_UNAVAILABLE',
  'LESSON_IN_VACATION',
  'LESSON_IN_PRACTICE',
  'LESSON_ON_HOLIDAY',
  'LESSON_IN_BLOCKED_PERIOD',
  'LESSON_OUTSIDE_SEMESTER',
  'LESSON_OUTSIDE_PERIOD',
  'NO_TEACHER',
  'NO_CLASSROOM',
  'WRONG_CLASSROOM_TYPE',
  'HOURS_EXCEEDED',
]);

export interface ValidationSummary {
  errors: number;
  warnings: number;
  infos: number;
  canPublish: boolean;
  byType: Record<string, number>;
  items: ValidationIssue[];
}
