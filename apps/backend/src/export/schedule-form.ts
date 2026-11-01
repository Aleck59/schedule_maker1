import { formatDateRu, isoWeekday, weekdayName } from '../common/utils/dates';
import { LESSON_TYPE_SHORT, STUDY_FORM_LABELS } from '../common/utils/labels';

/** Тексты печатной формы расписания, хранятся в настройках организации */
export interface PrintFormSettings {
  /** Грифы над таблицей слева направо: «СОГЛАСОВАНО», «ВНЕСЕНО», «УТВЕРЖДАЮ» */
  approvals: Array<{ heading: string; position: string; name: string }>;
  footerPosition: string;
  footerName: string;
  /** Профиль специальности для заголовка: specialtyId → «Социально-экономический» */
  profiles: Record<string, string>;
}

export const DEFAULT_PRINT_FORM: PrintFormSettings = {
  approvals: [
    { heading: 'СОГЛАСОВАНО', position: 'Председатель студенческого совета', name: '' },
    { heading: 'УТВЕРЖДАЮ', position: 'Директор', name: '' },
  ],
  footerPosition: 'Специалист по учебно-методической работе',
  footerName: '',
  profiles: {},
};

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

export function normalizePrintForm(json: unknown): PrintFormSettings {
  if (!json || typeof json !== 'object') return structuredClone(DEFAULT_PRINT_FORM);
  const raw = json as Record<string, unknown>;
  const approvals = Array.isArray(raw.approvals)
    ? raw.approvals
        .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
        .slice(0, 3)
        .map((a) => ({ heading: str(a.heading), position: str(a.position), name: str(a.name) }))
    : structuredClone(DEFAULT_PRINT_FORM.approvals);
  const profiles: Record<string, string> = {};
  if (raw.profiles && typeof raw.profiles === 'object') {
    for (const [k, v] of Object.entries(raw.profiles as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) profiles[k] = v.trim();
    }
  }
  return {
    approvals,
    footerPosition: str(raw.footerPosition, DEFAULT_PRINT_FORM.footerPosition),
    footerName: str(raw.footerName),
    profiles,
  };
}

export const EDUCATION_BASE_TEXT: Record<string, string> = {
  BASIC_GENERAL: 'на базе основного общего образования',
  SECONDARY_GENERAL: 'на базе среднего общего образования',
};

export interface FormLesson {
  date: string;
  lessonNumber: number;
  groupId: string;
  subgroupNumber: number | null;
  itemName: string;
  teacherName: string | null;
  classroom: string | null;
  lessonType: string;
}

export interface FormGroup {
  id: string;
  code: string;
  courseNumber: number;
  semesterNumber: number;
  subgroupCount: number;
}

export interface FormSheetMeta {
  key: string;
  specialtyCode: string;
  specialtyName: string;
  higherEducation: boolean;
  profile: string | null;
  studyForm: string;
  educationBase: string | null;
  academicYear: string | null;
}

export interface FormColumn {
  groupId: string;
  subgroup: number | null;
}

export interface FormHeaderCell {
  text: string;
  span: number;
}

/** Ячейка строки: занимает span столбцов групп; пустая — без дисциплины */
export interface FormCell {
  span: number;
  subject: string | null;
  teacher: string | null;
  type: string | null;
  room: string | null;
}

export interface FormRow {
  lessonNumber: number;
  time: string;
  cells: FormCell[];
}

export interface FormDay {
  date: string;
  weekday: string;
  dateLabel: string;
  rows: FormRow[];
}

export interface FormSheet {
  key: string;
  titleLines: string[];
  approvals: PrintFormSettings['approvals'];
  footerPosition: string;
  footerName: string;
  year: number;
  columns: FormColumn[];
  header: FormHeaderCell[][];
  days: FormDay[];
}

export function shortTeacherName(fullName: string): string {
  // «Иванов П.Т.» и «Иванов П. Т.» — инициалы уже стоят, точки делят их на части
  const [last, ...rest] = fullName.trim().split(/\s+/);
  const parts = rest.flatMap((p) => p.split('.')).filter(Boolean);
  return [
    last,
    parts
      .slice(0, 2)
      .map((p) => `${p[0]}.`)
      .join(''),
  ]
    .filter(Boolean)
    .join(' ');
}

const clock = (t: string) => t.replace(/^0/, '').replace(':', '.');

const MIN_ROWS_PER_DAY = 3;

/**
 * Печатная форма на неделю: строки — дни и пары, столбцы — курсы и группы специальности
 * (подгруппы — отдельными столбцами). Одинаковые соседние пары (поток, пара всей группы
 * у подгрупп) объединяются в одну ячейку, как в бумажном расписании.
 */
export function buildFormSheet(input: {
  meta: FormSheetMeta;
  groups: FormGroup[];
  lessons: FormLesson[];
  days: string[];
  lessonTimes: Array<{ lessonNumber: number; startTime: string; endTime: string }>;
  showLessonTypes: boolean;
  weekLabel: string | null;
  organizationName: string;
  settings: PrintFormSettings;
}): FormSheet {
  const { meta, lessons, settings } = input;
  const groups = [...input.groups].sort(
    (a, b) => a.courseNumber - b.courseNumber || a.code.localeCompare(b.code, 'ru'),
  );

  const columns: FormColumn[] = [];
  for (const g of groups) {
    const usedSubgroups = lessons
      .filter((l) => l.groupId === g.id && l.subgroupNumber !== null)
      .map((l) => l.subgroupNumber!);
    const count = usedSubgroups.length > 0 ? Math.max(g.subgroupCount, ...usedSubgroups) : 1;
    if (count <= 1) columns.push({ groupId: g.id, subgroup: null });
    else for (let s = 1; s <= count; s++) columns.push({ groupId: g.id, subgroup: s });
  }

  const header: FormHeaderCell[][] = [[], []];
  const groupRow: FormHeaderCell[] = [];
  let needGroupRow = false;
  for (const g of groups) {
    const span = columns.filter((c) => c.groupId === g.id).length;
    const course = header[0][header[0].length - 1];
    const sameCourse = groups.filter((x) => x.courseNumber === g.courseNumber);
    if (sameCourse.length > 1 || span > 1) needGroupRow = true;
    if (course && course.text === `${g.courseNumber} курс`) {
      course.span += span;
      const sem = header[1][header[1].length - 1];
      if (sem.text === `${g.semesterNumber} семестр`) sem.span += span;
      else header[1].push({ text: `${g.semesterNumber} семестр`, span });
    } else {
      header[0].push({ text: `${g.courseNumber} курс`, span });
      header[1].push({ text: `${g.semesterNumber} семестр`, span });
    }
    if (span > 1) {
      for (let s = 1; s <= span; s++) groupRow.push({ text: `${g.code}, п/г ${s}`, span: 1 });
    } else groupRow.push({ text: g.code, span: 1 });
  }
  if (needGroupRow) header.push(groupRow);

  const timeOf = (n: number) => input.lessonTimes.find((t) => t.lessonNumber === n);
  const matches = (l: FormLesson, c: FormColumn) =>
    l.groupId === c.groupId &&
    (c.subgroup === null || l.subgroupNumber === null || l.subgroupNumber === c.subgroup);
  const identity = (ls: FormLesson[]) =>
    ls.map((l) => `${l.itemName}|${l.teacherName ?? ''}|${l.classroom ?? ''}|${l.lessonType}`).join('§');
  const maxLesson = Math.max(
    1,
    ...input.lessonTimes.map((t) => t.lessonNumber),
    ...lessons.map((l) => l.lessonNumber),
  );

  const days: FormDay[] = input.days.map((date) => {
    const dayLessons = lessons.filter((l) => l.date === date);
    const numbers = dayLessons.map((l) => l.lessonNumber);
    const first = numbers.length ? Math.min(...numbers) : 1;
    let last = numbers.length ? Math.max(...numbers) : 1;
    while (last - first + 1 < MIN_ROWS_PER_DAY && last < maxLesson) last++;
    const rows: FormRow[] = [];
    for (let n = first; n <= last; n++) {
      const t = timeOf(n);
      const perColumn = columns.map((c) => dayLessons.filter((l) => l.lessonNumber === n && matches(l, c)));
      const cells: FormCell[] = [];
      for (let i = 0; i < columns.length; i++) {
        const own = perColumn[i];
        if (own.length === 0) {
          cells.push({ span: 1, subject: null, teacher: null, type: null, room: null });
          continue;
        }
        let span = 1;
        while (i + span < columns.length && identity(perColumn[i + span]) === identity(own)) span++;
        cells.push({
          span,
          subject: [...new Set(own.map((l) => l.itemName))].join(' / '),
          teacher:
            [...new Set(own.filter((l) => l.teacherName).map((l) => shortTeacherName(l.teacherName!)))].join(
              ', ',
            ) || null,
          type: input.showLessonTypes
            ? [...new Set(own.map((l) => LESSON_TYPE_SHORT[l.lessonType] ?? ''))]
                .filter(Boolean)
                .join(', ') || null
            : null,
          room: [...new Set(own.map((l) => l.classroom).filter(Boolean))].join(', ') || null,
        });
        i += span - 1;
      }
      rows.push({ lessonNumber: n, time: t ? `${clock(t.startTime)}–${clock(t.endTime)}` : '', cells });
    }
    return { date, weekday: weekdayName(isoWeekday(date)), dateLabel: formatDateRu(date), rows };
  });

  const firstUsed = lessons.length ? Math.min(...lessons.map((l) => l.lessonNumber)) : null;
  const start = firstUsed !== null ? timeOf(firstUsed) : null;
  const studyForm = STUDY_FORM_LABELS[meta.studyForm] ?? meta.studyForm;
  const titleLines = [
    'Расписание занятий',
    `${meta.higherEducation ? 'направления подготовки' : 'специальности'} ${meta.specialtyCode} «${meta.specialtyName}»${
      meta.profile ? ` профиль «${meta.profile}»` : ''
    }`,
    [input.organizationName, meta.educationBase ? EDUCATION_BASE_TEXT[meta.educationBase] : null]
      .filter(Boolean)
      .join(', '),
    [meta.academicYear ? `${meta.academicYear} учебный год` : null, `форма обучения: ${studyForm}`]
      .filter(Boolean)
      .join(', '),
    [input.weekLabel?.trim() || null, start ? `Начало занятий в ${clock(start.startTime)}` : null]
      .filter(Boolean)
      .join(' · '),
  ].filter((s) => s.length > 0);

  return {
    key: meta.key,
    titleLines,
    approvals: settings.approvals,
    footerPosition: settings.footerPosition,
    footerName: settings.footerName,
    year: Number((input.days[0] ?? new Date().toISOString()).slice(0, 4)),
    columns,
    header,
    days,
  };
}
