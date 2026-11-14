import { StudyForm } from '@prisma/client';

export interface WeeklyLimitSettings {
  maxWeeklyLessonsFullTime: number | null;
  maxWeeklyLessonsPartTime: number | null;
  maxWeeklyLessonsExtramural: number | null;
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
 * Очередь форм обучения при составлении (настройка «приоритет заочников»): в периоды, когда у
 * заочников занятия, пары ставятся сначала заочникам, затем очно-заочным, затем очным — по
 * оставшимся свободным слотам. 0 — первыми.
 */
export function formTierOf(form: StudyForm): number {
  switch (form) {
    case StudyForm.EXTRAMURAL:
      return 0;
    case StudyForm.PART_TIME:
      return 1;
    default:
      return 2;
  }
}
