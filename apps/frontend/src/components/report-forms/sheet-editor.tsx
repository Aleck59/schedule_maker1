import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type Ref } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  Columns3,
  FoldVertical,
  Grid2x2,
  Italic,
  Merge,
  PaintBucket,
  Redo2,
  Repeat,
  Rows3,
  Split,
  Trash2,
  Type,
  Underline,
  Undo2,
  WrapText,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  applyBorders,
  cellKey,
  cellName,
  clearRange,
  colName,
  colPx,
  DEFAULT_FONT_SIZE,
  DEFAULT_ROW_HEIGHT,
  expandRange,
  mergeAt,
  mergeRange,
  normRange,
  parseTsv,
  pasteValues,
  patchStyle,
  pxToChars,
  pxToPt,
  rangeName,
  rowPx,
  setValue,
  shiftCols,
  shiftRows,
  toTsv,
  unmergeRange,
  type CellFormat,
  type FormCell,
  type FormCellStyle,
  type FormMerge,
  type Range,
  type ReportFormContent,
} from '@/lib/report-form';
import { cn } from '@/lib/utils';

export interface SheetEditorHandle {
  /** Вставить текст (поле {{...}}) в активную ячейку */
  insert: (text: string) => void;
  /** Заполнить строку заголовками и следующую — полями данных */
  insertTable: (columns: Array<{ key: string; header: string; width?: number; type?: string }>) => void;
}

interface Pos {
  r: number;
  c: number;
}

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24];
const PALETTE = [
  '#000000', '#434343', '#666666', '#999999', '#D9D9D9', '#FFFFFF',
  '#C00000', '#E69138', '#F1C232', '#6AA84F', '#3C78D8', '#674EA7',
  '#F4CCCC', '#FCE5CD', '#FFF2CC', '#D9EAD3', '#E8EEF7', '#D9D2E9',
];
const HEADER_W = 44;
const HEADER_H = 24;

/** Табличный редактор формы: выделение мышью и клавишами, правка в ячейке и строке формул, вставка из Excel */
export function SheetEditor({
  form,
  onChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  readOnly,
  ref,
}: {
  form: ReportFormContent;
  /** tag — одинаковые подряд изменения (перетаскивание границы) объединяются в один шаг отмены */
  onChange: (next: ReportFormContent, tag?: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  readOnly?: boolean;
  ref?: Ref<SheetEditorHandle>;
}) {
  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: 0 });
  const [focus, setFocus] = useState<Pos>({ r: 0, c: 0 });
  const [editing, setEditing] = useState<{ r: number; c: number; value: string; from: 'cell' | 'bar' } | null>(null);
  const dragging = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const cellInput = useRef<HTMLTextAreaElement>(null);
  const barInput = useRef<HTMLInputElement>(null);

  const sel = useMemo(() => expandRange(normRange(anchor, focus), form.merges), [anchor, focus, form.merges]);
  const active = anchor;
  const activeCell = form.cells[cellKey(active.r, active.c)];
  const activeStyle: FormCellStyle = activeCell?.s ?? {};

  // Лист мог уменьшиться (удаление строк) — держим выделение в его пределах
  useEffect(() => {
    const clamp = (p: Pos) => ({ r: Math.min(p.r, form.rowCount - 1), c: Math.min(p.c, form.colCount - 1) });
    setAnchor((p) => (p.r >= form.rowCount || p.c >= form.colCount ? clamp(p) : p));
    setFocus((p) => (p.r >= form.rowCount || p.c >= form.colCount ? clamp(p) : p));
  }, [form.rowCount, form.colCount]);

  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const focusGrid = () => gridRef.current?.focus({ preventScroll: true });

  /** Правка уже завершена — blur исчезающего поля ввода не должен записать её второй раз */
  const closed = useRef(false);
  useEffect(() => {
    if (editing) closed.current = false;
  }, [editing]);

  const commit = useCallback(
    (move?: Pos) => {
      if (!editing || closed.current) return;
      closed.current = true;
      const prev = form.cells[cellKey(editing.r, editing.c)]?.v ?? '';
      if (editing.value !== prev) onChange(setValue(form, editing.r, editing.c, editing.value));
      setEditing(null);
      if (move) {
        setAnchor(move);
        setFocus(move);
      }
      focusGrid();
    },
    [editing, form, onChange],
  );

  const startEdit = (initial?: string, from: 'cell' | 'bar' = 'cell') => {
    if (readOnly) return;
    const value = initial ?? form.cells[cellKey(active.r, active.c)]?.v ?? '';
    setEditing({ r: active.r, c: active.c, value, from });
  };

  useEffect(() => {
    if (editing?.from !== 'cell') return;
    const el = cellInput.current;
    if (el && document.activeElement !== el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

  const select = (p: Pos, extend = false) => {
    if (editing) commit();
    if (!extend) setAnchor(p);
    setFocus(p);
  };

  const step = (p: Pos, dr: number, dc: number): Pos => {
    // Шаг через объединённую ячейку целиком
    const m = mergeAt(form.merges, p.r, p.c);
    let r = p.r + dr;
    let c = p.c + dc;
    if (m) {
      if (dr > 0) r = m.r + m.rs;
      if (dc > 0) c = m.c + m.cs;
      if (dr < 0) r = m.r - 1;
      if (dc < 0) c = m.c - 1;
    }
    r = Math.max(0, Math.min(form.rowCount - 1, r));
    c = Math.max(0, Math.min(form.colCount - 1, c));
    const target = mergeAt(form.merges, r, c);
    return target ? { r: target.r, c: target.c } : { r, c };
  };

  const apply = (fn: (f: ReportFormContent) => ReportFormContent) => {
    if (readOnly) return;
    if (editing) commit();
    onChange(fn(form));
  };

  const toggle = (k: 'b' | 'i' | 'u' | 'wrap') => {
    const on = !activeStyle[k];
    apply((f) => patchStyle(f, sel, (s) => ({ ...s, [k]: on })));
  };
  const setStyle = (patch: Partial<FormCellStyle>) => apply((f) => patchStyle(f, sel, (s) => ({ ...s, ...patch })));

  const selHasMerge = form.merges.some(
    (m) => m.r >= sel.r1 && m.r <= sel.r2 && m.c >= sel.c1 && m.c <= sel.c2,
  );
  const toggleMerge = () => {
    if (selHasMerge) return apply((f) => unmergeRange(f, sel));
    if (sel.r1 === sel.r2 && sel.c1 === sel.c2) return;
    const rep = form.repeatRow;
    if (rep !== null && sel.r1 !== sel.r2 && sel.r1 <= rep && sel.r2 >= rep) {
      toast.error('Строку данных можно объединять только по горизонтали');
      return;
    }
    apply((f) => mergeRange(f, sel));
  };

  const toggleRepeat = () => {
    const r = active.r;
    if (form.repeatRow === r) return apply((f) => ({ ...f, repeatRow: null }));
    if (form.merges.some((m) => m.rs > 1 && m.r <= r && m.r + m.rs - 1 >= r)) {
      toast.error('В этой строке есть объединение по вертикали — сначала разъедините ячейки');
      return;
    }
    apply((f) => ({ ...f, repeatRow: r }));
  };

  useImperativeHandle(ref, () => ({
    insert: (text: string) => {
      if (readOnly) return;
      if (editing) {
        const el = editing.from === 'cell' ? cellInput.current : barInput.current;
        const start = el?.selectionStart ?? editing.value.length;
        const end = el?.selectionEnd ?? start;
        const value = editing.value.slice(0, start) + text + editing.value.slice(end);
        setEditing({ ...editing, value });
        requestAnimationFrame(() => {
          el?.focus();
          el?.setSelectionRange(start + text.length, start + text.length);
        });
        return;
      }
      const current = form.cells[cellKey(active.r, active.c)]?.v ?? '';
      onChange(setValue(form, active.r, active.c, current ? `${current} ${text}` : text));
      focusGrid();
    },
    insertTable: (columns) => {
      if (readOnly || !columns.length) return;
      if (editing) commit();
      let f = form;
      const r = active.r;
      if (r + 1 >= f.rowCount) f = { ...f, rowCount: Math.min(300, r + 2) };
      const need = active.c + columns.length;
      if (need > f.colCount) {
        f = {
          ...f,
          colWidths: [...f.colWidths, ...Array.from({ length: need - f.colCount }, () => 12)],
          colCount: Math.min(52, need),
        };
      }
      f = structuredClone(f);
      f.merges = f.merges.filter((m) => m.r + m.rs - 1 < r || m.r > r + 1);
      columns.forEach((col, i) => {
        const c = active.c + i;
        if (c >= f.colCount) return;
        const numeric = col.type === 'number' || col.type === 'percent';
        f.cells[cellKey(r, c)] = {
          v: col.header,
          s: { b: true, align: 'center', valign: 'middle', wrap: true, bd: 'trbl', fill: '#E8EEF7' },
        };
        f.cells[cellKey(r + 1, c)] = { v: `{{row.${col.key}}}`, s: { bd: 'trbl', wrap: true, align: numeric ? 'right' : undefined } };
        if (col.width) f.colWidths[c] = col.width;
      });
      f.repeatRow = r + 1;
      onChange(f);
      focusGrid();
    },
  }));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) {
      // Символы, набранные до того, как поле ввода получило фокус, не теряются
      if (e.target === gridRef.current && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const ch = e.key;
        setEditing((ed) => (ed ? { ...ed, value: ed.value + ch } : ed));
      }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    if (mod && (key === 'z' || key === 'я')) {
      e.preventDefault();
      if (e.shiftKey) onRedo();
      else onUndo();
      return;
    }
    if (mod && (key === 'y' || key === 'н')) {
      e.preventDefault();
      onRedo();
      return;
    }
    if (mod && ['b', 'i', 'u', 'и', 'ш', 'г'].includes(key.toLowerCase())) {
      e.preventDefault();
      const map: Record<string, 'b' | 'i' | 'u'> = { b: 'b', i: 'i', u: 'u', и: 'b', ш: 'i', г: 'u' };
      toggle(map[key.toLowerCase()]);
      return;
    }
    if (mod && (key === 'a' || key === 'ф')) {
      e.preventDefault();
      setAnchor({ r: 0, c: 0 });
      setFocus({ r: form.rowCount - 1, c: form.colCount - 1 });
      return;
    }
    if (mod) return;
    const arrows: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (arrows[key]) {
      e.preventDefault();
      const [dr, dc] = arrows[key];
      if (e.shiftKey) setFocus((p) => step(p, dr, dc));
      else select(step(active, dr, dc));
      return;
    }
    if (key === 'Tab') {
      e.preventDefault();
      select(step(active, 0, e.shiftKey ? -1 : 1));
      return;
    }
    if (key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) select(step(active, -1, 0));
      else startEdit();
      return;
    }
    if (key === 'F2') {
      e.preventDefault();
      startEdit();
      return;
    }
    if (key === 'Delete' || key === 'Backspace') {
      e.preventDefault();
      apply((f) => clearRange(f, sel));
      return;
    }
    if (key.length === 1 && !e.altKey) {
      e.preventDefault();
      startEdit(key);
    }
  };

  const onCopy = (e: React.ClipboardEvent, cut = false) => {
    if (editing) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', toTsv(form, sel));
    if (cut) apply((f) => clearRange(f, sel));
  };
  const onPaste = (e: React.ClipboardEvent) => {
    if (editing || readOnly) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    const block = parseTsv(text);
    apply((f) => pasteValues(f, sel.r1, sel.c1, block));
    setAnchor({ r: sel.r1, c: sel.c1 });
    setFocus({
      r: Math.min(form.rowCount - 1 + block.length, sel.r1 + block.length - 1),
      c: Math.min(51, sel.c1 + Math.max(...block.map((b) => b.length)) - 1),
    });
  };

  // Изменение ширины столбца и высоты строки перетаскиванием
  const resize = (kind: 'col' | 'row', index: number, e: React.MouseEvent) => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    const start = kind === 'col' ? e.clientX : e.clientY;
    const initial = kind === 'col' ? colPx(form.colWidths[index]) : rowPx(form.rowHeights[String(index)] ?? DEFAULT_ROW_HEIGHT);
    const move = (ev: MouseEvent) => {
      const delta = (kind === 'col' ? ev.clientX : ev.clientY) - start;
      const px = Math.max(kind === 'col' ? 12 : 10, initial + delta);
      const f = structuredClone(form);
      if (kind === 'col') f.colWidths[index] = Math.min(120, pxToChars(px));
      else f.rowHeights[String(index)] = Math.min(400, pxToPt(px));
      onChange(f, `resize-${kind}-${index}-${start}`);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const fmt = activeStyle.fmt ?? 'auto';
  const barValue = editing ? editing.value : (activeCell?.v ?? '');

  return (
    <div className="bg-card overflow-hidden rounded-2xl border border-border/70 shadow-soft">
      {/* Лента инструментов */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border/70 p-2">
        <Tool title="Отменить (Ctrl+Z)" onClick={onUndo} disabled={!canUndo || readOnly}>
          <Undo2 />
        </Tool>
        <Tool title="Повторить (Ctrl+Y)" onClick={onRedo} disabled={!canRedo || readOnly}>
          <Redo2 />
        </Tool>
        <Sep />
        <select
          aria-label="Размер шрифта"
          title="Размер шрифта"
          className="border-input bg-card h-7 rounded-md border px-1 text-xs"
          value={activeStyle.size ?? DEFAULT_FONT_SIZE}
          disabled={readOnly}
          onChange={(e) => setStyle({ size: Number(e.target.value) === DEFAULT_FONT_SIZE ? undefined : Number(e.target.value) })}
        >
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Tool title="Жирный (Ctrl+B)" active={!!activeStyle.b} onClick={() => toggle('b')} disabled={readOnly}>
          <Bold />
        </Tool>
        <Tool title="Курсив (Ctrl+I)" active={!!activeStyle.i} onClick={() => toggle('i')} disabled={readOnly}>
          <Italic />
        </Tool>
        <Tool title="Подчёркнутый (Ctrl+U)" active={!!activeStyle.u} onClick={() => toggle('u')} disabled={readOnly}>
          <Underline />
        </Tool>
        <ColorTool title="Цвет текста" icon={<Type />} value={activeStyle.color} disabled={readOnly} onPick={(color) => setStyle({ color })} />
        <ColorTool title="Заливка" icon={<PaintBucket />} value={activeStyle.fill} disabled={readOnly} onPick={(fill) => setStyle({ fill })} />
        <Sep />
        <Tool title="По левому краю" active={activeStyle.align === 'left'} onClick={() => setStyle({ align: activeStyle.align === 'left' ? undefined : 'left' })} disabled={readOnly}>
          <AlignLeft />
        </Tool>
        <Tool title="По центру" active={activeStyle.align === 'center'} onClick={() => setStyle({ align: activeStyle.align === 'center' ? undefined : 'center' })} disabled={readOnly}>
          <AlignCenter />
        </Tool>
        <Tool title="По правому краю" active={activeStyle.align === 'right'} onClick={() => setStyle({ align: activeStyle.align === 'right' ? undefined : 'right' })} disabled={readOnly}>
          <AlignRight />
        </Tool>
        <Tool title="По верхнему краю" active={activeStyle.valign === 'top'} onClick={() => setStyle({ valign: activeStyle.valign === 'top' ? undefined : 'top' })} disabled={readOnly}>
          <ArrowUpToLine />
        </Tool>
        <Tool title="По середине" active={activeStyle.valign === 'middle'} onClick={() => setStyle({ valign: activeStyle.valign === 'middle' ? undefined : 'middle' })} disabled={readOnly}>
          <FoldVertical />
        </Tool>
        <Tool title="По нижнему краю" active={activeStyle.valign === 'bottom'} onClick={() => setStyle({ valign: activeStyle.valign === 'bottom' ? undefined : 'bottom' })} disabled={readOnly}>
          <ArrowDownToLine />
        </Tool>
        <Tool title="Переносить по словам" active={!!activeStyle.wrap} onClick={() => toggle('wrap')} disabled={readOnly}>
          <WrapText />
        </Tool>
        <Sep />
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={readOnly}>
            <Button variant="ghost" size="sm" title="Границы" className="h-7 px-2">
              <Grid2x2 /> Границы
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => apply((f) => applyBorders(f, sel, 'all'))}>Все границы</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => apply((f) => applyBorders(f, sel, 'outer'))}>Внешние границы</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => apply((f) => applyBorders(f, sel, 'bottom'))}>Нижняя граница</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => apply((f) => applyBorders(f, sel, 'none'))}>Без границ</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tool title={selHasMerge ? 'Разъединить ячейки' : 'Объединить ячейки'} active={selHasMerge} onClick={toggleMerge} disabled={readOnly} wide>
          {selHasMerge ? <Split /> : <Merge />} {selHasMerge ? 'Разъединить' : 'Объединить'}
        </Tool>
        <select
          aria-label="Формат"
          title="Формат значения"
          className="border-input bg-card h-7 rounded-md border px-1 text-xs"
          value={fmt}
          disabled={readOnly}
          onChange={(e) => setStyle({ fmt: e.target.value as CellFormat })}
        >
          <option value="auto">Формат: авто</option>
          <option value="text">Текст</option>
          <option value="number">Число</option>
          <option value="percent">Процент</option>
        </select>
        <Sep />
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={readOnly}>
            <Button variant="ghost" size="sm" className="h-7 px-2">
              <Rows3 /> Строки
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Строка {active.r + 1}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => apply((f) => shiftRows(f, sel.r1, 1))}>Вставить строку выше</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => apply((f) => shiftRows(f, sel.r2 + 1, 1))}>Вставить строку ниже</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => apply((f) => shiftRows(f, f.rowCount, 10))}>Добавить 10 строк в конец</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => apply((f) => shiftRows(f, sel.r1, -(sel.r2 - sel.r1 + 1)))}>
              <Trash2 /> Удалить {sel.r2 > sel.r1 ? `строки ${sel.r1 + 1}–${sel.r2 + 1}` : 'строку'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={readOnly}>
            <Button variant="ghost" size="sm" className="h-7 px-2">
              <Columns3 /> Столбцы
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Столбец {colName(active.c)}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => apply((f) => shiftCols(f, sel.c1, 1))}>Вставить столбец слева</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => apply((f) => shiftCols(f, sel.c2 + 1, 1))}>Вставить столбец справа</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => apply((f) => shiftCols(f, sel.c1, -(sel.c2 - sel.c1 + 1)))}>
              <Trash2 /> Удалить {sel.c2 > sel.c1 ? `столбцы ${colName(sel.c1)}–${colName(sel.c2)}` : 'столбец'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tool
          title="Строка данных: при выгрузке повторяется для каждой записи источника"
          active={form.repeatRow === active.r}
          onClick={toggleRepeat}
          disabled={readOnly}
          wide
        >
          <Repeat /> Строка данных
        </Tool>
      </div>

      {/* Строка формул */}
      <div className="flex items-center gap-2 border-b border-border/70 px-2 py-1.5">
        <div className="bg-muted/60 w-24 shrink-0 rounded-md px-2 py-1 text-center font-mono text-xs tabular-nums">{rangeName(sel)}</div>
        <span className="text-muted-foreground font-serif text-sm italic">fx</span>
        <input
          ref={barInput}
          aria-label="Содержимое ячейки"
          className="h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm outline-none focus:border-primary/40 focus:bg-card"
          value={barValue}
          readOnly={readOnly}
          placeholder={readOnly ? '' : 'Текст ячейки, поля вставляются как {{row.teacher}}'}
          onFocus={() => {
            if (!editing && !readOnly) setEditing({ r: active.r, c: active.c, value: activeCell?.v ?? '', from: 'bar' });
          }}
          onChange={(e) => {
            const value = e.target.value;
            setEditing((ed) => (ed ? { ...ed, value } : ed));
          }}
          onBlur={() => editing?.from === 'bar' && commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit(step(active, 1, 0));
            } else if (e.key === 'Escape') {
              closed.current = true;
              setEditing(null);
              focusGrid();
            }
          }}
        />
      </div>

      {/* Лист */}
      <div
        ref={gridRef}
        tabIndex={0}
        role="grid"
        aria-label="Лист формы"
        className="relative isolate max-h-[68vh] overflow-auto outline-none select-none"
        onKeyDown={onKeyDown}
        onCopy={(e) => onCopy(e)}
        onCut={(e) => onCopy(e, true)}
        onPaste={onPaste}
      >
        <table className="border-separate border-spacing-0 text-[13px]" style={{ tableLayout: 'fixed', width: HEADER_W + form.colWidths.reduce((a, w) => a + colPx(w), 0) }}>
          <colgroup>
            <col style={{ width: HEADER_W }} />
            {form.colWidths.map((w, c) => (
              <col key={c} style={{ width: colPx(w) }} />
            ))}
          </colgroup>
          <thead>
            <tr style={{ height: HEADER_H }}>
              <th
                className="bg-muted sticky top-0 left-0 z-30 border-r border-b border-border"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setAnchor({ r: 0, c: 0 });
                  setFocus({ r: form.rowCount - 1, c: form.colCount - 1 });
                  focusGrid();
                }}
                title="Выделить всё"
              />
              {form.colWidths.map((_, c) => (
                <th
                  key={c}
                  className={cn(
                    'bg-muted text-muted-foreground sticky top-0 z-20 border-r border-b border-border text-xs font-medium',
                    c >= sel.c1 && c <= sel.c2 && 'bg-[color-mix(in_oklch,var(--primary)_14%,var(--muted))] text-primary',
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (editing) commit();
                    if (!e.shiftKey) setAnchor({ r: 0, c });
                    else setAnchor((p) => ({ r: 0, c: p.c }));
                    setFocus({ r: form.rowCount - 1, c });
                    focusGrid();
                  }}
                >
                  <div className="relative">
                    {colName(c)}
                    <span
                      className="absolute -right-1 top-[-6px] bottom-[-6px] w-2 cursor-col-resize hover:bg-primary/30"
                      onMouseDown={(e) => resize('col', c, e)}
                    />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: form.rowCount }, (_, r) => (
              <SheetRow
                key={r}
                r={r}
                form={form}
                sel={r >= sel.r1 && r <= sel.r2 ? sel : null}
                activeC={r === active.r ? active.c : -1}
                activeR={active.r}
                editing={editing && editing.r === r && editing.from === 'cell' ? editing : null}
                inputRef={cellInput}
                onDraft={(value) => setEditing((ed) => (ed ? { ...ed, value } : ed))}
                onCommit={commit}
                onCancel={() => {
                  closed.current = true;
                  setEditing(null);
                  focusGrid();
                }}
                step={step}
                onCellDown={(pos, shift) => {
                  dragging.current = true;
                  select(pos, shift);
                  focusGrid();
                }}
                onCellEnter={(pos) => dragging.current && setFocus(pos)}
                onCellDouble={(pos) => {
                  setAnchor(pos);
                  setFocus(pos);
                  if (!readOnly) setEditing({ ...pos, value: form.cells[cellKey(pos.r, pos.c)]?.v ?? '', from: 'cell' });
                }}
                onRowHeader={(row, shift) => {
                  if (editing) commit();
                  if (!shift) setAnchor({ r: row, c: 0 });
                  else setAnchor((p) => ({ r: p.r, c: 0 }));
                  setFocus({ r: row, c: form.colCount - 1 });
                  focusGrid();
                }}
                onRowResize={(e) => resize('row', r, e)}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 border-t border-border/70 px-3 py-1.5 text-xs">
        <span>
          {form.rowCount} × {form.colCount}
        </span>
        <span>Двойной щелчок или Enter — правка, Delete — очистить, Ctrl+C / Ctrl+V — копирование, в том числе из Excel</span>
        {form.repeatRow !== null && (
          <span className="text-primary">
            <Repeat className="inline size-3" /> Строка {form.repeatRow + 1} повторяется для каждой записи
          </span>
        )}
      </div>
    </div>
  );
}

function Tool({
  title,
  active,
  onClick,
  disabled,
  children,
  wide,
}: {
  title: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn('h-7', wide ? 'px-2' : 'w-7 px-0', active && 'bg-primary/12 text-primary hover:bg-primary/18')}
    >
      {children}
    </Button>
  );
}

const Sep = () => <span className="bg-border mx-1 h-5 w-px" />;

function ColorTool({
  title,
  icon,
  value,
  onPick,
  disabled,
}: {
  title: string;
  icon: React.ReactNode;
  value?: string;
  onPick: (v: string | undefined) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <Button type="button" variant="ghost" size="sm" title={title} aria-label={title} className="relative h-7 w-7 px-0" onMouseDown={(e) => e.preventDefault()}>
          {icon}
          <span className="absolute right-1 bottom-0.5 left-1 h-[3px] rounded-full" style={{ background: value ?? 'transparent', boxShadow: value ? undefined : 'inset 0 0 0 1px var(--border)' }} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="text-muted-foreground mb-1.5 text-xs">{title}</div>
        <div className="grid grid-cols-6 gap-1">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              className={cn('size-6 cursor-pointer rounded-md border border-black/10 transition-transform hover:scale-110', value === c && 'ring-primary ring-2')}
              style={{ background: c }}
              onClick={() => {
                onPick(c);
                setOpen(false);
              }}
            />
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onPick(undefined);
              setOpen(false);
            }}
          >
            Нет
          </Button>
          <label className="text-muted-foreground flex cursor-pointer items-center gap-1.5 text-xs">
            Другой
            <input type="color" className="size-6 cursor-pointer" value={value ?? '#000000'} onChange={(e) => onPick(e.target.value.toUpperCase())} />
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------- Строка листа ----------

function borderSides(form: ReportFormContent, r: number, c: number, m?: FormMerge) {
  const lastR = m ? m.r + m.rs - 1 : r;
  const lastC = m ? m.c + m.cs - 1 : c;
  const bd = (rr: number, cc: number) => form.cells[cellKey(rr, cc)]?.s?.bd ?? '';
  return {
    t: bd(r, c).includes('t') || bd(r - 1, c).includes('b'),
    l: bd(r, c).includes('l') || bd(r, c - 1).includes('r'),
    b: bd(lastR, lastC).includes('b') || bd(lastR + 1, lastC).includes('t'),
    r: bd(lastR, lastC).includes('r') || bd(lastR, lastC + 1).includes('l'),
  };
}

export function cellCss(s: FormCellStyle | undefined): CSSProperties {
  return {
    fontWeight: s?.b ? 700 : undefined,
    fontStyle: s?.i ? 'italic' : undefined,
    textDecoration: s?.u ? 'underline' : undefined,
    fontSize: s?.size ? `${Math.round(s.size * (4 / 3))}px` : undefined,
    textAlign: s?.align,
    verticalAlign: s?.valign ?? 'bottom',
    whiteSpace: s?.wrap ? 'pre-wrap' : 'pre',
    color: s?.color,
    background: s?.fill,
  };
}

const LINE = '1px solid #1f2937';
const GRID = '1px solid color-mix(in oklch, var(--border) 85%, transparent)';

const SheetRow = memo(function SheetRow({
  r,
  form,
  sel,
  activeC,
  activeR,
  editing,
  inputRef,
  onDraft,
  onCommit,
  onCancel,
  step,
  onCellDown,
  onCellEnter,
  onCellDouble,
  onRowHeader,
  onRowResize,
}: {
  r: number;
  form: ReportFormContent;
  sel: Range | null;
  activeC: number;
  activeR: number;
  editing: { r: number; c: number; value: string } | null;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onDraft: (v: string) => void;
  onCommit: (move?: Pos) => void;
  onCancel: () => void;
  step: (p: Pos, dr: number, dc: number) => Pos;
  onCellDown: (p: Pos, shift: boolean) => void;
  onCellEnter: (p: Pos) => void;
  onCellDouble: (p: Pos) => void;
  onRowHeader: (r: number, shift: boolean) => void;
  onRowResize: (e: React.MouseEvent) => void;
}) {
  const height = rowPx(form.rowHeights[String(r)] ?? DEFAULT_ROW_HEIGHT);
  const repeat = form.repeatRow === r;
  const tds: React.ReactNode[] = [];
  for (let c = 0; c < form.colCount; c++) {
    const m = mergeAt(form.merges, r, c);
    if (m && (m.r !== r || m.c !== c)) continue;
    const cell: FormCell | undefined = form.cells[cellKey(r, c)];
    const sides = borderSides(form, r, c, m);
    const inSel = !!sel && c >= sel.c1 && c <= sel.c2;
    const isActive = activeC === c || (m && activeR >= m.r && activeR < m.r + m.rs && activeC >= m.c && activeC < m.c + m.cs);
    const isEditing = editing && editing.c === c;
    // Как в Excel: текст без переноса заходит на соседнюю пустую ячейку
    const spill = !isEditing && !m && !cell?.s?.wrap && !sides.r && !form.cells[cellKey(r, c + 1)]?.v;
    const style: CSSProperties = {
      ...cellCss(cell?.s),
      height,
      borderTop: sides.t ? LINE : undefined,
      borderLeft: sides.l ? LINE : undefined,
      borderBottom: sides.b ? LINE : GRID,
      borderRight: sides.r ? LINE : GRID,
      background: cell?.s?.fill ?? (repeat ? 'color-mix(in oklch, var(--primary) 6%, transparent)' : undefined),
    };
    tds.push(
      <td
        key={c}
        rowSpan={m?.rs}
        colSpan={m?.cs}
        data-cell={cellName(r, c)}
        className={cn('relative px-1 leading-tight', spill ? 'overflow-visible' : 'overflow-hidden text-ellipsis')}
        style={style}
        onMouseDown={(e) => {
          if (e.button !== 0 || isEditing) return;
          e.preventDefault();
          onCellDown({ r, c }, e.shiftKey);
        }}
        onMouseEnter={() => onCellEnter({ r, c })}
        onDoubleClick={() => onCellDouble({ r, c })}
      >
        {inSel && <span className="bg-primary/10 pointer-events-none absolute inset-0" />}
        {isActive && !isEditing && <span className="border-primary pointer-events-none absolute inset-0 z-[1] border-2" />}
        {isEditing ? (
          <textarea
            ref={inputRef}
            aria-label={`Ячейка ${cellName(r, c)}`}
            className="border-primary bg-card absolute inset-0 z-10 min-h-full w-full resize-none border-2 px-1 outline-none"
            style={{ ...cellCss(cell?.s), background: 'var(--card)', whiteSpace: 'pre-wrap', minWidth: 120 }}
            value={editing.value}
            onChange={(e) => onDraft(e.target.value)}
            onBlur={() => onCommit()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.altKey && !e.shiftKey) {
                e.preventDefault();
                onCommit(step({ r, c }, 1, 0));
              } else if (e.key === 'Tab') {
                e.preventDefault();
                onCommit(step({ r, c }, 0, e.shiftKey ? -1 : 1));
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
              }
            }}
          />
        ) : (
          <CellText text={cell?.v} />
        )}
      </td>,
    );
  }
  return (
    <tr>
      <th
        className={cn(
          'bg-muted text-muted-foreground sticky left-0 z-10 border-r border-b border-border px-1 text-[11px] font-medium tabular-nums',
          sel && 'bg-[color-mix(in_oklch,var(--primary)_14%,var(--muted))] text-primary',
          repeat && 'text-primary',
        )}
        style={{ height }}
        title={repeat ? 'Строка данных: повторяется для каждой записи источника' : undefined}
        onMouseDown={(e) => {
          e.preventDefault();
          onRowHeader(r, e.shiftKey);
        }}
      >
        <div className="relative flex items-center justify-center gap-0.5">
          {repeat && <Repeat className="size-3" />}
          {r + 1}
          <span className="absolute right-[-4px] -bottom-1 left-[-4px] h-2 cursor-row-resize hover:bg-primary/30" onMouseDown={onRowResize} />
        </div>
      </th>
      {tds}
    </tr>
  );
});

/** Текст ячейки с подсветкой полей {{...}} */
function CellText({ text }: { text?: string }) {
  if (!text) return null;
  const parts = text.split(/(\{\{[^{}]+\}\})/g);
  return (
    <>
      {parts.map((p, i) =>
        /^\{\{[^{}]+\}\}$/.test(p) ? (
          <span key={i} className="bg-primary/10 text-primary rounded px-0.5 font-mono text-[0.92em]">
            {p.slice(2, -2).trim()}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
