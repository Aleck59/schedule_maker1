import type { ControlForm, StudyForm } from '@/lib/types';

export type ScanStatus = 'PROCESSING' | 'READY' | 'FAILED' | 'APPLIED';

export type ScanItemKind =
  | 'DISCIPLINE'
  | 'GROUP'
  | 'MODULE'
  | 'MODULE_EXAM'
  | 'INTERDISCIPLINARY_COURSE'
  | 'EDUCATIONAL_PRACTICE'
  | 'INDUSTRIAL_PRACTICE'
  | 'PRE_DIPLOMA_PRACTICE'
  | 'FINAL_ATTESTATION'
  | 'ELECTIVE';

/** Отметка распознавания ячейки: исправлена по сумме часов или требует проверки */
export interface CellFlag {
  status: 'corrected' | 'uncertain';
  read: string;
  crop: string;
}

export const HOUR_FIELDS = [
  'total',
  'lecture',
  'laboratory',
  'practical',
  'seminar',
  'individualProject',
  'selfStudy',
  'assessment',
] as const;
export type HourField = (typeof HOUR_FIELDS)[number];

export type DraftHours = Partial<Record<HourField | 'contact', number>> & { total: number };

export interface DraftItemSemester {
  number: number;
  controlForm: ControlForm;
  hours: DraftHours;
  practiceAtCollege?: boolean;
  cells?: Record<string, CellFlag>;
}

export interface DraftItem {
  code: string;
  name: string;
  kind: ScanItemKind;
  cycleCode: string;
  parentCode: string | null;
  include: boolean;
  isDifficult?: boolean;
  issues?: string[];
  semesters: DraftItemSemester[];
}

export interface DraftSemester {
  number: number;
  course: number;
  startDate: string;
  endDate: string;
  theoryWeeks: number;
  examWeeks: number;
  vacationWeeks: number;
  practiceWeeks: number;
}

export interface DraftPeriod {
  course: number;
  type: string;
  startDate: string;
  endDate: string;
}

export interface Draft {
  specialty: { code: string; name: string; qualification: string; fgosNumber?: string; fgosDate?: string };
  program: { title: string; admissionYear: number; studyForm: StudyForm; durationMonths: number };
  semesters: DraftSemester[];
  periods: DraftPeriod[];
  cycles: Array<{ code: string; name: string }>;
  items: DraftItem[];
  group: { code: string; studentCount: number; subgroupCount: number } | null;
}

export interface CalendarWeek {
  number: number;
  monday: string;
  days: string[];
}

export interface RecognizedCalendar {
  course: number;
  startYear: number;
  weeks: CalendarWeek[];
  uncertain: Array<{ weeks: number[]; days: number[]; crop: string }>;
}

export interface ScanResult {
  title: Record<string, unknown>;
  calendar: RecognizedCalendar[];
  warnings: string[];
  stats: { pages: number; items: number; corrected: number; uncertain: number; durationMs: number };
  pages: Array<{ index: number; kind: string; cells?: number }>;
}

export interface CurriculumScan {
  id: string;
  fileNames: string[];
  status: ScanStatus;
  progress: number;
  message: string | null;
  error: string | null;
  programId: string | null;
  createdAt: string;
  updatedAt: string;
  resultJson?: ScanResult | null;
  draft?: Draft | null;
}

export interface ScanEngineStatus {
  available: boolean;
  tesseract: string | null;
  error: string | null;
  formats: string[];
}

export interface ApplyResult {
  programId: string;
  groupId: string | null;
  created: { semesters: number; cycles: number; items: number; semesterItems: number; calendarEvents: number };
}

export const KIND_LABELS: Record<ScanItemKind, string> = {
  DISCIPLINE: 'Дисциплина',
  GROUP: 'Раздел (цикл)',
  MODULE: 'Проф. модуль',
  MODULE_EXAM: 'Экзамен по модулю',
  INTERDISCIPLINARY_COURSE: 'МДК',
  EDUCATIONAL_PRACTICE: 'Учебная практика',
  INDUSTRIAL_PRACTICE: 'Произв. практика',
  PRE_DIPLOMA_PRACTICE: 'Преддипл. практика',
  FINAL_ATTESTATION: 'ГИА',
  ELECTIVE: 'Факультатив',
};

export const PRACTICE_KINDS: ScanItemKind[] = ['EDUCATIONAL_PRACTICE', 'INDUSTRIAL_PRACTICE', 'PRE_DIPLOMA_PRACTICE'];
