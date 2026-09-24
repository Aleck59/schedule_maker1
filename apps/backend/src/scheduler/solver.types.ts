/**
 * Контракт задачи генерации расписания. Один и тот же JSON принимают
 * встроенный эвристический решатель (TypeScript) и сервис OR-Tools CP-SAT (Python).
 */

export type SolverMode = 'CALENDAR' | 'WEEKLY_TEMPLATE';

export interface SolverDay {
  date: string;
  /** 1 — понедельник ... 7 — воскресенье */
  weekday: number;
  /** Порядковый номер недели от начала интервала (с 0) */
  week: number;
}

export interface SolverGroup {
  id: string;
  code: string;
  size: number;
  subgroups: number[];
  /** Даты, в которые группе можно ставить обычные занятия */
  allowedDates: string[];
  /** Мягкий лимит пар в день */
  maxLessonsPerDay: number;
}

export interface SolverTeacher {
  id: string;
  name: string;
  maxDailyLessons: number;
  maxWeeklyLessons: number;
  preferredStartLesson: number;
  preferredEndLesson: number;
  /** [день недели, номер пары] — недоступные слоты */
  unavailable: Array<[number, number]>;
  /** [день недели, номер пары, вес] — предпочтения (< 0 нежелательно) */
  preferences: Array<[number, number, number]>;
  blockedDates: string[];
}

export interface SolverRoom {
  id: string;
  code: string;
  building: string | null;
  capacity: number;
  type: string;
  unavailable: Array<[number, number]>;
  /** Онлайн-аудитория: без ограничения одновременных занятий */
  unlimited: boolean;
}

export interface SolverDemand {
  id: string;
  /** Несколько групп — поток (лекция для объединённых групп) */
  groupIds: string[];
  subgroupNumber: number | null;
  semesterItemId: string;
  /** Ключи дисциплины (группа + дисциплина) для лимитов «в день / в неделю» */
  disciplineKeys: string[];
  title: string;
  lessonType: string;
  teacherId: string;
  lessonsRequired: number;
  /** Желаемый темп, пар в неделю (может быть дробным) */
  weeklyRate: number | null;
  priority: number;
  size: number;
  /** Подходящие аудитории в порядке предпочтения */
  roomIds: string[];
  preferredRoomId: string | null;
  /** Разрешённые даты (практика, консультации); null — даты группы */
  allowedDates: string[] | null;
  isDifficult: boolean;
}

export interface SolverOccupied {
  date: string;
  lessonNumber: number;
  groupId: string | null;
  subgroupNumber: number | null;
  teacherId: string | null;
  roomId: string | null;
  disciplineKey: string | null;
}

export interface SolverSettings {
  maxSameDisciplinePerDay: number;
  maxSameDisciplinePerWeek: number;
  lateLessonNumber: number;
  /** Запретить пары начиная с lateLessonNumber (жёстко) */
  forbidLateLessons: boolean;
  avoidWindows: boolean;
  respectTeacherPreferences: boolean;
}

export interface SolverProblem {
  version: 1;
  mode: SolverMode;
  timeLimitSeconds: number;
  lessonsPerDay: number;
  workingDays: number[];
  days: SolverDay[];
  groups: SolverGroup[];
  teachers: SolverTeacher[];
  rooms: SolverRoom[];
  demands: SolverDemand[];
  occupied: SolverOccupied[];
  settings: SolverSettings;
  weights: Record<string, number>;
  seed: number;
}

export interface SolverPlacement {
  demandId: string;
  date: string;
  lessonNumber: number;
  roomId: string | null;
}

export type SolverStatus = 'OPTIMAL' | 'FEASIBLE' | 'PARTIAL' | 'EMPTY' | 'ERROR';

export interface SolverResult {
  status: SolverStatus;
  solver: 'cp-sat' | 'heuristic';
  placements: SolverPlacement[];
  unplaced: Array<{ demandId: string; count: number }>;
  stats: {
    requiredLessons: number;
    placedLessons: number;
    durationMs: number;
    weeks: number;
    objective?: number | null;
  };
  log: string[];
}

/** Коды причин невозможности постановки */
export type UnplacedReason =
  | 'NO_TEACHER'
  | 'TEACHER_INACTIVE'
  | 'NO_SUITABLE_ROOM'
  | 'NO_AVAILABLE_DAYS'
  | 'NO_PRACTICE_PERIOD'
  | 'TEACHER_UNAVAILABLE'
  | 'TEACHER_BUSY'
  | 'TEACHER_LIMIT'
  | 'GROUP_BUSY'
  | 'ROOM_SHORTAGE'
  | 'DAILY_LIMITS'
  | 'NOT_ENOUGH_TIME';

export interface UnplacedItem {
  demandId: string;
  streamKeys: string[];
  groupCodes: string[];
  subgroupNumber: number | null;
  semesterItemId: string;
  disciplineName: string;
  itemCode: string;
  lessonType: string;
  teacherId: string | null;
  teacherName: string | null;
  lessonsRequired: number;
  lessonsUnplaced: number;
  hoursUnplaced: number;
  reasons: Array<{ code: UnplacedReason; message: string }>;
  suggestions: string[];
}
