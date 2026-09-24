import type { BadgeProps } from './badge-props';

/** Русские названия значений перечислений */

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Администратор',
  DISPATCHER: 'Диспетчер расписания',
  TEACHER: 'Преподаватель',
  STUDENT: 'Студент',
  MANAGER: 'Руководитель',
};

export const LESSON_TYPE_LABELS: Record<string, string> = {
  LECTURE: 'Лекция',
  PRACTICAL: 'Практическое',
  LABORATORY: 'Лабораторное',
  CONSULTATION: 'Консультация',
  PRACTICE: 'Практика',
  OTHER: 'Другое',
};

export const LESSON_TYPE_SHORT: Record<string, string> = {
  LECTURE: 'лек',
  PRACTICAL: 'пр',
  LABORATORY: 'лаб',
  CONSULTATION: 'конс',
  PRACTICE: 'практ',
  OTHER: 'др',
};

export const LESSON_STATUS_LABELS: Record<string, string> = {
  PLANNED: 'Запланировано',
  CONDUCTED: 'Проведено',
  CANCELLED: 'Отменено',
  MOVED: 'Перенесено',
  REPLACED: 'Замена',
};

export const LESSON_STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  PLANNED: 'info',
  CONDUCTED: 'success',
  CANCELLED: 'destructive',
  MOVED: 'muted',
  REPLACED: 'warning',
};

export const CLASSROOM_TYPE_LABELS: Record<string, string> = {
  LECTURE: 'Лекционная',
  COMPUTER_LAB: 'Компьютерный класс',
  LABORATORY: 'Лаборатория',
  WORKSHOP: 'Мастерская',
  SPORTS_HALL: 'Спортивный зал',
  GENERAL: 'Учебный кабинет',
  ONLINE: 'Онлайн',
};

export const ITEM_TYPE_LABELS: Record<string, string> = {
  DISCIPLINE: 'Дисциплина',
  MODULE: 'Профессиональный модуль',
  INTERDISCIPLINARY_COURSE: 'МДК',
  EDUCATIONAL_PRACTICE: 'Учебная практика',
  INDUSTRIAL_PRACTICE: 'Производственная практика',
  PRE_DIPLOMA_PRACTICE: 'Преддипломная практика',
  FINAL_ATTESTATION: 'ГИА',
  ELECTIVE: 'Элективная дисциплина',
};

export const CONTROL_FORM_LABELS: Record<string, string> = {
  NONE: '—',
  EXAM: 'Экзамен',
  CREDIT: 'Зачёт',
  DIFFERENTIATED_CREDIT: 'Дифф. зачёт',
  OTHER: 'Другая форма контроля',
  COURSE_PROJECT: 'Курсовой проект',
  QUALIFICATION_EXAM: 'Экзамен по модулю',
};

export const CALENDAR_EVENT_LABELS: Record<string, string> = {
  THEORETICAL_TRAINING: 'Теоретическое обучение',
  EXAM_SESSION: 'Промежуточная аттестация',
  VACATION: 'Каникулы',
  EDUCATIONAL_PRACTICE: 'Учебная практика',
  INDUSTRIAL_PRACTICE: 'Производственная практика',
  PRE_DIPLOMA_PRACTICE: 'Преддипломная практика',
  FINAL_ATTESTATION: 'ГИА',
  DIPLOMA_PREPARATION: 'Подготовка ВКР',
  DIPLOMA_DEFENSE: 'Защита ВКР',
  DEMO_EXAM_PREPARATION: 'Подготовка к демоэкзамену',
  DEMO_EXAM: 'Демонстрационный экзамен',
  REATTESTATION: 'Повторная аттестация',
  HOLIDAY: 'Праздничный день',
  OTHER: 'Прочее',
};

export const CALENDAR_EVENT_CODES: Record<string, string> = {
  THEORETICAL_TRAINING: 'Т',
  EXAM_SESSION: 'Э',
  VACATION: 'К',
  EDUCATIONAL_PRACTICE: 'У',
  INDUSTRIAL_PRACTICE: 'П',
  PRE_DIPLOMA_PRACTICE: 'ПД',
  FINAL_ATTESTATION: 'Г',
  DIPLOMA_PREPARATION: 'Д',
  DIPLOMA_DEFENSE: 'З',
  DEMO_EXAM_PREPARATION: 'ДП',
  DEMO_EXAM: 'ДЭ',
  REATTESTATION: 'ПА',
  HOLIDAY: 'В',
  OTHER: '*',
};

/** Цвета типов недель календарного графика */
export const CALENDAR_EVENT_COLORS: Record<string, string> = {
  THEORETICAL_TRAINING: 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200',
  EXAM_SESSION: 'bg-rose-200 text-rose-900 dark:bg-rose-900/50 dark:text-rose-200',
  VACATION: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-200',
  EDUCATIONAL_PRACTICE: 'bg-amber-200 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100',
  INDUSTRIAL_PRACTICE: 'bg-orange-300 text-orange-950 dark:bg-orange-800/60 dark:text-orange-100',
  PRE_DIPLOMA_PRACTICE: 'bg-orange-400 text-orange-950',
  FINAL_ATTESTATION: 'bg-violet-300 text-violet-950 dark:bg-violet-800/60 dark:text-violet-100',
  DIPLOMA_PREPARATION: 'bg-violet-200 text-violet-900',
  DIPLOMA_DEFENSE: 'bg-fuchsia-300 text-fuchsia-950',
  DEMO_EXAM_PREPARATION: 'bg-indigo-200 text-indigo-900',
  DEMO_EXAM: 'bg-indigo-400 text-white',
  REATTESTATION: 'bg-red-300 text-red-950',
  HOLIDAY: 'bg-slate-300 text-slate-900',
  OTHER: 'bg-slate-200 text-slate-800',
};

export const PERIOD_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Черновик',
  GENERATED: 'Сгенерировано',
  PUBLISHED: 'Опубликовано',
  ARCHIVED: 'Архив',
};

export const PERIOD_STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  DRAFT: 'muted',
  GENERATED: 'info',
  PUBLISHED: 'success',
  ARCHIVED: 'secondary',
};

export const HOUR_STATUS_LABELS: Record<string, string> = {
  NORMAL: 'Норма',
  RISK: 'Риск',
  DEFICIT: 'Дефицит',
  EXCESS: 'Превышение',
};

export const HOUR_STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  NORMAL: 'success',
  RISK: 'warning',
  DEFICIT: 'destructive',
  EXCESS: 'violet',
};

export const JOB_STATUS_LABELS: Record<string, string> = {
  QUEUED: 'Ожидание',
  GENERATING: 'Генерация',
  VALIDATING: 'Проверка',
  COMPLETED: 'Готово',
  COMPLETED_WITH_CONFLICTS: 'Есть конфликты',
  FAILED: 'Ошибка',
  APPLIED: 'Применено',
  CANCELLED: 'Отменено',
};

export const CANCELLATION_REASON_LABELS: Record<string, string> = {
  GROUP_ABSENT: 'Отсутствие группы',
  TEACHER_ABSENT: 'Отсутствие преподавателя',
  CLASSROOM_UNAVAILABLE: 'Аудитория недоступна',
  HOLIDAY: 'Нерабочий день',
  OTHER: 'Иная причина',
};

export const SEVERITY_LABELS: Record<string, string> = { ERROR: 'Ошибка', WARNING: 'Предупреждение', INFO: 'Информация' };

export const WEEKDAYS = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
export const WEEKDAYS_SHORT = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export const STUDY_FORM_LABELS: Record<string, string> = {
  FULL_TIME: 'Очная',
  PART_TIME: 'Очно-заочная',
  EXTRAMURAL: 'Заочная',
};

export const PROGRAM_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Черновик',
  APPROVED: 'Утверждён',
  ARCHIVED: 'Архив',
};

export const SOFT_VIOLATION_LABELS: Record<string, string> = {
  groupWindows: 'Окна у групп',
  teacherWindows: 'Окна у преподавателей',
  lateLessons: 'Поздние пары',
  overloadedDays: 'Дни с перегрузкой группы',
  buildingChanges: 'Переходы между корпусами',
};

export function label(map: Record<string, string>, key: string | null | undefined, fallback = '—') {
  if (!key) return fallback;
  return map[key] ?? key;
}
