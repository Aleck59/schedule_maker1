import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { GripVertical, Hand, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Field } from '@/components/common/field';
import { SimpleSelect } from '@/components/common/simple-select';
import { EmptyState, ErrorState, LoadingState, Spinner } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useClassrooms, useTeachers } from '@/hooks/use-reference';
import { api } from '@/lib/api';
import { addDays, formatDate, formatDateShort, isoWeekday, parseDate, weekStart, weekdayName } from '@/lib/format';
import { CALENDAR_EVENT_COLORS, CALENDAR_EVENT_LABELS, CONTROL_FORM_LABELS } from '@/lib/labels';
import { useApi, useApiMutation } from '@/lib/query';
import { cn } from '@/lib/utils';

export interface BoardEvent {
  id: string;
  date: string;
  lessonNumber: number | null;
  controlForm: string;
  studentGroupId: string;
  semesterCurriculumItemId: string;
  teacherId: string | null;
  classroomId: string | null;
  notes: string | null;
  group: { id: string; code: string };
  semesterItem: { curriculumItem: { code: string; name: string } };
  teacher: { id: string; fullName: string } | null;
  classroom: { id: string; code: string } | null;
}

interface PendingItem {
  groupId: string;
  semesterCurriculumItemId: string;
  controlForm: string;
  code: string;
  name: string;
  teacher: { id: string; fullName: string } | null;
}

interface Board {
  semester: { id: string; number: number; startDate: string; endDate: string };
  lessonsPerDay: number;
  days: string[];
  groups: Array<{ id: string; code: string; studentCount: number; kinds: string[] }>;
  events: BoardEvent[];
  pending: PendingItem[];
}

type DragItem = { kind: 'event'; event: BoardEvent } | { kind: 'pending'; item: PendingItem };

const EXAM_FORMS = ['EXAM', 'QUALIFICATION_EXAM'];
const CLOSED = ['HOLIDAY', 'VACATION'];
const SHORT_FORM: Record<string, string> = {
  EXAM: 'Э',
  QUALIFICATION_EXAM: 'КЭ',
  CREDIT: 'З',
  DIFFERENTIATED_CREDIT: 'ДЗ',
  COURSE_PROJECT: 'КП',
  OTHER: 'К',
};
const isExam = (form: string) => EXAM_FORMS.includes(form);
const formChip = (form: string) =>
  isExam(form)
    ? 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200'
    : 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-200';
const dayDiff = (a: string, b: string) => Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / 86_400_000);
const invalidate = [['assessments'], ['assessment-board']];

function showWarnings(result: { warnings?: string[] }) {
  for (const w of result.warnings ?? []) toast.warning(w);
}

/**
 * Интерактивный редактор экзаменов и зачётов: строки — группы, столбцы — учебные дни по неделям.
 * Мероприятия перетаскиваются по дням своей группы, неназначенные — из списка или кликом по дню.
 */
export function AssessmentBoard({ semesterId, editable }: { semesterId: string; editable: boolean }) {
  const board = useApi<Board>(['assessment-board', semesterId], '/assessment-events/board', { semesterId });
  const [compact, setCompact] = useState(true);
  const [active, setActive] = useState<DragItem | null>(null);
  const [editing, setEditing] = useState<BoardEvent | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const move = useApiMutation(
    (v: { id: string; date: string; lessonNumber: number | null }) =>
      api.patch<{ warnings: string[] }>(`/assessment-events/${v.id}`, { date: v.date, lessonNumber: v.lessonNumber, autoPair: true }),
    { success: 'Мероприятие перенесено', invalidate, onSuccess: showWarnings },
  );
  const place = useApiMutation(
    (v: { item: PendingItem; date: string }) =>
      api.post<{ warnings: string[] }>('/assessment-events', {
        studentGroupId: v.item.groupId,
        semesterCurriculumItemId: v.item.semesterCurriculumItemId,
        date: v.date,
        autoPair: true,
      }),
    { success: 'Мероприятие назначено', invalidate, onSuccess: showWarnings },
  );

  const data = board.data;
  // Недели: в компактном виде — только сессия, недели с мероприятиями и последние две недели теории
  const weeks = useMemo(() => {
    if (!data) return [];
    const byWeek = new Map<string, number[]>();
    data.days.forEach((d, i) => {
      const w = weekStart(d);
      byWeek.set(w, [...(byWeek.get(w) ?? []), i]);
    });
    const all = [...byWeek].map(([start, idx], n) => ({ start, idx, number: n + 1 }));
    if (!compact) return all;
    const busy = new Set(data.events.map((e) => weekStart(e.date.slice(0, 10))));
    const lastStudy = all
      .filter((w) => w.idx.some((i) => data.groups.some((g) => g.kinds[i] === 'STUDY')))
      .slice(-2)
      .map((w) => w.start);
    return all.filter(
      (w) =>
        busy.has(w.start) ||
        lastStudy.includes(w.start) ||
        w.idx.some((i) => data.groups.some((g) => g.kinds[i] === 'EXAM_SESSION')),
    );
  }, [data, compact]);

  const eventsByCell = useMemo(() => {
    const map = new Map<string, BoardEvent[]>();
    for (const e of data?.events ?? []) {
      const k = `${e.studentGroupId}|${e.date.slice(0, 10)}`;
      map.set(k, [...(map.get(k) ?? []), e].sort((a, b) => (a.lessonNumber ?? 99) - (b.lessonNumber ?? 99)));
    }
    return map;
  }, [data]);

  // Подсказки прямо на карточках: экзамен вне сессии или без дня на подготовку
  const issues = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!data) return map;
    const dayIndex = new Map(data.days.map((d, i) => [d, i]));
    const kinds = new Map(data.groups.map((g) => [g.id, g.kinds]));
    for (const e of data.events) {
      if (!isExam(e.controlForm)) continue;
      const date = e.date.slice(0, 10);
      const list: string[] = [];
      const i = dayIndex.get(date);
      if (i === undefined || kinds.get(e.studentGroupId)?.[i] !== 'EXAM_SESSION') list.push('Экзамен вне недель промежуточной аттестации');
      const near = data.events.find(
        (o) =>
          o.id !== e.id && o.studentGroupId === e.studentGroupId && isExam(o.controlForm) && Math.abs(dayDiff(o.date.slice(0, 10), date)) <= 1,
      );
      if (near) list.push(`Нет дня на подготовку: рядом «${near.semesterItem.curriculumItem.name}»`);
      if (list.length) map.set(e.id, list);
    }
    return map;
  }, [data]);

  if (board.isLoading) return <LoadingState rows={6} />;
  if (board.error) return <ErrorState error={board.error} onRetry={() => board.refetch()} />;
  if (!data) return null;
  if (data.groups.length === 0) return <EmptyState title="В учебном плане нет активных групп" />;

  const pendingByGroup = new Map<string, PendingItem[]>();
  for (const p of data.pending) pendingByGroup.set(p.groupId, [...(pendingByGroup.get(p.groupId) ?? []), p]);
  const busy = move.isPending || place.isPending;

  const dragGroup = active ? (active.kind === 'event' ? active.event.studentGroupId : active.item.groupId) : null;
  const onDragStart = (e: DragStartEvent) => setActive(e.active.data.current as DragItem);
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    const drag = e.active.data.current as DragItem | undefined;
    const target = e.over?.data.current as { groupId: string; date: string } | undefined;
    if (!drag || !target) return;
    if (drag.kind === 'event') {
      if (target.groupId !== drag.event.studentGroupId) return toast.error('Мероприятие переносится только в строке своей группы');
      if (target.date === drag.event.date.slice(0, 10)) return;
      move.mutate({ id: drag.event.id, date: target.date, lessonNumber: drag.event.lessonNumber });
    } else {
      if (target.groupId !== drag.item.groupId) return toast.error('Дисциплину можно поставить только в строку своей группы');
      place.mutate({ item: drag.item, date: target.date });
    }
  };

  const columns = weeks.flatMap((w) => w.idx);
  const legend = [...new Set(data.groups.flatMap((g) => columns.map((i) => g.kinds[i])))].filter((k) => k !== 'NONE');
  const template = `minmax(96px, 120px) repeat(${columns.length}, minmax(46px, 1fr))`;

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={compact} onCheckedChange={setCompact} />
            Только конец семестра и сессия
          </label>
          <span className="flex items-center gap-1.5">
            <span className={cn('rounded border px-1.5 py-0.5 font-semibold', formChip('EXAM'))}>Э</span> экзамен
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn('rounded border px-1.5 py-0.5 font-semibold', formChip('CREDIT'))}>З</span> зачёт, дифф. зачёт
          </span>
          {legend.map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className={cn('size-3 rounded-sm border', k === 'STUDY' ? 'bg-card' : CALENDAR_EVENT_COLORS[k])} />
              {k === 'STUDY' ? 'Теоретическое обучение' : CALENDAR_EVENT_LABELS[k]}
            </span>
          ))}
          {busy && <Spinner />}
        </div>

        {editable && (
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Hand className="size-3.5" /> Перетащите экзамен или зачёт на другой день своей группы — пара подберётся без накладок. Клик по пустому дню
            — назначить дисциплину, клик по карточке — изменить пару, преподавателя или аудиторию.
          </p>
        )}

        <div className="bg-card overflow-x-auto rounded-lg border">
          <div className="grid min-w-max text-xs" style={{ gridTemplateColumns: template }}>
            {/* Заголовок: недели */}
            <div className="bg-card sticky left-0 z-20 row-span-2 flex items-end border-r border-b p-2 font-medium">Группа</div>
            {weeks.map((w) => (
              <div
                key={w.start}
                style={{ gridColumn: `span ${w.idx.length}` }}
                className="text-muted-foreground border-b border-l px-1 py-1 text-center text-[11px] whitespace-nowrap"
              >
                <b className="text-foreground">{w.number} нед.</b> {formatDateShort(w.start)} — {formatDateShort(addDays(w.start, 6))}
              </div>
            ))}
            {/* Заголовок: дни */}
            {columns.map((i) => {
              const d = data.days[i];
              return (
                <div key={d} className={cn('border-b border-l px-0.5 py-1.5 text-center', isoWeekday(d) === 1 && 'border-l-foreground/20')}>
                  <div className="text-muted-foreground text-[10px]">{weekdayName(isoWeekday(d), true)}</div>
                  <div className="font-medium tabular-nums">{d.slice(8, 10)}</div>
                </div>
              );
            })}
            {/* Строки групп */}
            {data.groups.map((g) => {
              const pending = pendingByGroup.get(g.id) ?? [];
              return (
                <Fragment key={g.id}>
                  <div className="bg-card sticky left-0 z-10 flex flex-col justify-center border-r border-b px-2 py-1">
                    <span className="font-semibold">{g.code}</span>
                    {pending.length > 0 && <span className="text-[10px] text-amber-700 dark:text-amber-300">не назначено: {pending.length}</span>}
                  </div>
                  {columns.map((i) => {
                    const date = data.days[i];
                    const kind = g.kinds[i];
                    const cellEvents = eventsByCell.get(`${g.id}|${date}`) ?? [];
                    return (
                      <DayCell
                        key={date}
                        groupId={g.id}
                        date={date}
                        kind={kind}
                        monday={isoWeekday(date) === 1}
                        dimmed={!!dragGroup && dragGroup !== g.id}
                        pending={editable && !CLOSED.includes(kind) ? pending : []}
                        onPlace={(item) => place.mutate({ item, date })}
                      >
                        {cellEvents.map((e) => (
                          <EventChip key={e.id} event={e} issues={issues.get(e.id)} editable={editable} onOpen={() => setEditing(e)} />
                        ))}
                      </DayCell>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        </div>

        {data.pending.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Не назначены: {data.pending.length}</CardTitle>
              <CardDescription>
                {editable
                  ? 'Перетащите дисциплину на день своей группы или нажмите «Распределить автоматически».'
                  : 'Эти экзамены и зачёты ещё не поставлены в график.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.groups
                .filter((g) => pendingByGroup.has(g.id))
                .map((g) => (
                  <div key={g.id} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-24 shrink-0 text-sm font-semibold">{g.code}</span>
                    {pendingByGroup.get(g.id)!.map((p) => (
                      <PendingChip key={p.semesterCurriculumItemId} item={p} editable={editable} />
                    ))}
                  </div>
                ))}
            </CardContent>
          </Card>
        )}
      </div>

      {createPortal(
        <DragOverlay dropAnimation={null}>
          {active && (
            <div className={cn('w-max rounded border px-2 py-1 text-xs font-medium whitespace-nowrap shadow-lg', formChip(active.kind === 'event' ? active.event.controlForm : active.item.controlForm))}>
              {active.kind === 'event' ? active.event.semesterItem.curriculumItem.name : active.item.name}
            </div>
          )}
        </DragOverlay>,
        document.body,
      )}

      <EditDialog event={editing} lessonsPerDay={data.lessonsPerDay} onClose={() => setEditing(null)} />
    </DndContext>
  );
}

function DayCell({
  groupId,
  date,
  kind,
  monday,
  dimmed,
  pending,
  onPlace,
  children,
}: {
  groupId: string;
  date: string;
  kind: string;
  monday: boolean;
  dimmed: boolean;
  pending: PendingItem[];
  onPlace: (item: PendingItem) => void;
  children: ReactNode;
}) {
  const closed = CLOSED.includes(kind);
  const { setNodeRef, isOver } = useDroppable({ id: `${groupId}|${date}`, data: { groupId, date }, disabled: closed || dimmed });
  const tint = kind === 'STUDY' || kind === 'NONE' ? null : CALENDAR_EVENT_COLORS[kind];
  const body = (
    <div
      ref={setNodeRef}
      title={`${formatDate(date)} · ${kind === 'STUDY' ? 'Теоретическое обучение' : kind === 'NONE' ? 'Вне семестра' : CALENDAR_EVENT_LABELS[kind]}`}
      className={cn(
        'relative flex min-h-[84px] flex-col gap-0.5 border-b border-l p-0.5 transition-colors',
        monday && 'border-l-foreground/20',
        kind === 'NONE' && 'bg-muted/40',
        closed && 'bg-[repeating-linear-gradient(135deg,transparent,transparent_4px,rgb(148_163_184/0.25)_4px,rgb(148_163_184/0.25)_6px)]',
        dimmed && 'opacity-40',
        isOver && 'ring-primary bg-primary/10 ring-2 ring-inset',
        pending.length > 0 && 'hover:bg-primary/5 cursor-pointer',
      )}
    >
      {tint && <span className={cn('pointer-events-none absolute inset-0 opacity-45', tint)} />}
      <div className="relative flex flex-col gap-0.5">{children}</div>
    </div>
  );
  if (pending.length === 0) return body;
  return (
    <Popover>
      <PopoverTrigger asChild>{body}</PopoverTrigger>
      <PopoverContent className="w-72 p-2">
        <div className="mb-1.5 px-1 text-xs font-medium">Назначить на {formatDate(date)}</div>
        <div className="grid max-h-64 gap-1 overflow-y-auto">
          {pending.map((p) => (
            <button
              key={p.semesterCurriculumItemId}
              type="button"
              className={cn('rounded border px-2 py-1 text-left text-xs hover:opacity-80', formChip(p.controlForm))}
              onClick={() => onPlace(p)}
            >
              <b>{SHORT_FORM[p.controlForm] ?? '?'}</b> {p.name}
              {p.teacher && <span className="block opacity-70">{p.teacher.fullName}</span>}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EventChip({ event, issues, editable, onOpen }: { event: BoardEvent; issues?: string[]; editable: boolean; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: event.id, data: { kind: 'event', event } satisfies DragItem, disabled: !editable });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={setNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className={cn(
            'flex w-full items-center justify-between gap-0.5 rounded border px-1 py-0.5 text-[10px] leading-tight font-semibold shadow-xs transition',
            formChip(event.controlForm),
            editable && 'cursor-grab touch-none active:cursor-grabbing',
            issues && 'ring-2 ring-amber-400',
            isDragging && 'opacity-30',
          )}
        >
          <span>{SHORT_FORM[event.controlForm] ?? '?'}</span>
          <span className="opacity-70 tabular-nums">{event.lessonNumber ? `${event.lessonNumber}п` : '—'}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-0.5 text-xs">
          <div className="font-medium">
            {CONTROL_FORM_LABELS[event.controlForm]}: {event.semesterItem.curriculumItem.code} {event.semesterItem.curriculumItem.name}
          </div>
          <div>
            {formatDate(event.date)}, {event.lessonNumber ? `${event.lessonNumber} пара` : 'пара не задана'} · {event.group.code}
          </div>
          <div>
            {event.teacher?.fullName ?? 'Преподаватель не назначен'} · {event.classroom ? `ауд. ${event.classroom.code}` : 'без аудитории'}
          </div>
          {issues?.map((i) => (
            <div key={i} className="text-amber-300">
              ⚠ {i}
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function PendingChip({ item, editable }: { item: PendingItem; editable: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `pending|${item.groupId}|${item.semesterCurriculumItemId}`,
    data: { kind: 'pending', item } satisfies DragItem,
    disabled: !editable,
  });
  return (
    <span
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      title={item.teacher?.fullName ?? 'Преподаватель не назначен'}
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs',
        formChip(item.controlForm),
        editable && 'cursor-grab touch-none active:cursor-grabbing',
        isDragging && 'opacity-30',
      )}
    >
      {editable && <GripVertical className="size-3 opacity-50" />}
      <b>{SHORT_FORM[item.controlForm] ?? '?'}</b> {item.name}
    </span>
  );
}

function EditDialog({ event, lessonsPerDay, onClose }: { event: BoardEvent | null; lessonsPerDay: number; onClose: () => void }) {
  return (
    <Dialog open={!!event} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">{event && <EditForm key={event.id} event={event} lessonsPerDay={lessonsPerDay} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function EditForm({ event, lessonsPerDay, onClose }: { event: BoardEvent; lessonsPerDay: number; onClose: () => void }) {
  const teachers = useTeachers();
  const classrooms = useClassrooms();
  const [date, setDate] = useState(event.date.slice(0, 10));
  const [pair, setPair] = useState<string | null>(event.lessonNumber ? String(event.lessonNumber) : null);
  const [teacherId, setTeacherId] = useState<string | null>(event.teacherId);
  const [classroomId, setClassroomId] = useState<string | null>(event.classroomId);
  const [notes, setNotes] = useState(event.notes ?? '');
  const save = useApiMutation(
    () =>
      api.patch<{ warnings: string[] }>(`/assessment-events/${event.id}`, {
        date,
        lessonNumber: pair ? Number(pair) : null,
        teacherId,
        classroomId,
        notes: notes.trim() || null,
      }),
    {
      success: 'Сохранено',
      invalidate,
      onSuccess: (r) => {
        showWarnings(r);
        onClose();
      },
    },
  );
  const remove = useApiMutation(() => api.delete(`/assessment-events/${event.id}`), {
    success: 'Мероприятие снято с графика',
    invalidate,
    onSuccess: onClose,
  });
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {CONTROL_FORM_LABELS[event.controlForm]} · {event.group.code}
        </DialogTitle>
        <DialogDescription>
          {event.semesterItem.curriculumItem.code} {event.semesterItem.curriculumItem.name}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Дата">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Пара">
          <SimpleSelect
            value={pair}
            onChange={setPair}
            allowEmpty
            emptyLabel="Не задана"
            options={Array.from({ length: Math.max(lessonsPerDay, event.lessonNumber ?? 0) }, (_, i) => ({ value: String(i + 1), label: `${i + 1} пара` }))}
          />
        </Field>
        <Field label="Преподаватель">
          <SimpleSelect
            value={teacherId}
            onChange={setTeacherId}
            allowEmpty
            emptyLabel="Не назначен"
            options={(teachers.data ?? []).map((t) => ({ value: t.id, label: t.fullName }))}
          />
        </Field>
        <Field label="Аудитория">
          <SimpleSelect
            value={classroomId}
            onChange={setClassroomId}
            allowEmpty
            emptyLabel="Без аудитории"
            options={(classrooms.data ?? []).filter((c) => c.isActive || c.id === classroomId).map((c) => ({ value: c.id, label: `${c.code} · ${c.capacity} мест` }))}
          />
        </Field>
        <div className="sm:col-span-2">
          <Label className="mb-1.5 block text-sm">Примечание</Label>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      {isExam(event.controlForm) && (
        <p className="text-muted-foreground text-xs">
          Экзамен обычно ставится в неделю промежуточной аттестации, с днём на подготовку между экзаменами группы.
        </p>
      )}
      <DialogFooter className="gap-2 sm:justify-between">
        <Button variant="ghost" className="text-destructive" onClick={() => remove.mutate(undefined)} disabled={remove.isPending}>
          {remove.isPending ? <Spinner /> : <Trash2 />} Снять с графика
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={() => save.mutate(undefined)} disabled={save.isPending || !date}>
            {save.isPending && <Spinner />} Сохранить
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
