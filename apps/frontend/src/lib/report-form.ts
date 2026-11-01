/** Форма отчёта «как в Excel»: модель листа и операции редактора (зеркало apps/backend/src/report-forms/report-form.ts) */

export type HAlign = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'middle' | 'bottom';
export type CellFormat = 'auto' | 'text' | 'number' | 'percent';

export interface FormCellStyle {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  size?: number;
  align?: HAlign;
  valign?: VAlign;
  wrap?: boolean;
  color?: string;
  fill?: string;
  /** Границы: набор сторон t, r, b, l */
  bd?: string;
  fmt?: CellFormat;
  /** Текст повёрнут на 90° (подписи дней) */
  rot?: boolean;
  /** Склеивать с такой же ячейкой справа (общая пара групп) */
  join?: boolean;
}

export interface FormCell {
  v?: string;
  s?: FormCellStyle;
}

export interface FormMerge {
  r: number;
  c: number;
  rs: number;
  cs: number;
}

export interface ReportFormContent {
  version: 1;
  rowCount: number;
  colCount: number;
  colWidths: number[];
  rowHeights: Record<string, number>;
  cells: Record<string, FormCell>;
  merges: FormMerge[];
  repeatRow: number | null;
  dataSource: string | null;
  params: Record<string, string>;
  orientation: 'portrait' | 'landscape';
}

export interface ReportFormRecord {
  id: string;
  name: string;
  description: string | null;
  dataSource: string | null;
  content: ReportFormContent;
  createdAt: string;
  updatedAt: string;
}

export interface SourceColumn {
  key: string;
  header: string;
  width?: number;
  type?: 'text' | 'number' | 'date' | 'percent';
}

export interface FormSource {
  type: string;
  title: string;
  description: string;
  params: string[];
  columns: SourceColumn[];
  /** Поля источника, если он не табличный (бланк расписания) */
  fields?: Array<{ key: string; label: string }>;
}

export interface FormSources {
  common: Array<{ key: string; label: string }>;
  sources: FormSource[];
}

export interface RenderedCell {
  v: string | number | null;
  s?: FormCellStyle;
  fmt?: 'number' | 'percent';
}

export interface RenderedSheet {
  colWidths: number[];
  rowHeights: Array<number | null>;
  rows: RenderedCell[][];
  merges: FormMerge[];
  orientation: 'portrait' | 'landscape';
  unknownFields: string[];
}

export const LIMITS = { rows: 300, cols: 52 };
export const DEFAULT_COL_WIDTH = 12;
export const DEFAULT_ROW_HEIGHT = 20;
export const DEFAULT_FONT_SIZE = 11;

/** Ширина столбца в пикселях по ширине в знаках Excel */
export const colPx = (chars: number) => Math.round(chars * 7 + 5);
export const pxToChars = (px: number) => Math.max(1, Math.round(((px - 5) / 7) * 10) / 10);
/** Высота строки в пикселях по высоте в пунктах */
export const rowPx = (pt: number) => Math.round(pt * (4 / 3));
export const pxToPt = (px: number) => Math.max(6, Math.round(px * 0.75));

export function colName(c: number): string {
  let s = '';
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export const cellKey = (r: number, c: number) => `${r}:${c}`;
export const cellName = (r: number, c: number) => `${colName(c)}${r + 1}`;

export interface Range {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export const normRange = (a: { r: number; c: number }, b: { r: number; c: number }): Range => ({
  r1: Math.min(a.r, b.r),
  c1: Math.min(a.c, b.c),
  r2: Math.max(a.r, b.r),
  c2: Math.max(a.c, b.c),
});

export const rangeName = (g: Range) =>
  g.r1 === g.r2 && g.c1 === g.c2 ? cellName(g.r1, g.c1) : `${cellName(g.r1, g.c1)}:${cellName(g.r2, g.c2)}`;

const overlaps = (g: Range, m: FormMerge) =>
  m.r <= g.r2 && m.r + m.rs - 1 >= g.r1 && m.c <= g.c2 && m.c + m.cs - 1 >= g.c1;

/** Расширение выделения до целых объединённых ячеек (как в Excel) */
export function expandRange(g: Range, merges: FormMerge[]): Range {
  const out = { ...g };
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of merges) {
      if (!overlaps(out, m)) continue;
      const r2 = m.r + m.rs - 1;
      const c2 = m.c + m.cs - 1;
      if (m.r < out.r1 || m.c < out.c1 || r2 > out.r2 || c2 > out.c2) {
        out.r1 = Math.min(out.r1, m.r);
        out.c1 = Math.min(out.c1, m.c);
        out.r2 = Math.max(out.r2, r2);
        out.c2 = Math.max(out.c2, c2);
        changed = true;
      }
    }
  }
  return out;
}

export const mergeAt = (merges: FormMerge[], r: number, c: number) =>
  merges.find((m) => r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs);

export function emptyForm(rows = 30, cols = 10): ReportFormContent {
  return {
    version: 1,
    rowCount: rows,
    colCount: cols,
    colWidths: Array.from({ length: cols }, () => DEFAULT_COL_WIDTH),
    rowHeights: {},
    cells: {},
    merges: [],
    repeatRow: null,
    dataSource: null,
    params: {},
    orientation: 'portrait',
  };
}

const HEAD_STYLE: FormCellStyle = { b: true, align: 'center', valign: 'middle', wrap: true, bd: 'trbl', fill: '#E8EEF7' };

/** Готовая форма по отчёту-источнику: шапка, строка заголовков, строка данных, итог и подпись */
export function formFromSource(source: FormSource): ReportFormContent {
  const cols = Math.min(source.columns.length, LIMITS.cols) || 1;
  const form = emptyForm(12, cols);
  form.dataSource = source.type;
  form.orientation = cols > 7 ? 'landscape' : 'portrait';
  form.colWidths = source.columns.slice(0, cols).map((c) => c.width ?? DEFAULT_COL_WIDTH);
  const set = (r: number, c: number, cell: FormCell) => (form.cells[cellKey(r, c)] = cell);
  set(0, 0, { v: '{{org.name}}', s: { align: 'center', size: 12 } });
  set(1, 0, { v: '{{report.title}}', s: { b: true, align: 'center', size: 14 } });
  set(2, 0, { v: '{{report.subtitle}}', s: { align: 'center', i: true } });
  if (cols > 1) for (const r of [0, 1, 2]) form.merges.push({ r, c: 0, rs: 1, cs: cols });
  form.rowHeights['4'] = 32;
  source.columns.slice(0, cols).forEach((col, c) => {
    set(4, c, { v: col.header, s: HEAD_STYLE });
    const numeric = col.type === 'number' || col.type === 'percent';
    set(5, c, { v: `{{row.${col.key}}}`, s: { bd: 'trbl', wrap: true, align: numeric ? 'right' : undefined } });
  });
  form.repeatRow = 5;
  set(6, 0, { v: 'Всего строк: {{count}}', s: { b: true } });
  set(7, 0, { v: 'Сформировал: {{user.name}}, {{today}}', s: { i: true, size: 9 } });
  return form;
}

// ---------- Изменение листа ----------

const clone = (f: ReportFormContent): ReportFormContent => structuredClone(f);

/** Применить изменение оформления ко всем ячейкам диапазона */
export function patchStyle(
  form: ReportFormContent,
  g: Range,
  patch: (s: FormCellStyle, r: number, c: number) => FormCellStyle,
): ReportFormContent {
  const f = clone(form);
  for (let r = g.r1; r <= g.r2; r++)
    for (let c = g.c1; c <= g.c2; c++) {
      const k = cellKey(r, c);
      const cell = f.cells[k] ?? {};
      const s = clean(patch({ ...(cell.s ?? {}) }, r, c));
      const next: FormCell = { ...cell, s };
      if (!s) delete next.s;
      if (next.v === undefined && !next.s) delete f.cells[k];
      else f.cells[k] = next;
    }
  return f;
}

function clean(s: FormCellStyle): FormCellStyle | undefined {
  const out: FormCellStyle = {};
  for (const [k, v] of Object.entries(s) as Array<[keyof FormCellStyle, unknown]>) {
    if (v === undefined || v === false || v === '' || (k === 'fmt' && v === 'auto')) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export function setValue(form: ReportFormContent, r: number, c: number, v: string): ReportFormContent {
  const f = clone(form);
  const k = cellKey(r, c);
  const cell = { ...(f.cells[k] ?? {}) };
  if (v === '') delete cell.v;
  else cell.v = v;
  if (cell.v === undefined && !cell.s) delete f.cells[k];
  else f.cells[k] = cell;
  return f;
}

/** Вставка прямоугольного блока значений (из буфера обмена) с позиции r, c; лист растёт при необходимости */
export function pasteValues(form: ReportFormContent, r: number, c: number, block: string[][]): ReportFormContent {
  let f = clone(form);
  const needRows = Math.min(LIMITS.rows, r + block.length);
  const needCols = Math.min(LIMITS.cols, c + Math.max(0, ...block.map((x) => x.length)));
  if (needRows > f.rowCount) f.rowCount = needRows;
  if (needCols > f.colCount) {
    f.colWidths = [...f.colWidths, ...Array.from({ length: needCols - f.colCount }, () => DEFAULT_COL_WIDTH)];
    f.colCount = needCols;
  }
  block.forEach((line, i) =>
    line.forEach((v, j) => {
      if (r + i < f.rowCount && c + j < f.colCount) f = setValue(f, r + i, c + j, v);
    }),
  );
  return f;
}

export function clearRange(form: ReportFormContent, g: Range, what: 'values' | 'all' = 'values'): ReportFormContent {
  const f = clone(form);
  for (let r = g.r1; r <= g.r2; r++)
    for (let c = g.c1; c <= g.c2; c++) {
      const k = cellKey(r, c);
      const cell = f.cells[k];
      if (!cell) continue;
      if (what === 'all' || !cell.s) delete f.cells[k];
      else f.cells[k] = { s: cell.s };
    }
  return f;
}

export function mergeRange(form: ReportFormContent, g: Range): ReportFormContent {
  const f = clone(form);
  f.merges = f.merges.filter((m) => !overlaps(g, m));
  if (g.r1 === g.r2 && g.c1 === g.c2) return f;
  f.merges.push({ r: g.r1, c: g.c1, rs: g.r2 - g.r1 + 1, cs: g.c2 - g.c1 + 1 });
  // Как в Excel: остаётся значение левой верхней ячейки
  for (let r = g.r1; r <= g.r2; r++)
    for (let c = g.c1; c <= g.c2; c++) {
      if (r === g.r1 && c === g.c1) continue;
      const k = cellKey(r, c);
      if (f.cells[k]?.v !== undefined) {
        const { s } = f.cells[k];
        if (s) f.cells[k] = { s };
        else delete f.cells[k];
      }
    }
  return f;
}

export function unmergeRange(form: ReportFormContent, g: Range): ReportFormContent {
  const f = clone(form);
  f.merges = f.merges.filter((m) => !overlaps(g, m));
  return f;
}

/** Вставка строк перед строкой at (count > 0) или удаление count строк начиная с at (count < 0) */
export function shiftRows(form: ReportFormContent, at: number, count: number): ReportFormContent {
  const f = clone(form);
  const del = count < 0 ? -count : 0;
  if (count > 0 && f.rowCount + count > LIMITS.rows) return form;
  if (del && f.rowCount - del < 1) return form;
  const move = (r: number): number | null => {
    if (r < at) return r;
    if (count > 0) return r + count;
    if (r < at + del) return null;
    return r - del;
  };
  const cells: Record<string, FormCell> = {};
  for (const [k, cell] of Object.entries(f.cells)) {
    const [r, c] = k.split(':').map(Number);
    const nr = move(r);
    if (nr !== null) cells[cellKey(nr, c)] = cell;
  }
  f.cells = cells;
  const heights: Record<string, number> = {};
  for (const [k, h] of Object.entries(f.rowHeights)) {
    const nr = move(Number(k));
    if (nr !== null) heights[String(nr)] = h;
  }
  f.rowHeights = heights;
  f.merges = f.merges.flatMap((m) => {
    const end = m.r + m.rs - 1;
    if (count > 0) {
      if (m.r >= at) return [{ ...m, r: m.r + count }];
      if (end >= at) return [{ ...m, rs: m.rs + count }];
      return [m];
    }
    const delEnd = at + del - 1;
    if (end < at) return [m];
    if (m.r > delEnd) return [{ ...m, r: m.r - del }];
    const keep = m.rs - (Math.min(end, delEnd) - Math.max(m.r, at) + 1);
    if (keep <= 0) return [];
    const merged = { ...m, r: Math.min(m.r, at), rs: keep };
    return merged.rs === 1 && merged.cs === 1 ? [] : [merged];
  });
  if (f.repeatRow !== null) f.repeatRow = move(f.repeatRow);
  f.rowCount += count;
  return f;
}

/** Вставка столбцов перед at (count > 0) или удаление (count < 0) */
export function shiftCols(form: ReportFormContent, at: number, count: number): ReportFormContent {
  const f = clone(form);
  const del = count < 0 ? -count : 0;
  if (count > 0 && f.colCount + count > LIMITS.cols) return form;
  if (del && f.colCount - del < 1) return form;
  const move = (c: number): number | null => {
    if (c < at) return c;
    if (count > 0) return c + count;
    if (c < at + del) return null;
    return c - del;
  };
  const cells: Record<string, FormCell> = {};
  for (const [k, cell] of Object.entries(f.cells)) {
    const [r, c] = k.split(':').map(Number);
    const nc = move(c);
    if (nc !== null) cells[cellKey(r, nc)] = cell;
  }
  f.cells = cells;
  if (count > 0) f.colWidths.splice(at, 0, ...Array.from({ length: count }, () => DEFAULT_COL_WIDTH));
  else f.colWidths.splice(at, del);
  f.merges = f.merges.flatMap((m) => {
    const end = m.c + m.cs - 1;
    if (count > 0) {
      if (m.c >= at) return [{ ...m, c: m.c + count }];
      if (end >= at) return [{ ...m, cs: m.cs + count }];
      return [m];
    }
    const delEnd = at + del - 1;
    if (end < at) return [m];
    if (m.c > delEnd) return [{ ...m, c: m.c - del }];
    const keep = m.cs - (Math.min(end, delEnd) - Math.max(m.c, at) + 1);
    if (keep <= 0) return [];
    const merged = { ...m, c: Math.min(m.c, at), cs: keep };
    return merged.rs === 1 && merged.cs === 1 ? [] : [merged];
  });
  f.colCount += count;
  return f;
}

/** Границы диапазона: все, внешние, только низ, нет */
export function applyBorders(form: ReportFormContent, g: Range, mode: 'all' | 'outer' | 'bottom' | 'none'): ReportFormContent {
  return patchStyle(form, g, (s, r, c) => {
    let sides = '';
    if (mode === 'all') sides = 'trbl';
    if (mode === 'outer') {
      const own = s.bd ?? '';
      sides = own;
      if (r === g.r1) sides += 't';
      if (r === g.r2) sides += 'b';
      if (c === g.c1) sides += 'l';
      if (c === g.c2) sides += 'r';
    }
    if (mode === 'bottom') sides = (s.bd ?? '') + (r === g.r2 ? 'b' : '');
    const bd = ['t', 'r', 'b', 'l'].filter((x) => sides.includes(x)).join('');
    return { ...s, bd: bd || undefined };
  });
}

/** Разбор вставки из Excel/Google Таблиц (TSV) */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === '\t') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

export function toTsv(form: ReportFormContent, g: Range): string {
  const lines: string[] = [];
  for (let r = g.r1; r <= g.r2; r++) {
    const line: string[] = [];
    for (let c = g.c1; c <= g.c2; c++) {
      const v = form.cells[cellKey(r, c)]?.v ?? '';
      line.push(/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    }
    lines.push(line.join('\t'));
  }
  return lines.join('\n');
}

/** Поля, упомянутые в тексте ячейки */
export const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Текст заполненной ячейки для предпросмотра */
export function renderedText(cell: RenderedCell): string {
  if (cell.v === null) return '';
  if (typeof cell.v === 'number') {
    const n = Math.round(cell.v * 100) / 100;
    return `${String(n).replace('.', ',')}${cell.fmt === 'percent' ? '%' : ''}`;
  }
  return cell.v;
}

export type BlankLayout = 'rooms' | 'types' | 'header-room';

export const BLANK_LAYOUTS: Array<{ value: BlankLayout; label: string; hint: string }> = [
  { value: 'rooms', label: 'Очная: пара + аудитория у каждой группы', hint: 'Как бланки 40.02.04 и 38.02.01' },
  { value: 'types', label: 'Очная: пара + вид занятия + аудитория', hint: 'Как бланки 09.02.07 и 09.02.12' },
  { value: 'header-room', label: 'Заочная: аудитория в шапке группы', hint: 'Как бланки заочного отделения' },
];
