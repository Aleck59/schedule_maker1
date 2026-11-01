import { formatDateRu, isoWeekday, weekdayName } from '../common/utils/dates';
import { LESSON_TYPE_SHORT, STUDY_FORM_LABELS } from '../common/utils/labels';
import { EDUCATION_BASE_TEXT, PrintFormSettings, shortTeacherName } from '../export/schedule-form';
import type { FormCell, FormCellStyle, FormMerge, ReportFormContent } from './report-form';

/**
 * Источник «Расписание недели по группам» для бланков расписания:
 * поля по дням, парам и группам — {{d1.date}}, {{g1.d1.p1}}, {{g1.d1.p1.room}} …
 */
export const SCHEDULE_WEEK_SOURCE = 'schedule-week';

export const SCHEDULE_WEEK_INFO = {
  type: SCHEDULE_WEEK_SOURCE,
  title: 'Расписание недели по группам (бланк)',
  description: 'Дни × пары × группы: для печатного бланка расписания по специальности',
  params: ['from', 'groupIds'],
};

/** Поля для панели редактора (на примере первой группы, первого дня и пары) */
export const SCHEDULE_WEEK_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'spec.code', label: 'Код специальности' },
  { key: 'spec.name', label: 'Название специальности' },
  { key: 'spec.profile', label: 'Профиль' },
  { key: 'spec.profileText', label: '« профиль „…“» или пусто' },
  { key: 'spec.kind', label: '«специальности» / «направление»' },
  { key: 'spec.base', label: 'На базе … образования' },
  { key: 'spec.form', label: 'Форма обучения' },
  { key: 'academicYear', label: 'Учебный год' },
  { key: 'week.parity', label: 'Неделя 1 / 2' },
  { key: 'week.start', label: 'Начало занятий' },
  { key: 'approval1.heading', label: 'Гриф 1: заголовок' },
  { key: 'approval1.position', label: 'Гриф 1: должность' },
  { key: 'approval1.name', label: 'Гриф 1: ФИО' },
  { key: 'approval2.heading', label: 'Гриф 2: заголовок' },
  { key: 'approval2.position', label: 'Гриф 2: должность' },
  { key: 'approval2.name', label: 'Гриф 2: ФИО' },
  { key: 'approval3.heading', label: 'Гриф 3: заголовок' },
  { key: 'approval3.position', label: 'Гриф 3: должность' },
  { key: 'approval3.name', label: 'Гриф 3: ФИО' },
  { key: 'footer.position', label: 'Подпись: должность' },
  { key: 'footer.name', label: 'Подпись: ФИО' },
  { key: 'd1.weekday', label: 'День 1: название' },
  { key: 'd1.date', label: 'День 1: дата' },
  { key: 'g1.code', label: 'Группа 1: код' },
  { key: 'g1.number', label: 'Группа 1: номер в курсе' },
  { key: 'g1.course', label: 'Группа 1: курс' },
  { key: 'g1.semester', label: 'Группа 1: семестр' },
  { key: 'g1.room', label: 'Группа 1: основная аудитория недели' },
  { key: 'g1.d1.p1', label: 'Пара: дисциплина и преподаватель' },
  { key: 'g1.d1.p1.subject', label: 'Пара: дисциплина' },
  { key: 'g1.d1.p1.teacher', label: 'Пара: преподаватель' },
  { key: 'g1.d1.p1.room', label: 'Пара: аудитория' },
  { key: 'g1.d1.p1.type', label: 'Пара: вид занятия' },
  { key: 'g1.d1.p1.time', label: 'Пара: время начала' },
];

export interface WeekGroup {
  id: string;
  code: string;
  courseNumber: number;
  semesterNumber: number;
}

export interface WeekLesson {
  groupId: string;
  date: string;
  lessonNumber: number;
  subgroupNumber: number | null;
  subject: string;
  teacher: string | null;
  room: string | null;
  lessonType: string;
}

export interface WeekMeta {
  specialtyCode: string;
  specialtyName: string;
  higherEducation: boolean;
  profile: string | null;
  studyForm: string;
  educationBase: string | null;
  academicYear: string | null;
  /** Номер недели от начала учебного года (1, 2, 3 …) */
  weekNumber: number | null;
}

const clock = (t: string) => t.replace(/^0/, '').replace(':', '.');

/** Поля бланка: значения для подстановки {{...}} */
export function buildWeekFields(input: {
  meta: WeekMeta | null;
  groups: WeekGroup[];
  days: string[];
  lessons: WeekLesson[];
  lessonTimes: Array<{ lessonNumber: number; startTime: string }>;
  print: PrintFormSettings;
}): Record<string, string | number> {
  const f: Record<string, string | number> = {};
  const { meta, print } = input;
  if (meta) {
    f['spec.code'] = meta.specialtyCode;
    f['spec.name'] = meta.specialtyName;
    f['spec.profile'] = meta.profile ?? '';
    f['spec.profileText'] = meta.profile ? ` профиль «${meta.profile}»` : '';
    f['spec.kind'] = meta.higherEducation ? 'направление' : 'специальности';
    f['spec.base'] = meta.educationBase ? EDUCATION_BASE_TEXT[meta.educationBase] : '';
    f['spec.form'] = STUDY_FORM_LABELS[meta.studyForm] ?? meta.studyForm;
    f.academicYear = meta.academicYear ?? '';
    f['week.number'] = meta.weekNumber ?? '';
    f['week.parity'] = meta.weekNumber ? ((meta.weekNumber - 1) % 2) + 1 : '';
  }
  for (let i = 0; i < 3; i++) {
    const a = print.approvals[i];
    f[`approval${i + 1}.heading`] = a?.heading ?? '';
    f[`approval${i + 1}.position`] = a?.position ?? '';
    f[`approval${i + 1}.name`] = a?.name ?? '';
  }
  f['footer.position'] = print.footerPosition;
  f['footer.name'] = print.footerName;

  const timeOf = (n: number) => input.lessonTimes.find((t) => t.lessonNumber === n)?.startTime;
  const firstNumber = input.lessons.length ? Math.min(...input.lessons.map((l) => l.lessonNumber)) : null;
  const firstTime = firstNumber !== null ? timeOf(firstNumber) : undefined;
  f['week.start'] = firstTime ? clock(firstTime) : '';

  input.days.forEach((date, d) => {
    f[`d${d + 1}.weekday`] = weekdayName(isoWeekday(date)).toUpperCase();
    f[`d${d + 1}.date`] = formatDateRu(date);
  });

  // Номер группы внутри курса: «1 группа», «2 группа»
  const perCourse = new Map<number, number>();
  input.groups.forEach((g, gi) => {
    const p = `g${gi + 1}`;
    const n = (perCourse.get(g.courseNumber) ?? 0) + 1;
    perCourse.set(g.courseNumber, n);
    f[`${p}.code`] = g.code;
    f[`${p}.number`] = n;
    f[`${p}.course`] = g.courseNumber;
    f[`${p}.semester`] = g.semesterNumber;
    const own = input.lessons.filter((l) => l.groupId === g.id);
    const rooms = new Map<string, number>();
    for (const l of own) if (l.room) rooms.set(l.room, (rooms.get(l.room) ?? 0) + 1);
    f[`${p}.room`] = [...rooms.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    input.days.forEach((date, d) => {
      const day = own.filter((l) => l.date === date);
      const numbers = [...new Set(day.map((l) => l.lessonNumber))];
      for (const n of numbers) {
        const slot = day
          .filter((l) => l.lessonNumber === n)
          .sort((a, b) => (a.subgroupNumber ?? 0) - (b.subgroupNumber ?? 0));
        const key = `${p}.d${d + 1}.p${n}`;
        const parts = slot.map((l) => {
          const sub = slot.length > 1 && l.subgroupNumber ? `${l.subgroupNumber} п/г: ` : '';
          return `${sub}${l.subject}${l.teacher ? `\nПреподаватель ${shortTeacherName(l.teacher)}` : ''}`;
        });
        f[key] = [...new Set(parts)].join('\n');
        f[`${key}.subject`] = [...new Set(slot.map((l) => l.subject))].join(' / ');
        f[`${key}.teacher`] = [
          ...new Set(slot.filter((l) => l.teacher).map((l) => shortTeacherName(l.teacher!))),
        ].join(', ');
        f[`${key}.room`] = [...new Set(slot.map((l) => l.room).filter(Boolean))].join(', ');
        f[`${key}.type`] = [...new Set(slot.map((l) => LESSON_TYPE_SHORT[l.lessonType] ?? ''))]
          .filter(Boolean)
          .join(', ');
        const t = timeOf(n);
        f[`${key}.time`] = t ? clock(t) : '';
      }
    });
  });
  return f;
}

/** Пустые пары тоже должны подставляться пустой строкой, а не оставаться {{…}} */
export function isWeekSlotField(name: string): boolean {
  return /^g\d+\.d\d+\.p\d+(\.(subject|teacher|room|type|time))?$/.test(name);
}

// ---------- Готовый бланк ----------

export type BlankLayout = 'rooms' | 'types' | 'header-room';

export interface BlankOptions {
  groups: WeekGroup[];
  /** rooms — у каждой группы столбец аудитории; types — ещё и вид занятия; header-room — аудитория в шапке (заочная) */
  layout: BlankLayout;
  /** Пар в дне (строк на день) */
  pairs: number;
  /** Дней в неделе (6 — пн–сб) */
  days: number;
  /** Сколько грифов над таблицей (2 или 3) */
  approvals: number;
}

const BOX = 'trbl';

/**
 * Бланк расписания как в колледже: грифы, заголовок по специальности, курсы и группы столбцами,
 * дни недели строками с подписью сбоку, по строке на пару; одинаковые пары групп склеиваются.
 */
export function buildScheduleBlank(opts: BlankOptions): ReportFormContent {
  const groups = opts.groups;
  // У группы: текст пары (2 столбца — чтобы грифы и подпись делили лист ровнее), вид занятия, аудитория
  const extra = opts.layout === 'types' ? 2 : opts.layout === 'rooms' ? 1 : 0;
  const per = 2 + extra;
  const textWidth = Math.max(26, Math.round(84 / Math.max(1, groups.length)) - extra * 6);
  const colWidths = [5.5];
  groups.forEach(() => {
    colWidths.push(textWidth / 2, textWidth / 2);
    if (opts.layout === 'types') colWidths.push(6);
    if (extra) colWidths.push(6);
  });
  const colCount = colWidths.length;
  const cells: Record<string, FormCell> = {};
  const merges: FormMerge[] = [];
  const rowHeights: Record<string, number> = {};
  const set = (r: number, c: number, v: string, s?: FormCellStyle) =>
    (cells[`${r}:${c}`] = s ? { v, s } : { v });
  const merge = (r: number, c: number, rs: number, cs: number) => {
    if (rs > 1 || cs > 1) merges.push({ r, c, rs, cs });
  };
  const box = (r1: number, c1: number, r2: number, c2: number, extra: FormCellStyle = {}) => {
    for (let r = r1; r <= r2; r++)
      for (let c = c1; c <= c2; c++) {
        const k = `${r}:${c}`;
        cells[k] = { ...(cells[k] ?? {}), s: { ...(cells[k]?.s ?? {}), bd: BOX, ...extra } };
      }
  };

  // Грифы: 2 — слева и справа, 3 — по трети ширины
  const n = Math.max(1, Math.min(3, opts.approvals));
  const spans = splitColumns(colWidths, n);
  let row = 0;
  const lines = ['heading', 'position', 'name', 'date'] as const;
  spans.forEach(([c1, c2], i) => {
    const a = `approval${i + 1}`;
    lines.forEach((line, li) => {
      const text =
        line === 'heading'
          ? `{{${a}.heading}}`
          : line === 'position'
            ? `{{${a}.position}}`
            : line === 'name'
              ? `____________ {{${a}.name}}`
              : '«____» ______________ {{year}} г.';
      set(row + li, c1, text, { size: 10, wrap: line === 'position', valign: 'top' });
      merge(row + li, c1, 1, c2 - c1 + 1);
    });
  });
  rowHeights[String(row + 1)] = 28;
  row += 5;

  const title = [
    { v: 'Расписание занятий', s: { size: 12, b: true } },
    { v: '{{spec.kind}} {{spec.code}}', s: { size: 11 } },
    { v: '«{{spec.name}}»{{spec.profileText}}', s: { size: 11 } },
    { v: '{{spec.base}}', s: { size: 11 } },
    { v: '{{org.shortName}}   {{academicYear}} учебный год', s: { size: 11 } },
    { v: 'Форма обучения: {{spec.form}}', s: { size: 11 } },
    { v: '{{week.parity}} неделя', s: { size: 11 } },
    { v: 'Начало занятий в {{week.start}} ч.', s: { size: 11 } },
  ];
  title.forEach((t) => {
    set(row, 0, t.v, { ...t.s, align: 'center' });
    merge(row, 0, 1, colCount);
    row++;
  });

  // Шапка: курс + семестр над группами одного курса, затем номер группы / аудитория
  const head = row;
  const courseRuns: Array<{ start: number; end: number; g: number }> = [];
  groups.forEach((g, gi) => {
    const c = 1 + gi * per;
    const last = courseRuns[courseRuns.length - 1];
    if (
      last &&
      groups[last.g].courseNumber === g.courseNumber &&
      groups[last.g].semesterNumber === g.semesterNumber
    )
      last.end = c + per - 1;
    else courseRuns.push({ start: c, end: c + per - 1, g: gi });
  });
  const multiInCourse = courseRuns.some((r) => r.end - r.start + 1 > per);
  set(head, 0, '', { bd: BOX });
  for (const run of courseRuns) {
    set(head, run.start, `{{g${run.g + 1}.course}} КУРС   {{g${run.g + 1}.semester}} семестр`, {
      b: true,
      align: 'center',
      valign: 'middle',
    });
    merge(head, run.start, 1, run.end - run.start + 1);
  }
  box(head, 0, head, colCount - 1, { align: 'center', valign: 'middle' });
  rowHeights[String(head)] = 22;
  let sub = head + 1;
  const subRow = opts.layout === 'header-room' || multiInCourse || extra > 0;
  if (subRow) {
    groups.forEach((g, gi) => {
      const c = 1 + gi * per;
      if (opts.layout === 'header-room') set(sub, c, `{{g${gi + 1}.room}} аудитория`, { b: true });
      else set(sub, c, multiInCourse ? `{{g${gi + 1}.number}} группа` : '', { b: true });
      merge(sub, c, 1, 2);
      if (opts.layout === 'types') set(sub, c + 2, 'вид занятий', { size: 7, wrap: true });
      if (extra) set(sub, c + per - 1, 'аудитория', { size: 7, wrap: true });
    });
    box(sub, 0, sub, colCount - 1, { align: 'center', valign: 'middle' });
    rowHeights[String(sub)] = 22;
    merge(head, 0, 2, 1);
    sub++;
  }
  row = sub;

  // Дни × пары
  for (let d = 1; d <= opts.days; d++) {
    const first = row;
    set(first, 0, `{{d${d}.weekday}}\n{{d${d}.date}}`, {
      b: true,
      rot: true,
      align: 'center',
      valign: 'middle',
      wrap: true,
      size: 10,
    });
    merge(first, 0, opts.pairs, 1);
    for (let p = 1; p <= opts.pairs; p++) {
      groups.forEach((_, gi) => {
        const c = 1 + gi * per;
        const slot = `g${gi + 1}.d${d}.p${p}`;
        set(row, c, `{{${slot}}}`, { wrap: true, align: 'center', valign: 'middle', size: 10, join: true });
        merge(row, c, 1, 2);
        if (opts.layout === 'types')
          set(row, c + 2, `{{${slot}.type}}`, { size: 8, align: 'center', valign: 'top' });
        if (extra) set(row, c + per - 1, `{{${slot}.room}}`, { align: 'center', valign: 'top', size: 10 });
      });
      rowHeights[String(row)] = 24;
      row++;
    }
    box(first, 0, row - 1, colCount - 1);
  }

  row++;
  const [left, rightPart] = splitColumns(colWidths, 2);
  set(row, left[0], '{{footer.position}}', { size: 12, align: 'center' });
  merge(row, left[0], 1, left[1] - left[0] + 1);
  set(row, rightPart[0], '{{footer.name}}', { size: 12, align: 'center' });
  merge(row, rightPart[0], 1, rightPart[1] - rightPart[0] + 1);

  return {
    version: 1,
    rowCount: row + 1,
    colCount,
    colWidths,
    rowHeights,
    cells,
    merges,
    repeatRow: null,
    dataSource: SCHEDULE_WEEK_SOURCE,
    params: { groupIds: groups.map((g) => g.id).join(',') },
    orientation: 'portrait',
  };
}

/** Деление столбцов листа на n частей примерно равной ширины (для грифов и подписи) */
function splitColumns(widths: number[], n: number): Array<[number, number]> {
  const total = widths.reduce((a, b) => a + b, 0);
  const out: Array<[number, number]> = [];
  let start = 0;
  let acc = 0;
  for (let part = 1; part <= n; part++) {
    if (start >= widths.length) break;
    if (part === n) {
      out.push([start, widths.length - 1]);
      break;
    }
    const target = (total * part) / n;
    let end = start;
    acc += widths[end];
    while (end + 1 < widths.length - (n - part) && acc + widths[end + 1] / 2 <= target) {
      end++;
      acc += widths[end];
    }
    out.push([start, end]);
    start = end + 1;
  }
  return out;
}
