import { SolverMode, UnplacedItem } from './solver.types';

/** Параметры генерации, задаваемые в интерфейсе «Автосоставление расписания» */
export interface GenerationParams {
  mode: SolverMode;
  groupIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  lessonsPerDay?: number;
  /** Заменить ранее сгенерированные (не ручные, не закреплённые, не проведённые) занятия */
  replaceExisting?: boolean;
  timeLimitSeconds?: number;
  solver?: 'auto' | 'cp-sat' | 'heuristic';
  maxGroupLessonsPerDay?: number;
  maxSameDisciplinePerDay?: number;
  maxSameDisciplinePerWeek?: number;
  avoidWindows?: boolean;
  allowLateLessons?: boolean;
  respectTeacherPreferences?: boolean;
  weights?: Record<string, number>;
  seed?: number;
}

/** Сведения о потоке спроса, нужные для сохранения результата */
export interface DemandMetaStream {
  streamKey: string;
  groupId: string;
  groupCode: string;
  subgroupNumber: number | null;
  semesterItemId: string;
  assignmentId: string | null;
  lessonType: string;
  teacherId: string | null;
  lessonsRequired: number;
  partialHours: number;
  streamGroupKey: string | null;
}

export interface DemandMeta {
  demandId: string;
  title: string;
  itemCode: string;
  itemName: string;
  lessonType: string;
  teacherId: string | null;
  teacherName: string | null;
  subgroupNumber: number | null;
  groupCodes: string[];
  lessonsRequired: number;
  streams: DemandMetaStream[];
}

export interface PreviewLesson {
  demandId: string;
  date: string;
  weekday: number;
  lessonNumber: number;
  startTime: string;
  endTime: string;
  groupIds: string[];
  groupCodes: string[];
  /** Назначения нагрузки (в том же порядке, что и groupIds) */
  assignmentIds: Array<string | null>;
  /** Ключ потока, если занятие проводится для объединённых групп */
  streamKey: string | null;
  subgroupNumber: number | null;
  semesterItemId: string;
  itemCode: string;
  itemName: string;
  lessonType: string;
  teacherId: string | null;
  teacherName: string | null;
  roomId: string | null;
  roomCode: string | null;
  academicHours: number;
}

export interface GenerationResultJson {
  period: { id: string; title: string };
  range: { from: string; to: string };
  mode: SolverMode;
  solver: string;
  status: string;
  lessons: PreviewLesson[];
  unplaced: UnplacedItem[];
  replaceLessonIds: string[];
  stats: {
    requiredLessons: number;
    placedLessons: number;
    unplacedLessons: number;
    requiredHours: number;
    placedHours: number;
    groups: Array<{ groupId: string; groupCode: string; required: number; placed: number }>;
    durationMs: number;
    weeks: number;
    softViolations: Record<string, number>;
  };
  warnings: string[];
  log: string[];
}
