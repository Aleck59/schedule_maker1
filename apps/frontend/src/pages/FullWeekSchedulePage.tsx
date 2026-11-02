import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  DragOverlay,
  defaultDropAnimationSideEffects,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DropAnimation,
} from '@dnd-kit/core';
import { ArrowLeft, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/common/page-header';
import { SimpleSelect } from '@/components/common/simple-select';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import {
  buildRowSegments,
  indexLessons,
  sortGroupsForFullWeek,
  visibleInFullWeek,
  type FullWeekSegment,
} from '@/components/schedule/full-week';
import { LessonCard, LessonTypeLegend } from '@/components/schedule/lesson-card';
import { LessonDialog } from '@/components/schedule/lesson-dialog';
import { useLessonMove } from '@/components/schedule/lesson-move';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useGroups, usePeriods, useSettings } from '@/hooks/use-reference';
import { useAuth } from '@/lib/auth';
import { addDays, formatDate, formatDateShort, isoWeekday, today, weekStart, weekdayName } from '@/lib/format';
import { STUDY_FORM_LABELS } from '@/lib/labels';
import { useApi } from '@/lib/query';
import type { CalendarEvent, Group, Lesson } from '@/lib/types';
import { cn } from '@/lib/utils';

const ALL = '__all__';

const DROP_ANIMATION: DropAnimation = {
  duration: 220,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.3' } } }),
};

interface DragData {
  lesson: Lesson;
  /** Группы, в столбцах которых карточку можно поставить (у пары потока — все её группы) */
  groupIds: string[];
}

interface DropData {
  date: string;
  lessonNumber: number;
  groupIds: string[];
}

function DraggableLesson({
  lesson,
  groupIds,
  disabled,
  children,
}: {
  lesson: Lesson;
  groupIds: string[];
  disabled: boolean;
  children: (props: Record<string, unknown>) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lesson.id,
    data: { lesson, groupIds } satisfies DragData,
    disabled,
  });
  return (
    <div ref={setNodeRef} className={cn('min-w-0 flex-1', isDragging && 'opacity-30')}>
      {children({ ...attributes, ...listeners })}
    </div>
  );
}

function DropCell({
  id,
  data,
  span,
  merged,
  isToday,
  children,
}: {
  id: string;
  data: DropData;
  span: number;
  merged: boolean;
  isToday: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver, active } = useDroppable({ id, data });
  // Подсвечиваем только те ячейки, куда карточку действительно можно поставить
  const dragGroups = (active?.data.current as DragData | undefined)?.groupIds;
  const allowed = !!dragGroups && data.groupIds.some((g) => dragGroups.includes(g));
  return (
    <div
      ref={setNodeRef}
      style={{ gridColumn: `span ${span}` }}
      className={cn(
        'relative flex min-h-[70px] min-w-0 flex-col gap-0.5 border-t border-l p-1 transition-colors',
        isToday && 'bg-primary/[0.03]',
        merged && 'bg-primary/[0.04]',
        isOver && allowed && 'bg-primary/10 ring-primary ring-2 ring-inset',
        isOver && !allowed && 'bg-destructive/5',
      )}
    >
      {children}
    </div>
  );
}

function SegmentCell({
  segment,
  date,
  lessonNumber,
  groupsById,
  isToday,
  canDrag,
  onOpen,
}: {
  segment: FullWeekSegment;
  date: string;
  lessonNumber: number;
  groupsById: Map<string, Group>;
  isToday: boolean;
  canDrag: (l: Lesson) => boolean;
  onOpen: (l: Lesson) => void;
}) {
  const merged = segment.groupIds.length > 1;
  return (
    <DropCell
      id={`${date}#${lessonNumber}#${segment.groupIds.join(',')}`}
      data={{ date, lessonNumber, groupIds: segment.groupIds }}
      span={segment.groupIds.length}
      merged={merged}
      isToday={isToday}
    >
      {merged && (
        <div className="text-primary truncate px-0.5 text-[10px] font-semibold" title="Общая пара для нескольких групп">
          {segment.groupIds.map((g) => groupsById.get(g)?.code ?? '').join(' + ')}
        </div>
      )}
      <div className="flex min-w-0 flex-1 gap-1">
        {segment.lessons.map((l) => (
          <DraggableLesson key={l.id} lesson={l} groupIds={segment.groupIds} disabled={!canDrag(l)}>
            {(props) => (
              <LessonCard
                lesson={l}
                mode="day"
                className={cn('h-full', merged && 'border-primary/30')}
                onClick={() => onOpen(l)}
                dragHandleProps={props}
              />
            )}
          </DraggableLesson>
        ))}
      </div>
    </DropCell>
  );
}

/** Полное расписание на неделю: столбцы — все группы, строки — пары по дням */
export default function FullWeekSchedulePage() {
  const { canEdit } = useAuth();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const settings = useSettings();
  const groups = useGroups();
  const periods = usePeriods();
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [active, setActive] = useState<DragData | null>(null);
  const [search, setSearch] = useState('');
  const [onlyBusy, setOnlyBusy] = useState(true);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const week = weekStart(params.get('week') ?? today());
  const specialty = params.get('specialty') ?? ALL;
  const studyForm = params.get('form') ?? ALL;
  const setParam = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === ALL) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  const lessonQuery = useApi<Lesson[]>(['lessons', 'full-week', week], '/schedule-lessons', {
    from: week,
    to: addDays(week, 6),
  });
  const events = useApi<CalendarEvent[]>(['calendar-events', week, addDays(week, 6), 'all'], '/calendar-events', {
    from: week,
    to: addDays(week, 6),
  });
  // Дни, закрытые для всех групп (праздники, каникулы колледжа)
  const blocked = useMemo(() => {
    const map: Record<string, string> = {};
    for (const e of events.data ?? []) {
      if (!e.blocksSchedule || e.teacherId || e.studentGroupId || e.educationalProgramId) continue;
      for (let d = e.startDate.slice(0, 10); d <= e.endDate.slice(0, 10); d = addDays(d, 1)) map[d] = e.title;
    }
    return map;
  }, [events.data]);
  const lessons = useMemo(() => (lessonQuery.data ?? []).filter(visibleInFullWeek), [lessonQuery.data]);
  const index = useMemo(() => indexLessons(lessons), [lessons]);

  const workingDays = settings.data?.settings.workingDays ?? [1, 2, 3, 4, 5, 6];
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i)).filter((d) => workingDays.includes(isoWeekday(d)));
  const lessonsPerDay = settings.data?.settings.lessonsPerDay ?? 6;
  const lessonTimes = settings.data?.lessonTimes ?? [];

  // Последняя пара, которая реально встречается в каждом дне (заочники могут заниматься дольше)
  const lastLessonOf = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of lessons) map.set(l.date, Math.max(map.get(l.date) ?? 0, l.lessonNumber));
    return map;
  }, [lessons]);

  const busyGroups = useMemo(() => new Set(lessons.map((l) => l.studentGroupId)), [lessons]);
  const specialtyOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups.data ?? []) {
      const s = g.program?.specialty;
      if (s) map.set(s.code, `${s.code} ${s.name}`);
    }
    return [{ value: ALL, label: 'Все специальности' }, ...[...map].sort().map(([value, label]) => ({ value, label }))];
  }, [groups.data]);

  const columns = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sortGroupsForFullWeek(
      (groups.data ?? []).filter(
        (g) =>
          (busyGroups.has(g.id) || (!onlyBusy && g.isActive)) &&
          (specialty === ALL || g.program?.specialty?.code === specialty) &&
          (studyForm === ALL || g.program?.studyForm === studyForm) &&
          (!q || g.code.toLowerCase().includes(q)),
      ),
    );
  }, [groups.data, busyGroups, onlyBusy, specialty, studyForm, search]);
  const groupIds = useMemo(() => columns.map((g) => g.id), [columns]);
  const groupsById = useMemo(() => new Map((groups.data ?? []).map((g) => [g.id, g])), [groups.data]);

  // Изменять можно только занятия черновых и опубликованных периодов (не архивных)
  const archived = useMemo(
    () => new Set((periods.data ?? []).filter((p) => p.status === 'ARCHIVED').map((p) => p.id)),
    [periods.data],
  );
  const canDrag = (l: Lesson) =>
    canEdit && !archived.has(l.schedulePeriodId) && (l.status === 'PLANNED' || l.status === 'REPLACED');

  const move = useLessonMove();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['lessons'] });
    void qc.invalidateQueries({ queryKey: ['hour-control'] });
    void qc.invalidateQueries({ queryKey: ['validation'] });
  };

  const onDragStart = (e: DragStartEvent) => setActive(e.active.data.current as DragData);
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    const drag = e.active.data.current as DragData | undefined;
    const target = e.over?.data.current as DropData | undefined;
    if (!drag || !target) return;
    const { lesson } = drag;
    if (target.date === lesson.date && target.lessonNumber === lesson.lessonNumber) return;
    // Перенос только в своём столбце: пара группы остаётся у той же группы
    if (!target.groupIds.some((g) => drag.groupIds.includes(g))) return;
    move.move({ lesson, date: target.date, lessonNumber: target.lessonNumber });
  };

  const now = today();
  const gridTemplate = `76px repeat(${columns.length}, minmax(150px, 1fr))`;

  const header = (
    <PageHeader
      title="Полное расписание на неделю"
      description={`${formatDate(week)} — ${formatDate(addDays(week, 6))} · все группы`}
      actions={
        <Button variant="outline" asChild>
          <Link to={`/schedule?week=${week}`}>
            <ArrowLeft /> К расписанию
          </Link>
        </Button>
      }
    />
  );

  if (lessonQuery.error)
    return (
      <div className="space-y-4">
        {header}
        <ErrorState error={lessonQuery.error} onRetry={() => lessonQuery.refetch()} />
      </div>
    );

  return (
    <div className="space-y-4">
      {header}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => setParam({ week: addDays(week, -7) })} aria-label="Предыдущая неделя">
            <ChevronLeft />
          </Button>
          <Input
            type="date"
            className="w-40"
            value={week}
            onChange={(e) => e.target.value && setParam({ week: weekStart(e.target.value) })}
          />
          <Button variant="outline" size="icon" onClick={() => setParam({ week: addDays(week, 7) })} aria-label="Следующая неделя">
            <ChevronRight />
          </Button>
          <Button variant="ghost" onClick={() => setParam({ week: weekStart(today()) })}>
            Сегодня
          </Button>
        </div>
        <div className="w-full sm:w-64">
          <SimpleSelect value={specialty} onChange={(v) => setParam({ specialty: v })} options={specialtyOptions} />
        </div>
        <div className="w-full sm:w-44">
          <SimpleSelect
            value={studyForm}
            onChange={(v) => setParam({ form: v })}
            options={[
              { value: ALL, label: 'Все формы' },
              ...Object.entries(STUDY_FORM_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
        </div>
        <div className="relative w-full sm:w-44">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input className="pl-8" placeholder="Группа" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="only-busy" checked={onlyBusy} onCheckedChange={setOnlyBusy} />
          <Label htmlFor="only-busy" className="text-sm font-normal">
            Только группы с парами
          </Label>
        </div>
        <Badge variant="secondary" className="ml-auto">
          Групп: {columns.length}
        </Badge>
      </div>

      <LessonTypeLegend />

      {lessonQuery.isLoading || groups.isLoading ? (
        <LoadingState rows={8} />
      ) : columns.length === 0 ? (
        <EmptyState
          title="На этой неделе пар нет"
          description="Выберите другую неделю или снимите фильтры"
        />
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
          <div className="bg-card shadow-soft animate-fade-in max-h-[calc(100dvh-15rem)] overflow-auto rounded-2xl border border-border/70 scrollbar-thin">
            <div className="grid" style={{ gridTemplateColumns: gridTemplate, width: `max(100%, ${76 + columns.length * 150}px)` }}>
              {/* Шапка: группы */}
              <div className="bg-muted sticky top-0 left-0 z-30 border-b p-2 text-xs font-medium text-muted-foreground">Пара</div>
              {columns.map((g) => (
                <div key={g.id} className="bg-muted sticky top-0 z-20 border-b border-l p-2 text-center" title={g.program?.title}>
                  <div className="truncate text-sm font-semibold">{g.code}</div>
                  <div className="text-muted-foreground truncate text-[10px]">
                    {g.courseNumber} курс · {STUDY_FORM_LABELS[g.program?.studyForm ?? '']?.toLowerCase() ?? ''}
                  </div>
                </div>
              ))}

              {days.map((date) => {
                const rows = Math.max(lessonsPerDay, lastLessonOf.get(date) ?? 0);
                const isToday = date === now;
                return (
                  <div key={date} className="contents">
                    <div
                      style={{ gridColumn: '1 / -1' }}
                      className={cn('border-t-2 border-t-border bg-muted/50 px-3 py-1.5', isToday && 'bg-primary/10')}
                    >
                      <span className="sticky left-3 text-sm font-semibold">
                        {weekdayName(isoWeekday(date))}, {formatDateShort(date)}
                        {isToday && <span className="text-primary ml-2 text-xs font-medium">сегодня</span>}
                        {blocked[date] && <span className="text-destructive ml-2 text-xs font-medium">{blocked[date]}</span>}
                      </span>
                    </div>
                    {Array.from({ length: rows }, (_, i) => i + 1).map((n) => {
                      const time = lessonTimes.find((t) => t.lessonNumber === n);
                      return (
                        <div key={n} className="contents">
                          <div className="bg-card sticky left-0 z-10 flex flex-col items-center justify-center border-t p-1 text-center">
                            <div className="text-sm font-semibold">{n}</div>
                            {time && (
                              <div className="text-muted-foreground text-[10px] leading-tight">
                                {time.startTime}
                                <br />
                                {time.endTime}
                              </div>
                            )}
                          </div>
                          {buildRowSegments(groupIds, date, n, index).map((seg) => (
                            <SegmentCell
                              key={seg.groupIds[0]}
                              segment={seg}
                              date={date}
                              lessonNumber={n}
                              groupsById={groupsById}
                              isToday={isToday}
                              canDrag={canDrag}
                              onOpen={(l) => setLessonId(l.id)}
                            />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
          {createPortal(
            <DragOverlay dropAnimation={DROP_ANIMATION}>
              {active ? (
                <LessonCard lesson={active.lesson} mode="day" className="w-48 rotate-2 scale-105 shadow-lift" />
              ) : null}
            </DragOverlay>,
            document.body,
          )}
        </DndContext>
      )}

      <LessonDialog lessonId={lessonId} open={!!lessonId} onOpenChange={(o) => !o && setLessonId(null)} onChanged={invalidate} />
      {move.panel}
    </div>
  );
}
