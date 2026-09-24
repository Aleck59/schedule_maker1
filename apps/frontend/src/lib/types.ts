/** Типы данных API */

export type UserRole = 'ADMIN' | 'DISPATCHER' | 'TEACHER' | 'STUDENT' | 'MANAGER';
export type LessonType = 'LECTURE' | 'PRACTICAL' | 'LABORATORY' | 'CONSULTATION' | 'PRACTICE' | 'OTHER';
export type LessonStatus = 'PLANNED' | 'CONDUCTED' | 'CANCELLED' | 'MOVED' | 'REPLACED';
export type ClassroomType = 'LECTURE' | 'COMPUTER_LAB' | 'LABORATORY' | 'WORKSHOP' | 'SPORTS_HALL' | 'GENERAL' | 'ONLINE';
export type CurriculumItemType =
  | 'DISCIPLINE'
  | 'MODULE'
  | 'INTERDISCIPLINARY_COURSE'
  | 'EDUCATIONAL_PRACTICE'
  | 'INDUSTRIAL_PRACTICE'
  | 'PRE_DIPLOMA_PRACTICE'
  | 'FINAL_ATTESTATION'
  | 'ELECTIVE';
export type ControlForm = 'NONE' | 'EXAM' | 'CREDIT' | 'DIFFERENTIATED_CREDIT' | 'OTHER' | 'COURSE_PROJECT' | 'QUALIFICATION_EXAM';
export type CalendarEventType =
  | 'THEORETICAL_TRAINING'
  | 'EXAM_SESSION'
  | 'VACATION'
  | 'EDUCATIONAL_PRACTICE'
  | 'INDUSTRIAL_PRACTICE'
  | 'PRE_DIPLOMA_PRACTICE'
  | 'FINAL_ATTESTATION'
  | 'DIPLOMA_PREPARATION'
  | 'DIPLOMA_DEFENSE'
  | 'DEMO_EXAM_PREPARATION'
  | 'DEMO_EXAM'
  | 'REATTESTATION'
  | 'HOLIDAY'
  | 'OTHER';
export type PeriodStatus = 'DRAFT' | 'GENERATED' | 'PUBLISHED' | 'ARCHIVED';
export type HourStatus = 'NORMAL' | 'RISK' | 'DEFICIT' | 'EXCESS';
export type Severity = 'ERROR' | 'WARNING' | 'INFO';
export type JobStatus =
  | 'QUEUED'
  | 'GENERATING'
  | 'VALIDATING'
  | 'COMPLETED'
  | 'COMPLETED_WITH_CONFLICTS'
  | 'FAILED'
  | 'APPLIED'
  | 'CANCELLED';
export type CancellationReason = 'GROUP_ABSENT' | 'TEACHER_ABSENT' | 'CLASSROOM_UNAVAILABLE' | 'HOLIDAY' | 'OTHER';

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  organizationId: string;
  teacherId: string | null;
  studentGroupId: string | null;
  isActive: boolean;
  lastLoginAt?: string | null;
  teacher?: { id: string; fullName: string } | null;
  studentGroup?: { id: string; code: string } | null;
  organization?: { id: string; name: string; shortName: string | null; timezone: string };
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: User;
}

export interface LessonTime {
  lessonNumber: number;
  startTime: string;
  endTime: string;
}

export interface Settings {
  academicHoursPerLesson: number;
  academicHourMinutes: number;
  lessonDurationMinutes: number;
  lessonsPerDay: number;
  maxGroupLessonsPerDay: number;
  maxSameDisciplinePerDay: number;
  maxSameDisciplinePerWeek: number;
  lateLessonNumber: number;
  workingDays: number[];
  maxGroupWindowsPerWeek: number;
  maxTeacherWindowsPerWeek: number;
  maxExamsPerWeek: number;
  maxBuildingChangesPerDay: number;
  warnOnPartialLessons: boolean;
  scheduleConsultations: boolean;
  consultationWeeksBeforeEnd: number;
  solverTimeLimitSeconds: number;
  weights: Record<string, number>;
}

export interface SettingsResponse {
  organization: { id: string; name: string; shortName: string | null; address: string | null; timezone: string };
  settings: Settings;
  lessonTimes: LessonTime[];
}

export interface Specialty {
  id: string;
  code: string;
  name: string;
  qualification: string;
  fgosNumber: string | null;
  fgosDate: string | null;
  durationMonths: number;
}

export interface HoursSummary {
  total: number;
  lecture: number;
  practical: number;
  laboratory: number;
  consultation: number;
  selfStudy: number;
  assessment: number;
  practice: number;
}

export interface Semester {
  id: string;
  educationalProgramId: string;
  academicYearId: string;
  number: number;
  courseNumber: number;
  startDate: string;
  endDate: string;
  theoreticalWeeks: number;
  examWeeks: number;
  vacationWeeks: number;
  practiceWeeks: number;
  academicYear?: { id: string; title: string };
  program?: { id: string; title: string; admissionYear?: number };
  hours?: HoursSummary;
}

export interface AcademicYear {
  id: string;
  title: string;
  courseNumber: number | null;
  startDate: string;
  endDate: string;
}

export interface Program {
  id: string;
  title: string;
  admissionYear: number;
  studyForm: 'FULL_TIME' | 'PART_TIME' | 'EXTRAMURAL';
  durationMonths: number;
  totalSemesters: number;
  status: 'DRAFT' | 'APPROVED' | 'ARCHIVED';
  specialty: Specialty;
  specialtyId: string;
  hours: HoursSummary;
  semesters: Semester[];
  academicYears?: AcademicYear[];
  groups?: Group[];
  cycles?: Array<{ id: string; code: string; name: string; sortOrder: number }>;
  _count?: { groups: number; items: number; semesters: number };
}

export interface SemesterItem {
  id: string;
  curriculumItemId: string;
  semesterId: string;
  totalHours: number;
  lectureHours: number;
  practicalHours: number;
  laboratoryHours: number;
  consultationHours: number;
  selfStudyHours: number;
  assessmentHours: number;
  practiceHours: number;
  plannedLectureLessons: number;
  plannedPracticalLessons: number;
  plannedLaboratoryLessons: number;
  plannedConsultationLessons: number;
  plannedPracticeLessons: number;
  controlForm: ControlForm;
  practiceAtCollege: boolean;
  scheduleConsultations: boolean;
  lectureRoomTypes: ClassroomType[];
  practicalRoomTypes: ClassroomType[];
  laboratoryRoomTypes: ClassroomType[];
  consultationRoomTypes: ClassroomType[];
  practiceRoomTypes: ClassroomType[];
  notes: string | null;
  semester: { id: string; number: number; courseNumber?: number };
  curriculumItem?: {
    id: string;
    code: string;
    name: string;
    itemType: CurriculumItemType;
    cycle?: { id: string; code: string; name: string };
    parent?: { id: string; code: string; name: string } | null;
  };
  _count?: { assignments: number };
}

export interface CurriculumNode {
  id: string;
  code: string;
  name: string;
  itemType: CurriculumItemType;
  isRequired: boolean;
  isDifficult: boolean;
  department: string | null;
  sortOrder: number;
  parentItemId: string | null;
  cycleId: string;
  semesters: SemesterItem[];
  totals: Record<string, number>;
  children: CurriculumNode[];
}

export interface CurriculumTree {
  program: Program;
  semesters: Array<{ id: string; number: number; courseNumber: number; startDate: string; endDate: string }>;
  cycles: Array<{ id: string; code: string; name: string; sortOrder: number; items: CurriculumNode[]; totals: Record<string, number> }>;
}

export interface Subgroup {
  id: string;
  number: number;
  name: string;
  studentCount: number;
  students?: Array<{ id: string; fullName: string }>;
}

export interface Group {
  id: string;
  educationalProgramId: string;
  code: string;
  title: string;
  admissionYear: number;
  courseNumber: number;
  currentSemesterNumber: number;
  studentCount: number;
  subgroupCount: number;
  isActive: boolean;
  subgroups: Subgroup[];
  program?: { id: string; title: string; admissionYear: number; specialty?: { code: string; name: string }; semesters?: Semester[] };
  _count?: { students: number; assignments: number; lessons?: number };
}

export interface Student {
  id: string;
  fullName: string;
  recordBookNumber: string | null;
  isActive: boolean;
  subgroup: { id: string; number: number; name: string } | null;
}

export interface AvailabilitySlot {
  weekday: number;
  lessonNumber: number;
  isAvailable: boolean;
  preferenceWeight?: number;
  reason?: string | null;
}

export interface Teacher {
  id: string;
  fullName: string;
  department: string | null;
  position: string | null;
  email: string | null;
  phone: string | null;
  maxWeeklyLessons: number;
  maxDailyLessons: number;
  preferredStartLesson: number;
  preferredEndLesson: number;
  isActive: boolean;
  availability?: AvailabilitySlot[];
  user?: { id: string; email: string } | null;
  assignments?: Assignment[];
  _count?: { assignments: number; availability: number };
}

export interface Classroom {
  id: string;
  code: string;
  name: string;
  building: string | null;
  floor: number | null;
  capacity: number;
  classroomType: ClassroomType;
  equipmentJson: Record<string, unknown> | null;
  isActive: boolean;
  availability?: AvailabilitySlot[];
}

export interface Assignment {
  id: string;
  studentGroupId: string;
  semesterCurriculumItemId: string;
  subgroupNumber: number | null;
  lessonType: LessonType | null;
  teacherId: string | null;
  weeklyLessonTarget: number | null;
  priority: number;
  plannedHours: number | null;
  preferredClassroomId: string | null;
  classroomTypes: ClassroomType[];
  streamKey: string | null;
  allowHoursExcess: boolean;
  group: { id: string; code: string; studentCount: number; subgroupCount: number };
  semesterItem: SemesterItem & { curriculumItem: { id: string; code: string; name: string; itemType: CurriculumItemType } };
  teacher: { id: string; fullName: string } | null;
  preferredClassroom: { id: string; code: string; name: string } | null;
}

export interface CalendarEvent {
  id: string;
  educationalProgramId: string | null;
  semesterId: string | null;
  studentGroupId: string | null;
  courseNumber: number | null;
  teacherId: string | null;
  eventType: CalendarEventType;
  title: string;
  startDate: string;
  endDate: string;
  blocksSchedule: boolean;
  notes: string | null;
  program?: { id: string; title: string } | null;
  group?: { id: string; code: string } | null;
  teacher?: { id: string; fullName: string } | null;
}

export interface SchedulePeriod {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  status: PeriodStatus;
  semesterId: string;
  academicYearId: string;
  publishedAt: string | null;
  semester: {
    id: string;
    number: number;
    courseNumber: number;
    startDate: string;
    endDate: string;
    program?: { id: string; title: string; groups?: Group[] };
  };
  academicYear?: { id: string; title: string };
  _count?: { lessons: number };
  validation?: { errors: number; warnings: number } | Record<string, number>;
  lessonsByStatus?: Record<string, number>;
  lessonsTotal?: number;
  recentJobs?: GenerationJob[];
}

export interface Lesson {
  id: string;
  schedulePeriodId: string;
  date: string;
  weekday: number;
  lessonNumber: number;
  startTime: string;
  endTime: string;
  studentGroupId: string;
  subgroupNumber: number | null;
  semesterCurriculumItemId: string;
  teacherId: string | null;
  classroomId: string | null;
  lessonType: LessonType;
  status: LessonStatus;
  academicHours: number;
  originalLessonId: string | null;
  streamKey: string | null;
  isManual: boolean;
  isLocked: boolean;
  allowHoursExcess: boolean;
  topic: string | null;
  notes: string | null;
  studentGroup: { id: string; code: string; studentCount: number };
  semesterItem: {
    id: string;
    semesterId: string;
    curriculumItem: { id: string; code: string; name: string; itemType: CurriculumItemType; isDifficult: boolean };
  };
  teacher: { id: string; fullName: string } | null;
  classroom: { id: string; code: string; name: string; building: string | null; classroomType: ClassroomType; capacity: number } | null;
  conducted: {
    status: 'CONDUCTED' | 'CANCELLED' | 'POSTPONED' | 'REPLACED';
    actualHours: number;
    cancellationReason: CancellationReason | null;
    notes: string | null;
    actualTeacher: { id: string; fullName: string } | null;
  } | null;
  schedulePeriod: { id: string; title: string; status: PeriodStatus };
  originalLesson: { id: string; date: string; lessonNumber: number; status: LessonStatus } | null;
  derivedLessons: Array<{ id: string; date: string; lessonNumber: number; status: LessonStatus }>;
  substitution: {
    originalTeacher: { id: string; fullName: string } | null;
    substituteTeacher: { id: string; fullName: string };
    reason: string | null;
  } | null;
}

export interface ValidationIssue {
  severity: Severity;
  validationType: string;
  entityType: string;
  entityId: string | null;
  message: string;
  details?: Record<string, unknown>;
}

export interface ValidationSummary {
  errors: number;
  warnings: number;
  infos: number;
  canPublish: boolean;
  byType: Record<string, number>;
  items: ValidationIssue[];
}

export interface FreeSlot {
  date: string;
  weekday: number;
  lessonNumber: number;
  startTime: string;
  endTime: string;
  classroomId: string | null;
  classroomCode: string | null;
  score: number;
  note: string;
}

export interface GenerationJob {
  id: string;
  schedulePeriodId: string;
  status: JobStatus;
  statusLabel?: string;
  mode: 'CALENDAR' | 'WEEKLY_TEMPLATE';
  progress: number;
  message: string | null;
  solver: string | null;
  error: string | null;
  params?: Record<string, unknown>;
  stats?: GenerationResult['stats'] | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  appliedAt: string | null;
  createdBy?: { id: string; fullName: string } | null;
  result?: GenerationResult | null;
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
  subgroupNumber: number | null;
  itemCode: string;
  itemName: string;
  lessonType: LessonType;
  teacherName: string | null;
  roomCode: string | null;
  academicHours: number;
}

export interface UnplacedItem {
  demandId: string;
  groupCodes: string[];
  subgroupNumber: number | null;
  disciplineName: string;
  itemCode: string;
  lessonType: LessonType;
  teacherName: string | null;
  lessonsRequired: number;
  lessonsUnplaced: number;
  hoursUnplaced: number;
  reasons: Array<{ code: string; message: string }>;
  suggestions: string[];
}

export interface GenerationResult {
  period: { id: string; title: string };
  range: { from: string; to: string };
  mode: string;
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

export interface StreamHours {
  planned: number;
  scheduled: number;
  conducted: number;
  remaining: number;
  scheduleDeficit: number;
  excess: number;
  future: number;
  unmarkedPast: number;
  cancelled: number;
  forecast: number;
  forecastDeficit: number;
  lessons: number;
  conductedLessons: number;
  cancelledLessons: number;
  excessApproved: boolean;
}

export interface HourControlRow {
  key: string;
  groupId: string;
  groupCode: string;
  subgroupNumber: number | null;
  programId: string;
  semesterId: string;
  semesterNumber: number;
  semesterStart: string;
  semesterEnd: string;
  semesterItemId: string;
  itemCode: string;
  itemName: string;
  itemType: CurriculumItemType;
  controlForm: ControlForm;
  teachers: Array<{ id: string | null; name: string | null; lessonType: LessonType }>;
  byType: Partial<Record<LessonType, StreamHours>>;
  total: StreamHours;
  status: HourStatus;
  expectedByNow: number;
  completionPercent: number;
  forecastPercent: number;
  unassigned: boolean;
}

export interface HourControlResponse {
  rows: HourControlRow[];
  summary: {
    rows: number;
    total: StreamHours;
    byStatus: Record<HourStatus, number>;
    completionPercent: number;
    forecastPercent: number;
  };
  today: string;
}

export interface ReportColumn {
  key: string;
  header: string;
  width?: number;
  type?: 'text' | 'number' | 'date' | 'percent';
}

export interface ReportTable {
  type: string;
  title: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows: Array<Record<string, string | number | null>>;
  summary?: Array<{ label: string; value: string | number }>;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  scheduleLessonId: string | null;
}

export interface MakeupTask {
  id: string;
  status: 'OPEN' | 'SCHEDULED' | 'DONE' | 'CANCELLED';
  lessonType: LessonType;
  academicHours: number;
  subgroupNumber: number | null;
  dueDate: string | null;
  notes: string | null;
  group: { id: string; code: string };
  semesterItem: { curriculumItem: { code: string; name: string } };
  teacher: { id: string; fullName: string } | null;
  sourceLesson: { id: string; date: string; lessonNumber: number; schedulePeriodId: string; status: LessonStatus } | null;
  resolvedLesson: { id: string; date: string; lessonNumber: number; status: LessonStatus } | null;
}
