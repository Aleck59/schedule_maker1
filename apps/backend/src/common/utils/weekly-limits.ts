import { StudyForm } from '@prisma/client';

export interface WeeklyLimitSettings {
  maxWeeklyLessonsFullTime: number | null;
  maxWeeklyLessonsPartTime: number | null;
  maxWeeklyLessonsExtramural: number | null;
  reduceFullTimeOnExtramural: boolean;
  fullTimeWeeklyOnExtramural: number | null;
}

/** Максимум пар группы в неделю по форме обучения (настройки организации); null — без ограничения */
export function weeklyLessonLimit(settings: WeeklyLimitSettings, form: StudyForm): number | null {
  switch (form) {
    case StudyForm.FULL_TIME:
      return settings.maxWeeklyLessonsFullTime ?? null;
    case StudyForm.PART_TIME:
      return settings.maxWeeklyLessonsPartTime ?? null;
    case StudyForm.EXTRAMURAL:
      return settings.maxWeeklyLessonsExtramural ?? null;
    default:
      return null;
  }
}

/**
 * Лимит очной группы в неделю, когда у заочников занятия. null — снижение выключено
 * (или не задано). Не превышает обычный лимит очной формы.
 */
export function fullTimeLimitOnExtramural(settings: WeeklyLimitSettings): number | null {
  if (!settings.reduceFullTimeOnExtramural || settings.fullTimeWeeklyOnExtramural == null) return null;
  const base = settings.maxWeeklyLessonsFullTime;
  return base == null
    ? settings.fullTimeWeeklyOnExtramural
    : Math.min(base, settings.fullTimeWeeklyOnExtramural);
}
