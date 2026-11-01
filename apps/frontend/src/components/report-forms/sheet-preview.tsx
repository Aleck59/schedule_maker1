import type { CSSProperties } from 'react';
import { cellKey, colPx, DEFAULT_ROW_HEIGHT, renderedText, rowPx, type RenderedSheet } from '@/lib/report-form';
import { cn } from '@/lib/utils';
import { cellCss } from './sheet-editor';

const LINE = '1px solid #1f2937';

/** Заполненная форма в виде листа — так она выйдет в Excel и PDF */
export function SheetPreview({ sheet }: { sheet: RenderedSheet }) {
  const covered = new Set<string>();
  const spans = new Map<string, { rs: number; cs: number }>();
  for (const m of sheet.merges) {
    spans.set(cellKey(m.r, m.c), m);
    for (let i = m.r; i < m.r + m.rs; i++)
      for (let j = m.c; j < m.c + m.cs; j++) if (i !== m.r || j !== m.c) covered.add(cellKey(i, j));
  }
  const bd = (r: number, c: number) => sheet.rows[r]?.[c]?.s?.bd ?? '';
  return (
    <div className="max-h-[70vh] overflow-auto rounded-xl border border-border/70 bg-white p-4 text-black shadow-inner">
      <table
        className="border-collapse text-[13px]"
        style={{ tableLayout: 'fixed', width: sheet.colWidths.reduce((a, w) => a + colPx(w), 0), fontFamily: '"Times New Roman", serif' }}
      >
        <colgroup>
          {sheet.colWidths.map((w, c) => (
            <col key={c} style={{ width: colPx(w) }} />
          ))}
        </colgroup>
        <tbody>
          {sheet.rows.map((cells, r) => (
            <tr key={r} style={{ height: rowPx(sheet.rowHeights[r] ?? DEFAULT_ROW_HEIGHT) }}>
              {cells.map((cell, c) => {
                if (covered.has(cellKey(r, c))) return null;
                const span = spans.get(cellKey(r, c));
                const lr = r + (span?.rs ?? 1) - 1;
                const lc = c + (span?.cs ?? 1) - 1;
                const style: CSSProperties = {
                  ...cellCss(cell.s),
                  textAlign: cell.s?.align ?? (typeof cell.v === 'number' ? 'right' : undefined),
                  whiteSpace: cell.s?.wrap ? 'pre-wrap' : 'pre',
                  borderTop: bd(r, c).includes('t') || bd(r - 1, c).includes('b') ? LINE : undefined,
                  borderLeft: bd(r, c).includes('l') || bd(r, c - 1).includes('r') ? LINE : undefined,
                  borderBottom: bd(lr, lc).includes('b') || bd(lr + 1, lc).includes('t') ? LINE : undefined,
                  borderRight: bd(lr, lc).includes('r') || bd(lr, lc + 1).includes('l') ? LINE : undefined,
                };
                return (
                  <td key={c} rowSpan={span?.rs} colSpan={span?.cs} className={cn('px-1 leading-tight', !span && !cell.s?.wrap && !style.borderRight && cells[c + 1]?.v == null ? 'overflow-visible' : 'overflow-hidden')} style={style}>
                    {renderedText(cell)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {sheet.rows.length === 0 && <div className="text-sm text-gray-500">Форма пуста</div>}
    </div>
  );
}
