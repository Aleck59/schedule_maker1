import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import {
  AlarmClock,
  Archive,
  BellPlus,
  CalendarClock,
  CalendarRange,
  Check,
  ChevronDown,
  EyeOff,
  GraduationCap,
  ListChecks,
  MoreHorizontal,
  PartyPopper,
  Pencil,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import { Confirm } from '@/components/common/confirm';
import { Field } from '@/components/common/field';
import { FilterChips } from '@/components/common/filter-chips';
import { PageHeader } from '@/components/common/page-header';
import { SimpleSelect } from '@/components/common/simple-select';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { StatCard } from '@/components/common/stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { addDays, formatDate, parseDate, pluralize, today as todayStr, weekStart } from '@/lib/format';
import { useApi, useApiMutation } from '@/lib/query';
import { cn } from '@/lib/utils';

type Category = 'assessments' | 'groups' | 'process' | 'holidays' | 'teachers' | 'schedule' | 'reminders';
type Severity = 'danger' | 'warning' | 'info' | 'success';

interface TimelineItem {
  id?: string;
  title: string;
  subtitle?: string | null;
  warning?: string | null;
  link?: string | null;
}

interface TimelineEvent {
  key: string;
  category: Category;
  severity: Severity;
  date: string;
  endDate?: string | null;
  ongoing?: boolean;
  title: string;
  description?: string | null;
  link?: { to: string; label: string } | null;
  items?: TimelineItem[];
  needsAction: boolean;
  action?: 'archive-graduates' | 'sync-semesters' | null;
  groupIds?: string[];
  reminderId?: string;
  notes?: string | null;
  yearly?: boolean;
  hidden?: boolean;
  hiddenUntil?: string | null;
}

interface EventsResponse {
  today: string;
  to: string;
  days: number;
  events: TimelineEvent[];
  summary: { total: number; attention: number; week: number; assessments: number; reminders: number; hidden: number };
}

const CATEGORY: Record<Category, { label: string; icon: LucideIcon; color: string }> = {
  assessments: { label: 'Экзамены и зачёты', icon: ListChecks, color: 'oklch(0.6 0.2 285)' },
  groups: { label: 'Группы', icon: GraduationCap, color: 'oklch(0.58 0.2 265)' },
  process: { label: 'Учебный процесс', icon: CalendarRange, color: 'oklch(0.6 0.2 20)' },
  schedule: { label: 'Расписание', icon: Sparkles, color: 'oklch(0.6 0.22 300)' },
  teachers: { label: 'Преподаватели', icon: UserX, color: 'oklch(0.6 0.15 200)' },
  holidays: { label: 'Праздники', icon: PartyPopper, color: 'oklch(0.63 0.21 350)' },
  reminders: { label: 'Напоминания', icon: AlarmClock, color: 'oklch(0.64 0.17 55)' },
};

const SEVERITY_RING: Record<Severity, string> = {
  danger: 'border-l-red-500',
  warning: 'border-l-amber-500',
  info: 'border-l-sky-500',
  success: 'border-l-emerald-500',
};

const HORIZONS = [
  { value: '14', label: '2 недели' },
  { value: '30', label: 'Месяц' },
  { value: '60', label: '2 месяца' },
  { value: '120', label: '4 месяца' },
  { value: '366', label: 'Год' },
];

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function readHorizon() {
  try {
    return localStorage.getItem('sm.events.days') ?? '60';
  } catch {
    return '60';
  }
}

/** Раздел ленты: «Требуют действий», «Сегодня», «Завтра», «На этой неделе», затем месяцы */
function bucketOf(e: TimelineEvent, today: string): { key: string; label: string } {
  if (e.needsAction && e.date <= today) return { key: '0', label: 'Требуют действий' };
  const d = e.date < today ? today : e.date;
  if (d === today) return { key: '1', label: e.ongoing ? 'Сейчас' : 'Сегодня' };
  if (d === addDays(today, 1)) return { key: '2', label: 'Завтра' };
  const nextWeek = addDays(weekStart(today), 7);
  if (d < nextWeek) return { key: '3', label: 'На этой неделе' };
  if (d < addDays(nextWeek, 7)) return { key: '4', label: 'На следующей неделе' };
  const month = MONTHS[Number(d.slice(5, 7)) - 1];
  return { key: `5${d.slice(0, 7)}`, label: `${month[0].toUpperCase()}${month.slice(1)} ${d.slice(0, 4)}` };
}

function relative(date: string, today: string): string {
  const diff = Math.round((parseDate(date).getTime() - parseDate(today).getTime()) / 86_400_000);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  if (diff === -1) return 'вчера';
  if (diff < 0) return `${-diff} ${pluralize(-diff, 'день', 'дня', 'дней')} назад`;
  return `через ${diff} ${pluralize(diff, 'день', 'дня', 'дней')}`;
}

export default function EventsPage() {
  const { canEdit } = useAuth();
  const [days, setDays] = useState(readHorizon);
  const [category, setCategory] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [reminder, setReminder] = useState<TimelineEvent | 'new' | null>(null);
  const data = useApi<EventsResponse>(['events', days], '/events', { days });

  const changeDays = (v: string | null) => {
    const next = v ?? '60';
    setDays(next);
    try {
      localStorage.setItem('sm.events.days', next);
    } catch {
      /* ignore */
    }
  };

  const today = data.data?.today ?? todayStr();
  const all = useMemo(() => data.data?.events ?? [], [data.data]);
  const visible = all.filter((e) => (showHidden ? e.hidden : !e.hidden));
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of all) if (showHidden ? e.hidden : !e.hidden) m.set(e.category, (m.get(e.category) ?? 0) + 1);
    return m;
  }, [all, showHidden]);
  const list = visible.filter((e) => !category || e.category === category);
  const sections = useMemo(() => {
    const map = new Map<string, { label: string; events: TimelineEvent[] }>();
    for (const e of list) {
      const b = bucketOf(e, today);
      if (!map.has(b.key)) map.set(b.key, { label: b.label, events: [] });
      map.get(b.key)!.events.push(e);
    }
    return [...map].sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => ({ key, ...v }));
  }, [list, today]);
  const s = data.data?.summary;

  return (
    <div className="space-y-5">
      <PageHeader
        title="События"
        description="Что скоро произойдёт и что ждёт действий: экзамены и зачёты, выпуск групп, сессии и практики, праздники, ваши напоминания"
        actions={
          <div className="flex shrink-0 items-center gap-2">
            <div className="w-36">
              <SimpleSelect value={days} onChange={changeDays} options={HORIZONS} />
            </div>
            {canEdit && (
              <Button onClick={() => setReminder('new')}>
                <BellPlus /> Напоминание
              </Button>
            )}
          </div>
        }
      />

      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          title="Требуют действий"
          value={s?.attention ?? 0}
          hint={s?.attention ? 'выпуск, даты контроля, напоминания' : 'всё в порядке'}
          icon={CalendarClock}
          tone={s?.attention ? 'danger' : 'success'}
          onClick={() => setCategory(null)}
        />
        <StatCard title="На этой неделе" value={s?.week ?? 0} hint="событий в ближайшие 7 дней" icon={CalendarRange} tone="info" />
        <StatCard
          title="Экзамены и зачёты"
          value={s?.assessments ?? 0}
          hint={`за ${HORIZONS.find((h) => h.value === days)?.label.toLowerCase() ?? 'период'}`}
          icon={ListChecks}
          tone="default"
          onClick={() => setCategory('assessments')}
        />
        <StatCard
          title="Напоминания"
          value={s?.reminders ?? 0}
          hint="добавленные вручную"
          icon={AlarmClock}
          tone="warning"
          onClick={() => setCategory('reminders')}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <FilterChips
          label="Раздел"
          value={category}
          onChange={setCategory}
          allCount={visible.length}
          options={(Object.keys(CATEGORY) as Category[])
            .filter((c) => counts.get(c))
            .map((c) => ({ value: c, label: CATEGORY[c].label, count: counts.get(c) }))}
        />
        {(s?.hidden ?? 0) > 0 && (
          <Button variant={showHidden ? 'secondary' : 'ghost'} size="sm" onClick={() => setShowHidden(!showHidden)}>
            <EyeOff /> {showHidden ? 'Вернуться к ленте' : `Скрытые: ${s?.hidden}`}
          </Button>
        )}
      </div>

      {data.isLoading ? (
        <LoadingState rows={6} />
      ) : data.error ? (
        <ErrorState error={data.error} onRetry={() => data.refetch()} />
      ) : sections.length === 0 ? (
        <EmptyState
          title={showHidden ? 'Скрытых событий нет' : 'Событий нет'}
          description={showHidden ? undefined : 'В выбранном периоде ничего не запланировано. Увеличьте период или добавьте напоминание'}
        />
      ) : (
        <div className="space-y-6">
          {sections.map((section) => (
            <section key={section.key} className="animate-fade-in">
              <div className="mb-2 flex items-center gap-2">
                <h2
                  className={cn(
                    'text-sm font-semibold tracking-tight',
                    section.key === '0' ? 'text-red-600 dark:text-red-400' : 'text-foreground',
                  )}
                >
                  {section.label}
                </h2>
                <span className="text-muted-foreground text-xs tabular-nums">{section.events.length}</span>
                <div className="bg-border h-px flex-1" />
              </div>
              <ol className="stagger relative space-y-2.5 before:absolute before:top-2 before:bottom-2 before:left-[27px] before:w-px before:bg-border sm:before:left-[31px]">
                {section.events.map((e) => (
                  <EventRow key={e.key} event={e} today={today} canEdit={canEdit} onEditReminder={() => setReminder(e)} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      <ReminderDialog
        event={reminder === 'new' ? null : reminder}
        open={reminder !== null}
        today={today}
        onOpenChange={(o) => !o && setReminder(null)}
      />
    </div>
  );
}

function EventRow({
  event: e,
  today,
  canEdit,
  onEditReminder,
}: {
  event: TimelineEvent;
  today: string;
  canEdit: boolean;
  onEditReminder: () => void;
}) {
  const cat = CATEGORY[e.category];
  const Icon = cat.icon;
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(e.groupIds ?? []));
  const items = e.items ?? [];
  const shown = expanded ? items : items.slice(0, 4);
  const day = e.date < today ? today : e.date;
  const inv = [['events'], ['groups'], ['programs'], ['dashboard'], ['setup']];

  const dismiss = useApiMutation((until: string | null) => api.post('/events/dismiss', { key: e.key, until }), {
    success: 'Событие скрыто',
    invalidate: [['events']],
  });
  const restore = useApiMutation(() => api.post('/events/restore', { key: e.key }), { success: 'Событие возвращено', invalidate: [['events']] });
  const done = useApiMutation(() => api.post(`/events/reminders/${e.reminderId}/done`), {
    success: e.yearly ? 'Готово, напомню через год' : 'Напоминание выполнено',
    invalidate: [['events']],
  });
  const remove = useApiMutation(() => api.delete(`/events/reminders/${e.reminderId}`), { success: 'Напоминание удалено', invalidate: [['events']] });
  const archive = useApiMutation(
    (ids: string[]) => api.post<{ archivedGroups: number; archivedPrograms: number }>('/events/groups/archive', { groupIds: ids }),
    {
      success: (r) =>
        `В архиве ${r.archivedGroups} ${pluralize(r.archivedGroups, 'группа', 'группы', 'групп')}` +
        (r.archivedPrograms ? ` и ${r.archivedPrograms} ${pluralize(r.archivedPrograms, 'учебный план', 'учебных плана', 'учебных планов')}` : ''),
      invalidate: inv,
    },
  );
  const del = useApiMutation((ids: string[]) => api.post<{ deleted: number; kept: string[] }>('/events/groups/delete', { groupIds: ids }), {
    success: (r) =>
      `Удалено ${r.deleted} ${pluralize(r.deleted, 'группа', 'группы', 'групп')}` +
      (r.kept.length ? `. С расписанием оставлены: ${r.kept.join(', ')} — архивируйте их` : ''),
    invalidate: inv,
  });
  const sync = useApiMutation((ids: string[]) => api.post<{ updated: number }>('/events/groups/sync-semesters', { groupIds: ids }), {
    success: (r) => `Обновлено карточек групп: ${r.updated}`,
    invalidate: inv,
  });
  const ids = [...selected];
  const selectable = !!e.action && canEdit && !e.hidden;

  return (
    <li className="relative flex gap-3 sm:gap-4">
      <div className="flex w-14 shrink-0 flex-col items-center sm:w-16">
        <div
          className="bg-card relative z-10 flex size-11 flex-col items-center justify-center rounded-xl border shadow-sm sm:size-12"
          style={{ '--cat': cat.color } as CSSProperties}
        >
          <span className="text-[15px] leading-none font-semibold tabular-nums">{Number(day.slice(8, 10))}</span>
          <span className="text-muted-foreground mt-0.5 text-[10px] leading-none">
            {MONTHS[Number(day.slice(5, 7)) - 1].slice(0, 3)}, {WEEKDAYS[parseDate(day).getDay()]}
          </span>
        </div>
      </div>
      <Card className={cn('lift min-w-0 flex-1 border-l-4 py-3', SEVERITY_RING[e.severity], e.hidden && 'opacity-70')}>
        <CardContent className="space-y-2 px-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg p-1.5" style={{ background: `color-mix(in srgb, ${cat.color} 14%, transparent)`, color: cat.color }}>
              <Icon className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium">{e.title}</span>
                {e.ongoing && <Badge variant="info">идёт до {formatDate(e.endDate)}</Badge>}
                {!e.ongoing && e.endDate && e.endDate !== e.date && e.category !== 'teachers' && e.category !== 'holidays' && (
                  <Badge variant="muted">до {formatDate(e.endDate)}</Badge>
                )}
                {e.yearly && <Badge variant="violet">каждый год</Badge>}
                {e.hidden && <Badge variant="muted">{e.hiddenUntil ? `скрыто до ${formatDate(e.hiddenUntil)}` : 'скрыто'}</Badge>}
              </div>
              {e.description && <div className="text-muted-foreground mt-0.5 text-sm">{e.description}</div>}
              <div className="text-muted-foreground mt-1 text-xs">
                {cat.label} · {formatDate(e.date)}
                {e.date !== today && !e.ongoing && <> · {relative(e.date, today)}</>}
              </div>
            </div>
            {canEdit && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="-mt-1 -mr-2 size-8 shrink-0" aria-label="Действия с событием">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {e.reminderId && (
                    <>
                      <DropdownMenuItem onSelect={onEditReminder}>
                        <Pencil /> Изменить
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onSelect={() => remove.mutate(undefined)}>
                        <Trash2 /> Удалить
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  {e.hidden ? (
                    <DropdownMenuItem onSelect={() => restore.mutate(undefined)}>
                      <RotateCcw /> Вернуть в ленту
                    </DropdownMenuItem>
                  ) : (
                    <>
                      <DropdownMenuItem onSelect={() => dismiss.mutate(addDays(today, 7))}>
                        <EyeOff /> Скрыть на неделю
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => dismiss.mutate(addDays(today, 30))}>
                        <EyeOff /> Скрыть на месяц
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => dismiss.mutate(null)}>
                        <EyeOff /> Скрыть насовсем
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {items.length > 0 && (
            <div className="bg-muted/40 rounded-lg border">
              {shown.map((it, i) => {
                const checked = !!it.id && selected.has(it.id);
                return (
                  <div key={it.id ?? i} className="flex items-start gap-2.5 border-b px-3 py-2 text-sm last:border-0">
                    {selectable && it.id && (
                      <Checkbox
                        className="mt-0.5"
                        checked={checked}
                        aria-label={`Выбрать ${it.title}`}
                        onCheckedChange={(v) => {
                          const next = new Set(selected);
                          if (v) next.add(it.id!);
                          else next.delete(it.id!);
                          setSelected(next);
                        }}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      {it.link ? (
                        <Link to={it.link} className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                          {it.title}
                        </Link>
                      ) : (
                        <span className="font-medium">{it.title}</span>
                      )}
                      {it.subtitle && <div className="text-muted-foreground text-xs">{it.subtitle}</div>}
                    </div>
                    {it.warning && (
                      <Badge variant="warning" className="shrink-0">
                        {it.warning}
                      </Badge>
                    )}
                  </div>
                );
              })}
              {items.length > 4 && (
                <button
                  type="button"
                  onClick={() => setExpanded(!expanded)}
                  className="text-muted-foreground hover:text-foreground flex w-full items-center justify-center gap-1 py-1.5 text-xs transition-colors"
                >
                  {expanded ? 'Свернуть' : `Показать все ${items.length}`}
                  <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} />
                </button>
              )}
            </div>
          )}

          {(e.link || e.reminderId || selectable) && !e.hidden && (
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {e.action === 'archive-graduates' && canEdit && (
                <>
                  <Confirm
                    trigger={
                      <Button size="sm" disabled={!ids.length || archive.isPending}>
                        <Archive /> Архивировать {ids.length !== items.length ? `(${ids.length})` : 'все'}
                      </Button>
                    }
                    title="Архивировать выпускников?"
                    description="Группы станут неактивными: они пропадут из составления, нагрузки и списков по умолчанию, но расписание, отчёты и выполнение часов сохранятся. Учебный план уходит в архив, когда все его группы выпустились. Вернуть группу можно в её карточке."
                    confirmText="Архивировать"
                    onConfirm={() => archive.mutate(ids)}
                  />
                  <Confirm
                    trigger={
                      <Button size="sm" variant="outline" disabled={!ids.length || del.isPending}>
                        <Trash2 /> Удалить без расписания
                      </Button>
                    }
                    title="Удалить выбранные группы?"
                    description="Будут удалены только группы, по которым нет ни одной пары в расписании, вместе со студентами и подгруппами. Группы с расписанием останутся — их можно только архивировать. Отменить удаление нельзя."
                    confirmText="Удалить"
                    destructive
                    onConfirm={() => del.mutate(ids)}
                  />
                </>
              )}
              {e.action === 'sync-semesters' && canEdit && (
                <Button size="sm" disabled={!ids.length || sync.isPending} onClick={() => sync.mutate(ids)}>
                  <RefreshCw /> Обновить курс и семестр {ids.length !== items.length ? `(${ids.length})` : ''}
                </Button>
              )}
              {e.reminderId && canEdit && (
                <Button size="sm" variant="outline" disabled={done.isPending} onClick={() => done.mutate(undefined)}>
                  <Check /> Выполнено
                </Button>
              )}
              {e.link && (
                <Button size="sm" variant={e.action || e.reminderId ? 'ghost' : 'outline'} asChild>
                  <Link to={e.link.to}>{e.link.label}</Link>
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

function ReminderDialog({
  event,
  open,
  today,
  onOpenChange,
}: {
  event: TimelineEvent | null;
  open: boolean;
  today: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(today);
  const [yearly, setYearly] = useState(false);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const key = open ? (event?.key ?? 'new') : null;
  if (key !== lastKey) {
    setLastKey(key);
    if (open) {
      setTitle(event?.title ?? '');
      setNotes(event?.notes ?? '');
      setDate(event?.date ?? addDays(today, 1));
      setYearly(event?.yearly ?? false);
    }
  }
  const save = useApiMutation(
    () => {
      const body = { title, notes: notes || null, date, yearly };
      return event?.reminderId ? api.patch(`/events/reminders/${event.reminderId}`, body) : api.post('/events/reminders', body);
    },
    {
      success: event ? 'Напоминание сохранено' : 'Напоминание добавлено',
      invalidate: [['events']],
      onSuccess: () => onOpenChange(false),
    },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{event ? 'Изменить напоминание' : 'Новое напоминание'}</DialogTitle>
          <DialogDescription>Появится в ленте событий в выбранный день и будет видно всем диспетчерам и руководству</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(ev) => {
            ev.preventDefault();
            save.mutate(undefined);
          }}
        >
          <Field label="О чём напомнить" required>
            <Input value={title} onChange={(ev) => setTitle(ev.target.value)} placeholder="Например: сдать отчёт о выполнении часов" autoFocus />
          </Field>
          <Field label="Дата" required>
            <Input type="date" value={date} onChange={(ev) => setDate(ev.target.value)} />
          </Field>
          <Field label="Комментарий">
            <Textarea value={notes} onChange={(ev) => setNotes(ev.target.value)} rows={3} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={yearly} onCheckedChange={(v) => setYearly(!!v)} />
            Повторять каждый год
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={!title.trim() || !date || save.isPending}>
              Сохранить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
