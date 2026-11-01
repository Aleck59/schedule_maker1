import ExcelJS from 'exceljs';
import type { FormCellStyle, RenderedCell, RenderedSheet } from './report-form';

const BORDER_COLOR = { argb: 'FF000000' };
const argb = (hex: string) => `FF${hex.slice(1).toUpperCase()}`;

function excelBorder(bd: string | undefined): Partial<ExcelJS.Borders> | undefined {
  if (!bd) return undefined;
  const side = { style: 'thin' as const, color: BORDER_COLOR };
  const out: Partial<ExcelJS.Borders> = {};
  if (bd.includes('t')) out.top = side;
  if (bd.includes('r')) out.right = side;
  if (bd.includes('b')) out.bottom = side;
  if (bd.includes('l')) out.left = side;
  return out;
}

const DEFAULT_FONT_SIZE = 11;

/** Лист Excel по заполненной форме: ширины, высоты, объединения и оформление сохраняются */
export async function formToExcel(sheet: RenderedSheet, title: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Расписание СПО и ВО';
  wb.created = new Date();
  const ws = wb.addWorksheet(title.replace(/[\\/?*[\]:]/g, '-').slice(0, 28) || 'Отчёт', {
    pageSetup: {
      paperSize: 9,
      orientation: sheet.orientation,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: sheet.fitPage ? 1 : 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });
  sheet.colWidths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  sheet.rows.forEach((cells, r) => {
    const row = ws.getRow(r + 1);
    const h = sheet.rowHeights[r];
    if (h) row.height = h;
    cells.forEach((cell, c) => {
      if (cell.v === null && !cell.s) return;
      const target = row.getCell(c + 1);
      if (cell.v !== null) {
        target.value = cell.fmt === 'percent' && typeof cell.v === 'number' ? cell.v / 100 : cell.v;
      }
      if (cell.fmt === 'percent') target.numFmt = '0.0%';
      else if (cell.fmt === 'number' && typeof cell.v === 'number' && !Number.isInteger(cell.v))
        target.numFmt = '0.0#';
      const s = cell.s;
      if (!s) return;
      target.font = {
        name: 'Times New Roman',
        size: s.size ?? DEFAULT_FONT_SIZE,
        bold: s.b,
        italic: s.i,
        underline: s.u,
        color: s.color ? { argb: argb(s.color) } : undefined,
      };
      if (s.align || s.valign || s.wrap || s.rot) {
        target.alignment = {
          horizontal: s.align,
          vertical: s.valign,
          wrapText: s.wrap,
          textRotation: s.rot ? 90 : undefined,
        };
      }
      if (s.fill) target.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(s.fill) } };
      const border = excelBorder(s.bd);
      if (border) target.border = border;
    });
    // Ячейки без оформления — тоже Times New Roman, как в бланках колледжа
    cells.forEach((cell, c) => {
      if (!cell.s && cell.v !== null)
        row.getCell(c + 1).font = { name: 'Times New Roman', size: DEFAULT_FONT_SIZE };
    });
  });
  for (const m of sheet.merges) ws.mergeCells(m.r + 1, m.c + 1, m.r + m.rs, m.c + m.cs);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Текст ячейки для PDF и HTML-предпросмотра */
export function cellText(cell: RenderedCell): string {
  if (cell.v === null) return '';
  if (typeof cell.v === 'number') {
    const n = Math.round(cell.v * 100) / 100;
    return `${String(n).replace('.', ',')}${cell.fmt === 'percent' ? '%' : ''}`;
  }
  return cell.v;
}

/** Ширина знака Excel в пунктах (шрифт 11 пт) */
const CHAR_PT = 5.6;

/** Описание документа pdfmake по заполненной форме */
export function formToPdfDefinition(
  sheet: RenderedSheet,
  title: string,
  shrink = 1,
): Record<string, unknown> {
  const pageWidth = sheet.orientation === 'landscape' ? 842 : 595;
  const margin = 24;
  const natural = sheet.colWidths.reduce((a, w) => a + w * CHAR_PT, 0);
  const pageHeight = sheet.orientation === 'landscape' ? 595 : 842;
  // Бланк умещается на одну страницу и по высоте (строки без высоты — около 15 пт)
  const rowNeed = (r: number) => {
    let need = sheet.rowHeights[r] ?? 15;
    sheet.rows[r].forEach((cell, c) => {
      if (cell.v === null || cell.s?.rot) return;
      const span = spansAt(c, r);
      const widthPt = sheet.colWidths.slice(c, c + span).reduce((a, w) => a + w * CHAR_PT, 0);
      const size = cell.s?.size ?? DEFAULT_FONT_SIZE;
      const lines = String(cellText(cell))
        .split('\n')
        .reduce(
          (a, line) =>
            a +
            (cell.s?.wrap ? Math.max(1, Math.ceil((line.length * size * 0.5) / Math.max(widthPt, 1))) : 1),
          0,
        );
      need = Math.max(need, lines * size * 1.2 + 3);
    });
    return need;
  };
  const spansAt = (c: number, r: number) =>
    sheet.merges.find((m) => m.r === r && m.c === c && m.rs === 1)?.cs ?? 1;
  const naturalHeight = sheet.rows.reduce<number>((a, _, r) => a + rowNeed(r) + 1, 0);
  const scale =
    shrink *
    Math.min(
      1,
      (pageWidth - margin * 2) / Math.max(natural, 1),
      sheet.fitPage ? (pageHeight - margin * 2 - 12) / Math.max(naturalHeight, 1) : 1,
    );
  // Ширина — во всю страницу, шрифт и высота строк — с общим масштабом
  const widthScale = Math.min(1, (pageWidth - margin * 2) / Math.max(natural, 1));
  const widths = sheet.colWidths.map((w) => Math.max(4, w * CHAR_PT * widthScale - 4));

  const covered = new Set<string>();
  const spans = new Map<string, { rs: number; cs: number }>();
  for (const m of sheet.merges) {
    spans.set(`${m.r}:${m.c}`, { rs: m.rs, cs: m.cs });
    for (let i = m.r; i < m.r + m.rs; i++)
      for (let j = m.c; j < m.c + m.cs; j++) if (i !== m.r || j !== m.c) covered.add(`${i}:${j}`);
  }

  // Как в Excel: длинный текст без переноса заходит на пустые ячейки справа
  sheet.rows.forEach((cells, r) =>
    cells.forEach((cell, c) => {
      const key = `${r}:${c}`;
      if (covered.has(key) || spans.has(key) || cell.s?.wrap || typeof cell.v !== 'string' || !cell.v) return;
      const need = (cell.v.length * (cell.s?.size ?? DEFAULT_FONT_SIZE)) / DEFAULT_FONT_SIZE;
      let width = sheet.colWidths[c];
      let cs = 1;
      while (width < need && c + cs < cells.length) {
        const next = cells[c + cs];
        const nextKey = `${r}:${c + cs}`;
        if (next.v !== null || covered.has(nextKey) || spans.has(nextKey)) break;
        width += sheet.colWidths[c + cs];
        cs++;
      }
      if (cs === 1) return;
      spans.set(key, { rs: 1, cs });
      for (let j = c + 1; j < c + cs; j++) covered.add(`${r}:${j}`);
    }),
  );

  const styleOf = (r: number, c: number): FormCellStyle | undefined => sheet.rows[r]?.[c]?.s;
  /** Граница стороны: своя или соседней ячейки (как Excel рисует общую линию) */
  const side = (r: number, c: number, s: 't' | 'r' | 'b' | 'l') => {
    if (styleOf(r, c)?.bd?.includes(s)) return true;
    if (s === 't') return !!styleOf(r - 1, c)?.bd?.includes('b');
    if (s === 'b') return !!styleOf(r + 1, c)?.bd?.includes('t');
    if (s === 'l') return !!styleOf(r, c - 1)?.bd?.includes('r');
    return !!styleOf(r, c + 1)?.bd?.includes('l');
  };

  const body = sheet.rows.map((cells, r) =>
    cells.map((cell, c) => {
      if (covered.has(`${r}:${c}`)) return {};
      const span = spans.get(`${r}:${c}`);
      const s = cell.s ?? {};
      // Граница объединённой ячейки — по её крайним ячейкам
      const lastR = r + (span?.rs ?? 1) - 1;
      const lastC = c + (span?.cs ?? 1) - 1;
      const out: Record<string, unknown> = {
        text: cellText(cell),
        fontSize: Math.max(5, (s.size ?? DEFAULT_FONT_SIZE) * scale),
        bold: !!s.b,
        italics: !!s.i,
        decoration: s.u ? 'underline' : undefined,
        color: s.color,
        fillColor: s.fill,
        alignment: s.align ?? (typeof cell.v === 'number' ? 'right' : 'left'),
        border: [side(r, c, 'l'), side(r, c, 't'), side(lastR, lastC, 'r'), side(lastR, lastC, 'b')],
      };
      if (s.rot && out.text) {
        // pdfmake не поворачивает текст — подпись дня рисуется SVG-картинкой
        const w = widths.slice(c, lastC + 1).reduce((a, b) => a + b, 0) + 4 * (lastC - c);
        const h = Array.from(
          { length: lastR - r + 1 },
          (_, k) => (sheet.rowHeights[r + k] ?? 15) * scale,
        ).reduce((a, b) => a + b, 0);
        const fontSize = out.fontSize as number;
        delete out.text;
        out.svg = verticalSvg(cellText(cell), Math.max(8, w), Math.max(20, h - 2), fontSize, !!s.b);
        out.width = Math.max(8, w);
      }
      if (span) {
        if (span.cs > 1) out.colSpan = span.cs;
        if (span.rs > 1) out.rowSpan = span.rs;
      }
      return out;
    }),
  );

  const heights = sheet.rowHeights.map((h) => (h ? h * scale : 'auto'));
  return {
    pageOrientation: sheet.orientation,
    pageSize: 'A4',
    pageMargins: [margin, margin, margin, margin],
    info: { title },
    content: body.length
      ? [
          {
            table: { widths, body, heights: (i: number) => heights[i] },
            layout: {
              hLineWidth: () => 0.6,
              vLineWidth: () => 0.6,
              hLineColor: () => '#000000',
              vLineColor: () => '#000000',
              paddingLeft: () => 2,
              paddingRight: () => 2,
              paddingTop: () => 1,
              paddingBottom: () => 1,
            },
          },
        ]
      : [{ text: '' }],
    footer: (current: number, total: number) =>
      total > 1
        ? {
            text: `стр. ${current} из ${total}`,
            alignment: 'right',
            fontSize: 7,
            margin: [margin, 6, margin, 0],
          }
        : undefined,
  };
}

const xml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Текст, повёрнутый на 90° (читается снизу вверх), строки — по ширине ячейки */
function verticalSvg(text: string, width: number, height: number, size: number, bold: boolean): string {
  const lines = text.split('\n');
  const lineH = size * 1.15;
  const x0 = width / 2 - ((lines.length - 1) * lineH) / 2 + size * 0.35;
  const parts = lines
    .map(
      (line, i) =>
        `<text transform="translate(${(x0 + i * lineH).toFixed(1)},${(height / 2).toFixed(1)}) rotate(-90)" text-anchor="middle" font-family="Roboto" font-size="${size.toFixed(1)}"${bold ? ' font-weight="bold"' : ''}>${xml(line)}</text>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(1)}" height="${height.toFixed(1)}">${parts}</svg>`;
}

/** Число страниц готового PDF */
export function pdfPageCount(buffer: Buffer): number {
  return (buffer.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
}

/** PDF формы; бланк (без строки данных) при необходимости ужимается, пока не встанет на одну страницу */
export async function formToPdf(
  sheet: RenderedSheet,
  title: string,
  render: (def: Record<string, unknown>) => Promise<Buffer>,
): Promise<Buffer> {
  let shrink = 1;
  let buffer = await render(formToPdfDefinition(sheet, title, shrink));
  for (let i = 0; sheet.fitPage && i < 6 && pdfPageCount(buffer) > 1; i++) {
    shrink *= 0.9;
    buffer = await render(formToPdfDefinition(sheet, title, shrink));
  }
  return buffer;
}
