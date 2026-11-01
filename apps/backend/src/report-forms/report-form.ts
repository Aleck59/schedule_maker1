import { formatDateRu } from '../common/utils/dates';
import type { ReportColumn, ReportTable } from '../reports/reports.service';

/**
 * Форма отчёта — лист «как в Excel»: ячейки с текстом и полями-подстановками {{...}},
 * оформлением, объединениями, ширинами столбцов. Одна строка может быть «повторяющейся»:
 * при выгрузке она размножается по строкам выбранного источника данных (отчёта).
 */

export type HAlign = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'middle' | 'bottom';
export type CellFormat = 'auto' | 'text' | 'number' | 'percent';

export interface FormCellStyle {
  /** Жирный */
  b?: boolean;
  /** Курсив */
  i?: boolean;
  /** Подчёркнутый */
  u?: boolean;
  /** Размер шрифта, пт */
  size?: number;
  align?: HAlign;
  valign?: VAlign;
  /** Перенос по словам */
  wrap?: boolean;
  /** Цвет текста #RRGGBB */
  color?: string;
  /** Заливка #RRGGBB */
  fill?: string;
  /** Границы: набор сторон t, r, b, l */
  bd?: string;
  /** Числовой формат */
  fmt?: CellFormat;
  /** Текст повёрнут на 90° (снизу вверх) — подписи дней недели в бланке */
  rot?: boolean;
  /** Склеивать с такой же соседней ячейкой справа (общая пара у нескольких групп — поток) */
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
  /** Ширины столбцов в знаках (как в Excel) */
  colWidths: number[];
  /** Высоты строк в пунктах; ключ — номер строки с 0 */
  rowHeights: Record<string, number>;
  /** Ячейки; ключ — «строка:столбец» с 0 */
  cells: Record<string, FormCell>;
  merges: FormMerge[];
  /** Номер повторяющейся строки данных (с 0) или null */
  repeatRow: number | null;
  /** Источник данных — тип отчёта (см. REPORT_TYPES) или null */
  dataSource: string | null;
  /** Параметры источника по умолчанию */
  params: Record<string, string>;
  orientation: 'portrait' | 'landscape';
}

export const FORM_LIMITS = { rows: 300, cols: 52, text: 4000, merges: 1000 };

const COLOR = /^#[0-9a-fA-F]{6}$/;
export const PARAM_KEYS = [
  'from',
  'to',
  'programId',
  'semesterId',
  'groupId',
  'teacherId',
  'classroomId',
  'groupIds',
] as const;

export class FormError extends Error {}

const int = (v: unknown, min: number, max: number, label: string): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new FormError(`${label}: ожидается целое число от ${min} до ${max}`);
  }
  return v;
};

function parseStyle(raw: unknown): FormCellStyle | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') throw new FormError('Оформление ячейки задано неверно');
  const s = raw as Record<string, unknown>;
  const out: FormCellStyle = {};
  for (const k of ['b', 'i', 'u', 'wrap', 'rot', 'join'] as const) if (s[k] === true) out[k] = true;
  if (s.size !== undefined) out.size = int(s.size, 6, 48, 'Размер шрифта');
  if (s.align !== undefined) {
    if (!['left', 'center', 'right'].includes(s.align as string))
      throw new FormError('Недопустимое выравнивание');
    out.align = s.align as HAlign;
  }
  if (s.valign !== undefined) {
    if (!['top', 'middle', 'bottom'].includes(s.valign as string))
      throw new FormError('Недопустимое вертикальное выравнивание');
    out.valign = s.valign as VAlign;
  }
  for (const k of ['color', 'fill'] as const) {
    if (s[k] === undefined) continue;
    if (typeof s[k] !== 'string' || !COLOR.test(s[k] as string))
      throw new FormError('Цвет задаётся как #RRGGBB');
    out[k] = (s[k] as string).toUpperCase();
  }
  if (s.bd !== undefined) {
    if (typeof s.bd !== 'string' || !/^[trbl]{0,4}$/.test(s.bd))
      throw new FormError('Границы заданы неверно');
    const sides = ['t', 'r', 'b', 'l'].filter((x) => (s.bd as string).includes(x)).join('');
    if (sides) out.bd = sides;
  }
  if (s.fmt !== undefined) {
    if (!['auto', 'text', 'number', 'percent'].includes(s.fmt as string))
      throw new FormError('Недопустимый формат ячейки');
    if (s.fmt !== 'auto') out.fmt = s.fmt as CellFormat;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Проверка и нормализация формы, присланной клиентом */
export function parseFormContent(raw: unknown, knownSources: string[]): ReportFormContent {
  if (!raw || typeof raw !== 'object') throw new FormError('Форма не задана');
  const f = raw as Record<string, unknown>;
  const rowCount = int(f.rowCount, 1, FORM_LIMITS.rows, 'Число строк');
  const colCount = int(f.colCount, 1, FORM_LIMITS.cols, 'Число столбцов');

  const widthsRaw = Array.isArray(f.colWidths) ? f.colWidths : [];
  const colWidths = Array.from({ length: colCount }, (_, i) => {
    const w = widthsRaw[i];
    return typeof w === 'number' && w >= 1 && w <= 120 ? Math.round(w * 10) / 10 : 12;
  });

  const rowHeights: Record<string, number> = {};
  if (f.rowHeights && typeof f.rowHeights === 'object') {
    for (const [k, v] of Object.entries(f.rowHeights as Record<string, unknown>)) {
      const r = Number(k);
      if (!Number.isInteger(r) || r < 0 || r >= rowCount) continue;
      if (typeof v === 'number' && v >= 6 && v <= 400) rowHeights[String(r)] = Math.round(v);
    }
  }

  const cells: Record<string, FormCell> = {};
  if (f.cells && typeof f.cells === 'object') {
    for (const [key, value] of Object.entries(f.cells as Record<string, unknown>)) {
      const m = /^(\d+):(\d+)$/.exec(key);
      if (!m) throw new FormError(`Неверный адрес ячейки: ${key}`);
      const r = Number(m[1]);
      const c = Number(m[2]);
      if (r >= rowCount || c >= colCount) continue;
      if (!value || typeof value !== 'object') continue;
      const cell = value as Record<string, unknown>;
      const out: FormCell = {};
      if (cell.v !== undefined && cell.v !== null && cell.v !== '') {
        if (typeof cell.v !== 'string') throw new FormError(`Ячейка ${cellName(r, c)}: текст задан неверно`);
        if (cell.v.length > FORM_LIMITS.text)
          throw new FormError(`Ячейка ${cellName(r, c)}: слишком длинный текст`);
        out.v = cell.v;
      }
      const s = parseStyle(cell.s);
      if (s) out.s = s;
      if (out.v !== undefined || out.s) cells[`${r}:${c}`] = out;
    }
  }

  const merges: FormMerge[] = [];
  if (Array.isArray(f.merges)) {
    if (f.merges.length > FORM_LIMITS.merges) throw new FormError('Слишком много объединений');
    const taken = new Set<string>();
    for (const m of f.merges as Array<Record<string, unknown>>) {
      const r = int(m?.r, 0, rowCount - 1, 'Объединение: строка');
      const c = int(m?.c, 0, colCount - 1, 'Объединение: столбец');
      const rs = int(m?.rs, 1, rowCount - r, 'Объединение: высота');
      const cs = int(m?.cs, 1, colCount - c, 'Объединение: ширина');
      if (rs === 1 && cs === 1) continue;
      for (let i = r; i < r + rs; i++)
        for (let j = c; j < c + cs; j++) {
          const k = `${i}:${j}`;
          if (taken.has(k)) throw new FormError(`Объединения пересекаются в ячейке ${cellName(i, j)}`);
          taken.add(k);
        }
      merges.push({ r, c, rs, cs });
    }
  }

  let repeatRow: number | null = null;
  if (f.repeatRow !== undefined && f.repeatRow !== null) {
    repeatRow = int(f.repeatRow, 0, rowCount - 1, 'Повторяющаяся строка');
    const bad = merges.find((m) => m.rs > 1 && m.r <= repeatRow! && m.r + m.rs - 1 >= repeatRow!);
    if (bad)
      throw new FormError(
        `Объединение ${cellName(bad.r, bad.c)} задевает повторяющуюся строку ${repeatRow + 1} по вертикали — объединяйте её ячейки только по горизонтали`,
      );
  }

  let dataSource: string | null = null;
  if (typeof f.dataSource === 'string' && f.dataSource) {
    if (!knownSources.includes(f.dataSource)) throw new FormError('Неизвестный источник данных');
    dataSource = f.dataSource;
  }

  const params: Record<string, string> = {};
  if (f.params && typeof f.params === 'object') {
    for (const k of PARAM_KEYS) {
      const v = (f.params as Record<string, unknown>)[k];
      if (typeof v === 'string' && v.trim() && v.length <= (k === 'groupIds' ? 2000 : 64))
        params[k] = v.trim();
    }
  }

  return {
    version: 1,
    rowCount,
    colCount,
    colWidths,
    rowHeights,
    cells,
    merges,
    repeatRow,
    dataSource,
    params,
    orientation: f.orientation === 'landscape' ? 'landscape' : 'portrait',
  };
}

/** Буквенное имя столбца: 0 → A, 26 → AA */
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

export const cellName = (r: number, c: number) => `${colName(c)}${r + 1}`;

// ---------- Подстановка данных ----------

export interface FormContext {
  /** Общие поля: org.name, today, param.group, report.title, … */
  fields: Record<string, string | number>;
  /** Данные источника или null, если источник не выбран */
  table: ReportTable | null;
  /** Значение по умолчанию для известных, но пустых полей (свободная пара — пустая строка) */
  fallback?: (name: string) => string | number | undefined;
}

export interface RenderedCell {
  v: string | number | null;
  s?: FormCellStyle;
  /** Итоговый формат числа */
  fmt?: 'number' | 'percent';
}

export interface RenderedSheet {
  colWidths: number[];
  rowHeights: Array<number | null>;
  rows: RenderedCell[][];
  merges: FormMerge[];
  orientation: 'portrait' | 'landscape';
  /** Поля, которые не удалось подставить */
  unknownFields: string[];
  /** Лист без строки данных (бланк) — при печати умещается на одну страницу */
  fitPage: boolean;
}

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;
type Value = string | number | null;

function formatValue(v: Value, col?: ReportColumn): string {
  if (v === null || v === undefined) return '';
  if (col?.type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return formatDateRu(v);
  if (col?.type === 'percent' && typeof v === 'number') return `${round(v)}%`;
  if (typeof v === 'number') return String(round(v)).replace('.', ',');
  return v;
}

const round = (n: number) => Math.round(n * 100) / 100;

function aggregate(fn: string, key: string, table: ReportTable): number | null {
  const nums = table.rows.map((r) => r[key]).filter((v): v is number => typeof v === 'number');
  if (!nums.length) return fn === 'sum' ? 0 : null;
  switch (fn) {
    case 'sum':
      return round(nums.reduce((a, b) => a + b, 0));
    case 'avg':
      return round(nums.reduce((a, b) => a + b, 0) / nums.length);
    case 'min':
      return Math.min(...nums);
    case 'max':
      return Math.max(...nums);
    default:
      return null;
  }
}

/** Значение одного поля; undefined — поле неизвестно */
function resolve(
  name: string,
  ctx: FormContext,
  row: { data: Record<string, Value>; index: number } | null,
): { value: Value; col?: ReportColumn } | undefined {
  const table = ctx.table;
  const dot = name.indexOf('.');
  const head = dot > 0 ? name.slice(0, dot) : name;
  const rest = dot > 0 ? name.slice(dot + 1) : '';
  if (head === 'row') {
    if (!row || !table) return undefined;
    if (rest === '#') return { value: row.index + 1 };
    const col = table.columns.find((c) => c.key === rest);
    if (!col) return undefined;
    return { value: row.data[rest] ?? null, col };
  }
  if (table && ['sum', 'avg', 'min', 'max'].includes(head)) {
    const col = table.columns.find((c) => c.key === rest);
    if (!col) return undefined;
    return { value: aggregate(head, rest, table), col: col.type === 'percent' ? col : undefined };
  }
  if (head === 'count' && !rest) return table ? { value: table.rows.length } : undefined;
  if (head === 'summary' && table) {
    const item = table.summary?.find((s) => s.label === rest);
    return item ? { value: item.value } : undefined;
  }
  if (name in ctx.fields) return { value: ctx.fields[name] };
  const fallback = ctx.fallback?.(name);
  if (fallback !== undefined) return { value: fallback };
  return undefined;
}

function renderText(
  text: string,
  ctx: FormContext,
  row: { data: Record<string, Value>; index: number } | null,
  unknown: Set<string>,
): { v: Value; col?: ReportColumn } {
  const single = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/.exec(text);
  if (single) {
    const r = resolve(single[1], ctx, row);
    if (r === undefined) {
      unknown.add(single[1]);
      return { v: text };
    }
    if (typeof r.value === 'number' && r.col?.type !== 'date') return { v: r.value, col: r.col };
    return { v: formatValue(r.value, r.col) };
  }
  const v = text.replace(PLACEHOLDER, (whole, name: string) => {
    const r = resolve(name, ctx, row);
    if (r === undefined) {
      unknown.add(name);
      return whole;
    }
    return formatValue(r.value, r.col);
  });
  return { v };
}

function renderCell(
  cell: FormCell | undefined,
  ctx: FormContext,
  row: { data: Record<string, Value>; index: number } | null,
  unknown: Set<string>,
): RenderedCell {
  if (!cell) return { v: null };
  const out: RenderedCell = { v: null };
  if (cell.s) out.s = cell.s;
  if (cell.v === undefined) return out;
  const { v, col } = renderText(cell.v, ctx, row, unknown);
  const fmt = cell.s?.fmt;
  if (fmt === 'text') {
    out.v = typeof v === 'number' ? formatValue(v, col) : v;
  } else if (typeof v === 'number') {
    out.v = v;
    out.fmt = fmt === 'percent' || (fmt !== 'number' && col?.type === 'percent') ? 'percent' : 'number';
  } else if ((fmt === 'number' || fmt === 'percent') && v !== null && /^-?\d+([.,]\d+)?$/.test(v.trim())) {
    out.v = Number(v.trim().replace(',', '.'));
    out.fmt = fmt;
  } else {
    out.v = v === '' ? null : v;
  }
  return out;
}

/** Заполнение формы данными: повторяющаяся строка размножается по строкам источника */
export function renderForm(form: ReportFormContent, ctx: FormContext): RenderedSheet {
  const unknown = new Set<string>();
  const rows: RenderedCell[][] = [];
  const rowHeights: Array<number | null> = [];
  const merges: FormMerge[] = [];
  const rep = form.repeatRow;
  const dataRows = rep === null ? [] : (ctx.table?.rows ?? []);
  const copies = rep === null ? 1 : dataRows.length;
  /** Сдвиг строк ниже повторяющейся */
  const shift = rep === null ? 0 : copies - 1;

  for (let r = 0; r < form.rowCount; r++) {
    const height = form.rowHeights[String(r)] ?? null;
    if (r === rep) {
      dataRows.forEach((data, index) => {
        rows.push(
          Array.from({ length: form.colCount }, (_, c) =>
            renderCell(form.cells[`${r}:${c}`], ctx, { data, index }, unknown),
          ),
        );
        rowHeights.push(height);
      });
      continue;
    }
    rows.push(
      Array.from({ length: form.colCount }, (_, c) =>
        renderCell(form.cells[`${r}:${c}`], ctx, null, unknown),
      ),
    );
    rowHeights.push(height);
  }

  for (const m of form.merges) {
    if (rep !== null && m.r === rep) {
      for (let i = 0; i < copies; i++) merges.push({ ...m, r: rep + i });
    } else if (rep !== null && m.r > rep) {
      merges.push({ ...m, r: m.r + shift });
    } else {
      merges.push({ ...m });
    }
  }

  joinEqualCells(rows, merges);

  return {
    colWidths: form.colWidths,
    rowHeights,
    rows,
    merges,
    orientation: form.orientation,
    unknownFields: [...unknown],
    fitPage: rep === null,
  };
}

/**
 * Склейка одинаковых ячеек с флагом join в строке: от первой ячейки до конца последней совпадающей
 * (ячейки между ними — например, аудитория первой группы — поглощаются, однострочные объединения
 * внутри заменяются общим). Так общая пара нескольких групп печатается одной строкой,
 * а аудитория остаётся в столбце последней группы.
 */
export function joinEqualCells(rows: RenderedCell[][], merges: FormMerge[]) {
  rows.forEach((cells, r) => {
    const mergeAtCell = (c: number) =>
      merges.find((m) => r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs);
    const joins = cells
      .map((cell, c) => ({ cell, c }))
      .filter(({ cell, c }) => {
        const m = mergeAtCell(c);
        return cell.s?.join && (!m || (m.r === r && m.c === c));
      });
    let i = 0;
    while (i < joins.length) {
      const first = joins[i];
      let j = i;
      while (
        j + 1 < joins.length &&
        first.cell.v !== null &&
        first.cell.v !== '' &&
        joins[j + 1].cell.v === first.cell.v
      )
        j++;
      if (j > i) {
        const lastMerge = mergeAtCell(joins[j].c);
        const end = lastMerge ? lastMerge.c + lastMerge.cs - 1 : joins[j].c;
        const inside = merges.filter(
          (m) => m.r <= r && m.r + m.rs - 1 >= r && m.c <= end && m.c + m.cs - 1 >= first.c,
        );
        const ok = inside.every((m) => m.rs === 1 && m.r === r && m.c >= first.c && m.c + m.cs - 1 <= end);
        if (ok) {
          for (const m of inside) merges.splice(merges.indexOf(m), 1);
          merges.push({ r, c: first.c, rs: 1, cs: end - first.c + 1 });
          for (let c = first.c + 1; c <= end; c++) cells[c] = { v: null, s: cells[c].s };
        }
      }
      i = j + 1;
    }
  });
}
