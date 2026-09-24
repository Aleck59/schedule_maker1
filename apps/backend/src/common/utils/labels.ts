/** Русские названия значений перечислений — для сообщений, отчётов и экспорта */

export const LESSON_TYPE_LABELS: Record<string, string> = {
  LECTURE: 'Лекция',
  PRACTICAL: 'Практическое занятие',
  LABORATORY: 'Лабораторное занятие',
  CONSULTATION: 'Консультация',
  PRACTICE: 'Практика',
  OTHER: 'Другое',
};

export const LESSON_TYPE_SHORT: Record<string, string> = {
  LECTURE: 'лек.',
  PRACTICAL: 'пр.',
  LABORATORY: 'лаб.',
  CONSULTATION: 'конс.',
  PRACTICE: 'практ.',
  OTHER: 'др.',
};

export const LESSON_STATUS_LABELS: Record<string, string> = {
  PLANNED: 'Запланировано',
  CONDUCTED: 'Проведено',
  CANCELLED: 'Отменено',
  MOVED: 'Перенесено',
  REPLACED: 'Замена',
};

export const CONDUCTED_STATUS_LABELS: Record<string, string> = {
  CONDUCTED: 'Проведено',
  CANCELLED: 'Отменено',
  POSTPONED: 'Перенесено',
  REPLACED: 'Заменено другим занятием',
};

export const CANCELLATION_REASON_LABELS: Record<string, string> = {
  GROUP_ABSENT: 'Отсутствие группы',
  TEACHER_ABSENT: 'Отсутствие преподавателя',
  CLASSROOM_UNAVAILABLE: 'Аудитория недоступна',
  HOLIDAY: 'Нерабочий день',
  OTHER: 'Иная причина',
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

/** Условные обозначения календарного учебного графика */
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

export const CONTROL_FORM_LABELS: Record<string, string> = {
  NONE: '—',
  EXAM: 'Экзамен',
  CREDIT: 'Зачёт',
  DIFFERENTIATED_CREDIT: 'Дифференцированный зачёт',
  OTHER: 'Другая форма контроля',
  COURSE_PROJECT: 'Курсовой проект',
  QUALIFICATION_EXAM: 'Экзамен по модулю',
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

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Администратор',
  DISPATCHER: 'Диспетчер расписания',
  TEACHER: 'Преподаватель',
  STUDENT: 'Студент',
  MANAGER: 'Руководитель',
};

export const PERIOD_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Черновик',
  GENERATED: 'Сгенерировано',
  PUBLISHED: 'Опубликовано',
  ARCHIVED: 'Архив',
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

export function label(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return '';
  return map[key] ?? key;
}
