import { LessonType } from '@prisma/client';

/** Виды занятий, которые могут автоматически ставиться в расписание */
export const SCHEDULABLE_LESSON_TYPES: LessonType[] = [
  LessonType.LECTURE,
  LessonType.PRACTICAL,
  LessonType.LABORATORY,
  LessonType.CONSULTATION,
  LessonType.PRACTICE,
];

export interface LessonSplit {
  /** Всего пар (включая неполную) */
  lessons: number;
  /** Полных пар */
  fullLessons: number;
  /** Часов в неполной паре (0 — неполной пары нет) */
  partialHours: number;
}

/**
 * Перевод академических часов в пары.
 * 36 ч при 2 ч/пара → 18 пар; 35 ч → 17 полных пар + 1 неполная (1 ч).
 * Часы не теряются: неполная пара ставится отдельным занятием на 1 академический час.
 */
export function hoursToLessons(hours: number, academicHoursPerLesson = 2): LessonSplit {
  const h = Math.max(0, Math.floor(hours || 0));
  const per = Math.max(1, Math.floor(academicHoursPerLesson || 2));
  const fullLessons = Math.floor(h / per);
  const partialHours = h % per;
  return { lessons: fullLessons + (partialHours > 0 ? 1 : 0), fullLessons, partialHours };
}

/** Кол-во пар (с округлением вверх) — для полей planned*Lessons */
export function plannedLessons(hours: number, academicHoursPerLesson = 2): number {
  return hoursToLessons(hours, academicHoursPerLesson).lessons;
}

export interface SemesterHoursLike {
  lectureHours: number;
  practicalHours: number;
  laboratoryHours: number;
  consultationHours: number;
  practiceHours: number;
  scheduleConsultations?: boolean;
  practiceAtCollege?: boolean;
}

/** Часы по виду занятия из строки учебного плана */
export function hoursForType(item: SemesterHoursLike, type: LessonType): number {
  switch (type) {
    case LessonType.LECTURE:
      return item.lectureHours;
    case LessonType.PRACTICAL:
      return item.practicalHours;
    case LessonType.LABORATORY:
      return item.laboratoryHours;
    case LessonType.CONSULTATION:
      return item.consultationHours;
    case LessonType.PRACTICE:
      return item.practiceHours;
    default:
      return 0;
  }
}

/** Пересчёт плановых пар для строки учебного плана семестра */
export function computePlannedLessons(item: SemesterHoursLike, academicHoursPerLesson = 2) {
  return {
    plannedLectureLessons: plannedLessons(item.lectureHours, academicHoursPerLesson),
    plannedPracticalLessons: plannedLessons(item.practicalHours, academicHoursPerLesson),
    plannedLaboratoryLessons: plannedLessons(item.laboratoryHours, academicHoursPerLesson),
    plannedConsultationLessons: plannedLessons(item.consultationHours, academicHoursPerLesson),
    plannedPracticeLessons: plannedLessons(item.practiceHours, academicHoursPerLesson),
  };
}

/**
 * Часы, которые НЕ ставятся в обычное расписание: самостоятельная работа
 * и промежуточная аттестация.
 */
export function nonScheduledHours(item: { selfStudyHours: number; assessmentHours: number }): number {
  return (item.selfStudyHours || 0) + (item.assessmentHours || 0);
}

/** Сумма аудиторных часов, которые должны попасть в расписание */
export function scheduledPlanHours(item: SemesterHoursLike, includeConsultations = true): number {
  return (
    item.lectureHours +
    item.practicalHours +
    item.laboratoryHours +
    (includeConsultations && item.scheduleConsultations !== false ? item.consultationHours : 0) +
    (item.practiceAtCollege ? item.practiceHours : 0)
  );
}
