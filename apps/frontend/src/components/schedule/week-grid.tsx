import { useMemo, useState, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import { addDays, formatDateShort, isoWeekday, today, weekdayName } from '@/lib/format';
import type { Lesson, LessonTime } from '@/lib/types';
import { cn } from '@/lib/utils';
import { LessonCard, type GridMode } from './lesson-card';

export interface GridColumn {
  key: string;
  /** Дата колонки (для недельной сетки) */
  date: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Причина блокировки (праздник, каникулы) */
  blocked?: string | null;
  /** Фильтр занятий колонки */
  match: (lesson: Lesson) => boolean;
}

interface GridProps {
  columns: GridColumn[];
  lessonTimes: LessonTime[];
  lessonsPerDay: number;
  lessons: Lesson[];
  mode: GridMode;
  editable: boolean;
  onLessonClick: (lesson: Lesson) => void;
  onMove?: (lesson: Lesson, date: string, lessonNumber: number) => void;
  onCellClick?: (date: string, lessonNumber: number, column: GridColumn) => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  /** Разрешать перенос только внутри колонки (сетка дня: колонка = группа) */
  sameColumnOnly?: boolean;
}

function DraggableLesson({
  lesson,
  children,
  disabled,
}: {
  lesson: Lesson;
  children: (props: Record<string, unknown>, dragging: boolean) => ReactNode;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lesson.id, data: { lesson }, disabled });
  return (
    <div ref={setNodeRef} className={cn('min-w-0 flex-1', isDragging && 'opacity-30')}>
      {children({ ...attributes, ...listeners }, isDragging)}
    </div>
  );
}

function DropCell({
  id,
  data,
  blocked,
  children,
  onEmptyClick,
  isToday,
}: {
  id: string;
  data: { date: string; lessonNumber: number; columnKey: string };
  blocked?: string | null;
  children: ReactNode;
  onEmptyClick?: () => void;
  isToday: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, data, disabled: !!blocked });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'group/cell relative flex min-h-[74px] gap-1 border-t border-l p-1',
        blocked && 'bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,var(--muted)_6px,var(--muted)_12px)]',
        isToday && !blocked && 'bg-primary/[0.03]',
        isOver && 'bg-primary/10 ring-primary ring-2 ring-inset',
      )}
    >
      {children}
      {onEmptyClick && !blocked && (
        <button
          type="button"
          onClick={onEmptyClick}
          className="text-muted-foreground hover:text-primary absolute right-1 bottom-1 hidden rounded p-0.5 group-hover/cell:block cursor-pointer"
          aria-label="Добавить занятие"
        >
          <Plus className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** Сетка расписания: строки — пары, столбцы — дни недели или группы */
export function ScheduleGrid({
  columns,
  lessonTimes,
  lessonsPerDay,
  lessons,
  mode,
  editable,
  onLessonClick,
  onMove,
  onCellClick,
  selectedIds,
  onToggleSelect,
  sameColumnOnly,
}: GridProps) {
  const [active, setActive] = useState<Lesson | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const maxLesson = Math.max(lessonsPerDay, ...lessons.map((l) => l.lessonNumber), 1);
  const now = today();

  const byCell = useMemo(() => {
    const map = new Map<string, Lesson[]>();
    for (const col of columns) {
      for (const l of lessons) {
        if (l.date !== col.date || !col.match(l)) continue;
        const key = `${col.key}#${l.lessonNumber}`;
        const list = map.get(key) ?? [];
        list.push(l);
        map.set(key, list);
      }
    }
    for (const list of map.values()) list.sort((a, b) => (a.subgroupNumber ?? 0) - (b.subgroupNumber ?? 0));
    return map;
  }, [columns, lessons]);

  const onDragStart = (e: DragStartEvent) => setActive((e.active.data.current as { lesson: Lesson }).lesson);
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    const lesson = (e.active.data.current as { lesson: Lesson } | undefined)?.lesson;
    const target = e.over?.data.current as { date: string; lessonNumber: number; columnKey: string } | undefined;
    if (!lesson || !target || !onMove) return;
    if (target.date === lesson.date && target.lessonNumber === lesson.lessonNumber) return;
    if (sameColumnOnly) {
      const sourceCol = columns.find((c) => c.date === lesson.date && c.match(lesson));
      if (sourceCol && sourceCol.key !== target.columnKey) return;
    }
    onMove(lesson, target.date, target.lessonNumber);
  };

  const canDrag = (l: Lesson) => editable && !!onMove && (l.status === 'PLANNED' || l.status === 'REPLACED');

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      <div className="bg-card overflow-x-auto rounded-lg border scrollbar-thin">
        <div
          className="grid min-w-[900px]"
          style={{ gridTemplateColumns: `72px repeat(${columns.length}, minmax(${mode === 'day' ? 150 : 130}px, 1fr))` }}
        >
          <div className="bg-muted/40 text-muted-foreground p-2 text-xs font-medium">Пара</div>
          {columns.map((col) => (
            <div
              key={col.key}
              className={cn('bg-muted/40 border-l p-2 text-center', col.date === now && mode !== 'day' && 'bg-primary/10')}
            >
              <div className="text-sm font-semibold">{col.title}</div>
              {col.subtitle && <div className="text-muted-foreground text-xs">{col.subtitle}</div>}
              {col.blocked && <div className="text-destructive truncate text-[10px] font-medium">{col.blocked}</div>}
            </div>
          ))}
          {Array.from({ length: maxLesson }, (_, i) => i + 1).map((n) => {
            const time = lessonTimes.find((t) => t.lessonNumber === n);
            return (
              <div key={n} className="contents">
                <div className="flex flex-col items-center justify-center border-t p-1 text-center">
                  <div className="text-sm font-semibold">{n}</div>
                  {time && (
                    <div className="text-muted-foreground text-[10px] leading-tight">
                      {time.startTime}
                      <br />
                      {time.endTime}
                    </div>
                  )}
                </div>
                {columns.map((col) => {
                  const cell = byCell.get(`${col.key}#${n}`) ?? [];
                  return (
                    <DropCell
                      key={`${col.key}#${n}`}
                      id={`${col.key}#${n}`}
                      data={{ date: col.date, lessonNumber: n, columnKey: col.key }}
                      blocked={col.blocked}
                      isToday={col.date === now}
                      onEmptyClick={editable && onCellClick ? () => onCellClick(col.date, n, col) : undefined}
                    >
                      {cell.map((l) => (
                        <DraggableLesson key={l.id} lesson={l} disabled={!canDrag(l)}>
                          {(props) => (
                            <LessonCard
                              lesson={l}
                              mode={mode}
                              onClick={() => onLessonClick(l)}
                              selected={selectedIds?.has(l.id)}
                              onSelect={onToggleSelect ? () => onToggleSelect(l.id) : undefined}
                              dragHandleProps={props}
                            />
                          )}
                        </DraggableLesson>
                      ))}
                    </DropCell>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <DragOverlay>{active ? <LessonCard lesson={active} mode={mode} className="w-48 rotate-1 shadow-xl" /> : null}</DragOverlay>
    </DndContext>
  );
}

/** Колонки недельной сетки */
export function weekColumns(
  weekStartDate: string,
  workingDays: number[],
  blocked: Record<string, string> = {},
): GridColumn[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStartDate, i))
    .filter((d) => workingDays.includes(isoWeekday(d)))
    .map((d) => ({
      key: d,
      date: d,
      title: weekdayName(isoWeekday(d)),
      subtitle: formatDateShort(d),
      blocked: blocked[d] ?? null,
      match: () => true,
    }));
}
