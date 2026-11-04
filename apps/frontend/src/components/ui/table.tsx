import * as React from 'react';
import { cn } from '@/lib/utils';

/* ---------- Ширина колонок: перетаскивание правой границы заголовка ---------- */

const MIN_COL_WIDTH = 48;

/** Ячейки заголовка, ширину которых можно менять: одна строка заголовка без объединённых ячеек */
function headerCells(table: HTMLTableElement): HTMLTableCellElement[] | null {
  const rows = table.tHead?.rows;
  if (!rows || rows.length !== 1) return null;
  const cells = Array.from(rows[0].cells);
  if (!cells.length || cells.some((c) => c.colSpan > 1)) return null;
  return cells;
}

/** Ключ для запоминания ширин: страница + названия колонок */
function widthsKey(cells: HTMLTableCellElement[]) {
  const names = cells.map((c) => (c.textContent ?? '').trim()).join('|');
  return `sm.colw:${window.location.pathname}:${names}`;
}

function applyWidths(table: HTMLTableElement, cells: HTMLTableCellElement[], widths: number[]) {
  cells.forEach((c, i) => (c.style.width = `${widths[i]}px`));
  table.style.tableLayout = 'fixed';
  table.style.width = `${widths.reduce((a, w) => a + w, 0)}px`;
  table.style.minWidth = '100%';
  table.dataset.resized = 'true';
}

function resetWidths(table: HTMLTableElement) {
  const cells = headerCells(table) ?? [];
  cells.forEach((c) => (c.style.width = ''));
  table.style.tableLayout = '';
  table.style.width = '';
  table.style.minWidth = '';
  delete table.dataset.resized;
  try {
    if (cells.length) localStorage.removeItem(widthsKey(cells));
  } catch {
    /* хранилище недоступно */
  }
}

function saveWidths(cells: HTMLTableCellElement[]) {
  try {
    localStorage.setItem(widthsKey(cells), JSON.stringify(cells.map((c) => Math.round(c.getBoundingClientRect().width))));
  } catch {
    /* хранилище недоступно */
  }
}

/** Ручка на правой границе заголовка колонки */
function ColumnResizer() {
  const onPointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const th = e.currentTarget.parentElement as HTMLTableCellElement | null;
    const table = th?.closest('table');
    if (!th || !table) return;
    const cells = headerCells(table);
    const startX = e.clientX;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    let move: (ev: PointerEvent) => void;
    if (cells) {
      // Фиксируем текущие ширины всех колонок и меняем только тянутую
      const widths = cells.map((c) => c.getBoundingClientRect().width);
      const index = cells.indexOf(th);
      const start = widths[index];
      applyWidths(table, cells, widths);
      move = (ev) => {
        widths[index] = Math.max(MIN_COL_WIDTH, start + ev.clientX - startX);
        applyWidths(table, cells, widths);
      };
    } else {
      // Сложный заголовок (несколько строк): меняется ширина одной колонки
      const start = th.getBoundingClientRect().width;
      move = (ev) => {
        const w = Math.max(MIN_COL_WIDTH, start + ev.clientX - startX);
        th.style.width = th.style.minWidth = `${w}px`;
      };
    }
    document.body.classList.add('col-resizing');
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      document.body.classList.remove('col-resizing');
      if (cells) saveWidths(cells);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };
  return (
    <span
      aria-hidden
      data-slot="column-resizer"
      title="Потяните, чтобы изменить ширину колонки. Двойной щелчок — исходная ширина"
      className="col-resizer"
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        const table = e.currentTarget.closest('table');
        if (table) resetWidths(table);
      }}
    />
  );
}

function Table({ className, ...props }: React.ComponentProps<'table'>) {
  const ref = React.useRef<HTMLTableElement>(null);
  // Восстановить ширины колонок, заданные пользователем раньше
  React.useLayoutEffect(() => {
    const table = ref.current;
    const cells = table && headerCells(table);
    if (!table || !cells) return;
    try {
      const saved = JSON.parse(localStorage.getItem(widthsKey(cells)) ?? 'null') as number[] | null;
      if (Array.isArray(saved) && saved.length === cells.length && saved.every((w) => typeof w === 'number' && w > 0)) {
        applyWidths(table, cells, saved);
      }
    } catch {
      /* хранилище недоступно */
    }
  }, []);
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto scrollbar-thin">
      <table ref={ref} data-slot="table" className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('[&_tr]:border-b bg-muted/40', className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return <tfoot data-slot="table-footer" className={cn('bg-muted/50 border-t font-medium [&>tr]:last:border-b-0', className)} {...props} />;
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn('hover:bg-muted/40 data-[state=selected]:bg-muted border-b transition-colors', className)}
      {...props}
    />
  );
}

function TableHead({ className, children, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'text-muted-foreground relative h-9 px-2.5 text-left align-middle text-xs font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    >
      {children}
      <ColumnResizer />
    </th>
  );
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return <td data-slot="table-cell" className={cn('px-2.5 py-2 align-middle [&:has([role=checkbox])]:pr-0', className)} {...props} />;
}

function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return <caption data-slot="table-caption" className={cn('text-muted-foreground mt-4 text-sm', className)} {...props} />;
}

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow };
