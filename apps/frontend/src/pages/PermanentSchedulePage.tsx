import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  BadgeCheck,
  CalendarClock,
  ChevronDown,
  Info,
  Layers,
  Plus,
  Printer,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Undo2,
  Users,
} from 'lucide-react';
import { Confirm } from '@/components/common/confirm';
import { Field } from '@/components/common/field';
import { PageHeader } from '@/components/common/page-header';
import { SimpleSelect } from '@/components/common/simple-select';
import { StatCard } from '@/components/common/stat-card';
import { EmptyState, ErrorState, LoadingState, Spinner } from '@/components/common/states';
import { PermanentCreateForm } from '@/components/permanent/permanent-create-form';
import { PrintFormDialog } from '@/components/schedule/print-form-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useClassrooms, useTeachers } from '@/hooks/use-reference';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime, formatNumber, shortName, weekdayName } from '@/lib/format';
import { EDUCATION_LEVEL_LABELS, LESSON_TYPE_SHORT } from '@/lib/labels';
import { useApi, useApiMutation } from '@/lib/query';
import { cn } from '@/lib/utils';

type Parity = 'ANY' | 'ODD' | 'EVEN';
type JobStatus = 'QUEUED' | 'GENERATING' | 'COMPLETED' | 'COMPLETED_WITH_CONFLICTS' | 'FAILED' | null;

interface PermanentStats {
  requiredWeekly: number;
  placedWeekly: number;
  groups: number;
  teachers: number;
  unplaced: number;
  biweekly: number;
  withoutRoom?: number;
  weeks: number;
}

interface PermanentListItem {
  id: string;
  title: string;
  date: string;
  approvedAt: string | null;
  jobStatus: JobStatus;
  progress: number;
  message: string | null;
  generatedAt: string | null;
  lessonCount: number;
  stats: PermanentStats | null;
}

interface PermanentLesson {
  id: string;
  weekday: number;
  lessonNumber: number;
  weekParity: Parity;
  groupId: string;
  groupCode: string;
  subgroupNumber: number | null;
  itemCode: string;
  itemName: string;
  lessonType: string;
  teacherId: string | null;
  teacherName: string | null;
  classroomId: string | null;
  classroomCode: string | null;
  streamKey: string | null;
  isManual: boolean;
}

interface PermanentUnplaced {
  groupCodes: string[];
  subgroupNumber: number | null;
  itemCode: string;
  itemName: string;
  lessonType: string;
  teacherName: string | null;
  lessonsPerWeek: number;
  missingPerWeek: number | null;
  reason: string;
}

interface PermanentDetails extends PermanentListItem {
  notes: string | null;
  educationLevels: string[];
  workingDays: number[];
  lessonsPerDay: number;
  lessonTimes: Array<{ lessonNumber: number; startTime: string; endTime: string }>;
  lessons: PermanentLesson[];
  result: {
    stats: PermanentStats;
    semesters: Array<{ id: string; number: number }>;
    range: { from: string; to: string };
    groupLoad: Array<{ groupId: string; groupCode: string; lessonsPerWeek: number }>;
    unplaced: PermanentUnplaced[];
    warnings: string[];
    log: string[];
  } | null;
}

type View = 'group' | 'teacher' | 'classroom';

const RUNNING: JobStatus[] = ['QUEUED', 'GENERATING'];
const PARITY_LABEL: Record<Parity, string> = { ANY: 'Каждую неделю', ODD: 'Числитель', EVEN: 'Знаменатель' };
const PARITY_SHORT: Record<Parity, string> = { ANY: '', ODD: 'числ.', EVEN: 'знам.' };
const TYPE_BORDER: Record<string, string> = {
  LECTURE: 'border-l-blue-500',
  PRACTICAL: 'border-l-emerald-500',
  LABORATORY: 'border-l-violet-500',
  CONSULTATION: 'border-l-amber-500',
  PRACTICE: 'border-l-orange-500',
  OTHER: 'border-l-slate-400',
};

const weekly = (n: number) => formatNumber(n, Number.isInteger(n) ? 0 : 1);

function StatusBadge({ s }: { s: Pick<PermanentListItem, 'approvedAt' | 'jobStatus'> }) {
  if (s.jobStatus && RUNNING.includes(s.jobStatus)) return <Badge variant="info">Формируется</Badge>;
  if (s.jobStatus === 'FAILED') return <Badge variant="destructive">Ошибка</Badge>;
  if (s.approvedAt) return <Badge variant="success">Утверждено</Badge>;
  return <Badge variant="muted">Черновик</Badge>;
}

export default function PermanentSchedulePage() {
  const { canEdit } = useAuth();
  const [params, setParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const list = useApi<PermanentListItem[]>(['permanent-schedules'], '/permanent-schedules', undefined, {
    refetchInterval: (q) =>
      (q.state.data as PermanentListItem[] | undefined)?.some((s) => RUNNING.includes(s.jobStatus)) ? 2000 : false,
  });
  const selectedId = params.get('id') ?? list.data?.[0]?.id ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Постоянное расписание"
        description="Типовая неделя для руководства: нагрузка семестра распределена равномерно, недоступность, пожелания и лимиты преподавателей не учитываются. Рабочее расписание по датам со всеми ограничениями от этой сетки не зависит."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/schedule">
                <ArrowLeft /> Рабочее расписание
              </Link>
            </Button>
            {canEdit && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus /> Новое постоянное расписание
              </Button>
            )}
          </>
        }
      />

      {list.isLoading ? (
        <LoadingState rows={3} />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState
          title="Постоянного расписания пока нет"
          description="Создайте его: программа возьмёт текущие семестры групп на выбранную дату и разложит нагрузку по типовой неделе."
          action={
            canEdit && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus /> Создать
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {list.data!.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setParams({ id: s.id })}
                className={cn(
                  'lift min-w-56 shrink-0 rounded-xl border bg-card px-3 py-2.5 text-left transition',
                  s.id === selectedId ? 'border-primary ring-primary/30 ring-2' : 'hover:border-primary/40',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{s.title}</span>
                  <StatusBadge s={s} />
                </div>
                <div className="text-muted-foreground mt-1 text-xs">
                  на {formatDate(s.date)}
                  {s.stats ? ` · ${weekly(s.stats.placedWeekly)} пар в неделю` : ''}
                </div>
              </button>
            ))}
          </div>
          {selectedId && <PermanentDetailsView id={selectedId} onDeleted={() => setParams({})} />}
        </>
      )}

      <CreateDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => setParams({ id })} />
    </div>
  );
}

function PermanentDetailsView({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const { canEdit } = useAuth();
  const [view, setView] = useState<View>('group');
  const [entity, setEntity] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [editing, setEditing] = useState<PermanentLesson | null>(null);
  const [unplacedOpen, setUnplacedOpen] = useState(false);
  const q = useApi<PermanentDetails>(['permanent-schedule', id], `/permanent-schedules/${id}`, undefined, {
    refetchInterval: (query) =>
      RUNNING.includes((query.state.data as PermanentDetails | undefined)?.jobStatus ?? null) ? 1500 : false,
  });
  const invalidate = [['permanent-schedule', id], ['permanent-schedules']];
  const regenerate = useApiMutation(() => api.post(`/permanent-schedules/${id}/generate`, {}), {
    success: 'Формирование запущено',
    invalidate,
  });
  const approve = useApiMutation(
    (on: boolean) => api.post(`/permanent-schedules/${id}/${on ? 'approve' : 'unapprove'}`),
    { success: (r) => ((r as PermanentDetails).approvedAt ? 'Расписание утверждено' : 'Утверждение снято'), invalidate },
  );
  const remove = useApiMutation(() => api.delete(`/permanent-schedules/${id}`), {
    success: 'Удалено',
    invalidate: [['permanent-schedules']],
    onSuccess: onDeleted,
  });

  const data = q.data;
  const lessons = useMemo(() => data?.lessons ?? [], [data]);
  const options = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of lessons) {
      if (view === 'group') map.set(l.groupId, l.groupCode);
      else if (view === 'teacher' && l.teacherId) map.set(l.teacherId, l.teacherName ?? '');
      else if (view === 'classroom' && l.classroomId) map.set(l.classroomId, l.classroomCode ?? '');
    }
    return [...map].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }, [lessons, view]);
  useEffect(() => {
    if (!options.some((o) => o.value === entity)) setEntity(options[0]?.value ?? null);
  }, [options, entity]);

  if (q.isLoading) return <LoadingState rows={6} />;
  if (q.error || !data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const running = RUNNING.includes(data.jobStatus);
  const editable = canEdit && !data.approvedAt && !running;
  const stats = data.result?.stats;
  const shown = lessons.filter((l) =>
    view === 'group' ? l.groupId === entity : view === 'teacher' ? l.teacherId === entity : l.classroomId === entity,
  );
  const usedNumbers = lessons.map((l) => l.lessonNumber);
  const maxLesson = Math.max(data.lessonsPerDay, ...usedNumbers, 1);
  const days = data.workingDays;
  const timeOf = (n: number) => data.lessonTimes.find((t) => t.lessonNumber === n);
  const loadOf = data.result?.groupLoad.find((g) => g.groupId === entity);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">{data.title}</h2>
                <StatusBadge s={data} />
              </div>
              <p className="text-muted-foreground text-sm">
                Семестры групп на {formatDate(data.date)}
                {data.result ? ` (${formatDate(data.result.range.from)} — ${formatDate(data.result.range.to)})` : ''}
                {data.educationLevels.length
                  ? ` · ${data.educationLevels.map((l) => EDUCATION_LEVEL_LABELS[l] ?? l).join(', ')}`
                  : ' · все уровни образования'}
                {data.approvedAt ? ` · утверждено ${formatDateTime(data.approvedAt)}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setPrintOpen(true)} disabled={lessons.length === 0}>
                <Printer /> Печать
              </Button>
              {canEdit && !data.approvedAt && (
                <Confirm
                  trigger={
                    <Button variant="outline" disabled={running || regenerate.isPending}>
                      <RefreshCw /> Сформировать заново
                    </Button>
                  }
                  title="Сформировать сетку заново?"
                  description="Нагрузка будет заново разложена по типовой неделе по текущим учебным планам и назначениям. Ручные правки этой версии заменятся."
                  confirmText="Сформировать"
                  onConfirm={() => regenerate.mutate(undefined)}
                />
              )}
              {canEdit &&
                (data.approvedAt ? (
                  <Button variant="outline" onClick={() => approve.mutate(false)} disabled={approve.isPending}>
                    <Undo2 /> Снять утверждение
                  </Button>
                ) : (
                  <Button onClick={() => approve.mutate(true)} disabled={running || approve.isPending || lessons.length === 0}>
                    <BadgeCheck /> Утвердить
                  </Button>
                ))}
              {canEdit && !data.approvedAt && (
                <Confirm
                  trigger={
                    <Button variant="ghost" size="icon" aria-label="Удалить" disabled={running}>
                      <Trash2 />
                    </Button>
                  }
                  title="Удалить постоянное расписание?"
                  description={`«${data.title}» будет удалено. Рабочее расписание по датам не изменится.`}
                  confirmText="Удалить"
                  destructive
                  onConfirm={() => remove.mutate(undefined)}
                />
              )}
            </div>
          </div>

          {running && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm">
                <Spinner /> {data.message ?? 'Формирование…'}
              </div>
              <Progress value={data.progress} />
            </div>
          )}
          {data.jobStatus === 'FAILED' && (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertDescription>{data.message}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {stats && !running && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Пар в типовой неделе"
            value={weekly(stats.placedWeekly)}
            hint={stats.requiredWeekly > stats.placedWeekly ? `нужно ${weekly(stats.requiredWeekly)}` : 'вся нагрузка'}
            icon={CalendarClock}
            tone={stats.requiredWeekly > stats.placedWeekly ? 'warning' : 'success'}
          />
          <StatCard
            title="Групп / преподавателей"
            value={`${stats.groups} / ${stats.teachers}`}
            hint={stats.withoutRoom ? `${stats.withoutRoom} пар без аудитории — не хватило аудиторий` : 'все пары с аудиторией'}
            icon={Users}
          />
          <StatCard
            title="Числитель / знаменатель"
            value={stats.biweekly}
            hint="пар через неделю"
            icon={Layers}
            tone="info"
          />
          <StatCard
            title="Не вошло в сетку"
            value={stats.unplaced}
            hint={stats.unplaced ? 'дисциплин — подробнее ниже' : 'всё распределено'}
            icon={TriangleAlert}
            tone={stats.unplaced ? 'danger' : 'success'}
            onClick={stats.unplaced ? () => setUnplacedOpen(true) : undefined}
          />
        </div>
      )}

      {data.result && !running && (data.result.unplaced.length > 0 || data.result.warnings.length > 0) && (
        <Card className="py-0">
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
            onClick={() => setUnplacedOpen((v) => !v)}
            aria-expanded={unplacedOpen}
          >
            <span className="flex items-center gap-2">
              <TriangleAlert className="size-4 text-amber-500" />
              Замечания: {data.result.unplaced.length} не распределено, {data.result.warnings.length} предупреждений
            </span>
            <ChevronDown className={cn('size-4 transition-transform', unplacedOpen && 'rotate-180')} />
          </button>
          {unplacedOpen && (
            <div className="space-y-2 border-t px-4 py-3 text-sm">
              {data.result.unplaced.map((u, i) => (
                <div key={i} className="rounded-lg border p-2.5">
                  <div className="font-medium">
                    {u.groupCodes.join(', ')}
                    {u.subgroupNumber ? ` (п/г ${u.subgroupNumber})` : ''} · {u.itemCode} {u.itemName} ·{' '}
                    {LESSON_TYPE_SHORT[u.lessonType] ?? u.lessonType}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {u.teacherName ?? 'преподаватель не назначен'}
                    {u.missingPerWeek !== null
                      ? ` · поставлено ${weekly(u.lessonsPerWeek)}, не хватило ${weekly(u.missingPerWeek)} пар в неделю`
                      : ' · не вошла в сетку'}
                  </div>
                  <div className="mt-1 text-xs">{u.reason}</div>
                </div>
              ))}
              {data.result.warnings.map((w, i) => (
                <p key={`w${i}`} className="text-muted-foreground flex gap-2 text-xs">
                  <Info className="mt-0.5 size-3.5 shrink-0" /> {w}
                </p>
              ))}
            </div>
          )}
        </Card>
      )}

      {lessons.length > 0 && (
        <Card>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <Tabs value={view} onValueChange={(v) => setView(v as View)}>
                <TabsList>
                  <TabsTrigger value="group">Группы</TabsTrigger>
                  <TabsTrigger value="teacher">Преподаватели</TabsTrigger>
                  <TabsTrigger value="classroom">Аудитории</TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="flex items-center gap-3">
                {view === 'group' && loadOf && (
                  <span className="text-muted-foreground text-sm whitespace-nowrap">
                    {weekly(loadOf.lessonsPerWeek)} пар в неделю
                  </span>
                )}
                <SimpleSelect
                  className="w-full md:w-72"
                  value={entity}
                  onChange={setEntity}
                  options={options}
                  placeholder="Выберите…"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] table-fixed border-separate border-spacing-1 text-sm">
                <thead>
                  <tr>
                    <th className="text-muted-foreground w-20 text-left text-xs font-medium">Пара</th>
                    {days.map((d) => (
                      <th key={d} className="text-left text-xs font-semibold">
                        {weekdayName(d)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: maxLesson }, (_, i) => i + 1).map((n) => (
                    <tr key={n}>
                      <td className="text-muted-foreground align-top text-xs">
                        <div className="text-foreground font-semibold">{n}</div>
                        {timeOf(n) && (
                          <div>
                            {timeOf(n)!.startTime}–{timeOf(n)!.endTime}
                          </div>
                        )}
                      </td>
                      {days.map((d) => {
                        const cell = shown
                          .filter((l) => l.weekday === d && l.lessonNumber === n)
                          .sort((a, b) => a.weekParity.localeCompare(b.weekParity) || (a.subgroupNumber ?? 0) - (b.subgroupNumber ?? 0));
                        return (
                          <td key={d} className="bg-muted/30 h-14 rounded-lg p-1 align-top">
                            <div className="space-y-1">
                              {dedupeStream(cell, view).map((l) => (
                                <PermanentCard
                                  key={l.id}
                                  lesson={l}
                                  view={view}
                                  groups={view === 'group' ? undefined : streamGroups(lessons, l)}
                                  onClick={editable ? () => setEditing(l) : undefined}
                                />
                              ))}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-muted-foreground text-xs">
              Числитель — нечётные недели семестра, знаменатель — чётные.
              {editable ? ' Нажмите на пару, чтобы перенести её или сменить преподавателя и аудиторию.' : ''}
              {canEdit && data.approvedAt ? ' Чтобы изменить утверждённое расписание, снимите утверждение.' : ''}
            </p>
          </CardContent>
        </Card>
      )}

      <PrintFormDialog open={printOpen} onOpenChange={setPrintOpen} permanentId={id} />
      <LessonDialog
        scheduleId={id}
        lesson={editing}
        days={days}
        lessonsPerDay={data.lessonsPerDay}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

/** Пара потока у преподавателя или в аудитории показывается один раз */
function dedupeStream(cell: PermanentLesson[], view: View) {
  if (view === 'group') return cell;
  const seen = new Set<string>();
  return cell.filter((l) => {
    if (!l.streamKey) return true;
    const key = `${l.streamKey}|${l.weekParity}|${l.lessonType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function streamGroups(all: PermanentLesson[], l: PermanentLesson): string {
  if (!l.streamKey) return `${l.groupCode}${l.subgroupNumber ? ` · п/г ${l.subgroupNumber}` : ''}`;
  return all
    .filter(
      (x) =>
        x.streamKey === l.streamKey &&
        x.weekday === l.weekday &&
        x.lessonNumber === l.lessonNumber &&
        x.weekParity === l.weekParity,
    )
    .map((x) => x.groupCode)
    .join(', ');
}

function PermanentCard({
  lesson: l,
  view,
  groups,
  onClick,
}: {
  lesson: PermanentLesson;
  view: View;
  groups?: string;
  onClick?: () => void;
}) {
  const second =
    view === 'group'
      ? [l.subgroupNumber ? `п/г ${l.subgroupNumber}` : null, shortName(l.teacherName)].filter(Boolean).join(' · ')
      : groups;
  const third = view === 'classroom' ? shortName(l.teacherName) : (l.classroomCode ?? 'без ауд.');
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
      className={cn(
        'bg-card w-full min-w-0 rounded-lg border border-l-[3px] px-1.5 py-1 text-[11px] leading-tight shadow-xs transition duration-200',
        TYPE_BORDER[l.lessonType],
        onClick && 'hover:shadow-soft cursor-pointer hover:-translate-y-px',
        l.weekParity !== 'ANY' && 'border-dashed',
      )}
      title={`${l.itemCode} ${l.itemName}`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="line-clamp-2 font-medium">{l.itemName}</span>
        {l.weekParity !== 'ANY' && (
          <Badge variant={l.weekParity === 'ODD' ? 'violet' : 'info'} className="shrink-0 px-1 py-0 text-[9px]">
            {PARITY_SHORT[l.weekParity]}
          </Badge>
        )}
      </div>
      <div className="text-muted-foreground truncate">{second}</div>
      <div className="text-muted-foreground flex justify-between gap-1">
        <span className="truncate">{third}</span>
        <span>{LESSON_TYPE_SHORT[l.lessonType] ?? ''}</span>
      </div>
    </div>
  );
}

function LessonDialog({
  scheduleId,
  lesson,
  days,
  lessonsPerDay,
  onClose,
}: {
  scheduleId: string;
  lesson: PermanentLesson | null;
  days: number[];
  lessonsPerDay: number;
  onClose: () => void;
}) {
  const teachers = useTeachers(!!lesson);
  const classrooms = useClassrooms(!!lesson);
  const [form, setForm] = useState({
    weekday: 1,
    lessonNumber: 1,
    weekParity: 'ANY' as Parity,
    teacherId: null as string | null,
    classroomId: null as string | null,
  });
  useEffect(() => {
    if (lesson)
      setForm({
        weekday: lesson.weekday,
        lessonNumber: lesson.lessonNumber,
        weekParity: lesson.weekParity,
        teacherId: lesson.teacherId,
        classroomId: lesson.classroomId,
      });
  }, [lesson]);
  const invalidate = [['permanent-schedule', scheduleId]];
  const save = useApiMutation(
    () => api.patch(`/permanent-schedules/${scheduleId}/lessons/${lesson!.id}`, form),
    { success: 'Пара изменена', invalidate, onSuccess: onClose },
  );
  const remove = useApiMutation(() => api.delete(`/permanent-schedules/${scheduleId}/lessons/${lesson!.id}`), {
    success: 'Пара убрана из сетки',
    invalidate,
    onSuccess: onClose,
  });
  return (
    <Dialog open={!!lesson} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{lesson?.itemName}</DialogTitle>
          <DialogDescription>
            {lesson?.groupCode}
            {lesson?.subgroupNumber ? `, подгруппа ${lesson.subgroupNumber}` : ''}
            {lesson?.streamKey ? ' · поток: изменение применится ко всем группам потока' : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="День">
            <SimpleSelect
              value={String(form.weekday)}
              onChange={(v) => v && setForm((f) => ({ ...f, weekday: Number(v) }))}
              options={days.map((d) => ({ value: String(d), label: weekdayName(d) }))}
            />
          </Field>
          <Field label="Пара">
            <SimpleSelect
              value={String(form.lessonNumber)}
              onChange={(v) => v && setForm((f) => ({ ...f, lessonNumber: Number(v) }))}
              options={Array.from({ length: lessonsPerDay }, (_, i) => ({ value: String(i + 1), label: `${i + 1} пара` }))}
            />
          </Field>
          <Field label="Неделя">
            <SimpleSelect
              value={form.weekParity}
              onChange={(v) => v && setForm((f) => ({ ...f, weekParity: v as Parity }))}
              options={(['ANY', 'ODD', 'EVEN'] as Parity[]).map((p) => ({ value: p, label: PARITY_LABEL[p] }))}
            />
          </Field>
        </div>
        <Field label="Преподаватель">
          <SimpleSelect
            value={form.teacherId}
            onChange={(v) => setForm((f) => ({ ...f, teacherId: v }))}
            allowEmpty
            emptyLabel="Не назначен"
            options={(teachers.data ?? [])
              .filter((t) => t.isActive || t.id === form.teacherId)
              .map((t) => ({ value: t.id, label: t.fullName }))}
          />
        </Field>
        <Field label="Аудитория">
          <SimpleSelect
            value={form.classroomId}
            onChange={(v) => setForm((f) => ({ ...f, classroomId: v }))}
            allowEmpty
            emptyLabel="Без аудитории"
            options={(classrooms.data ?? []).map((c) => ({ value: c.id, label: c.code }))}
          />
        </Field>
        <p className="text-muted-foreground text-xs">
          Недоступность и лимиты преподавателя здесь не проверяются — только накладки: группа, преподаватель или
          аудитория в двух местах одновременно.
        </p>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" className="text-destructive" onClick={() => remove.mutate(undefined)} disabled={remove.isPending}>
            <Trash2 /> Убрать из сетки
          </Button>
          <Button onClick={() => save.mutate(undefined)} disabled={save.isPending}>
            {save.isPending && <Spinner />} Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Новое постоянное расписание</DialogTitle>
          <DialogDescription>
            Для каждой группы берётся семестр, идущий на выбранную дату, и вся его нагрузка раскладывается по
            типовой неделе равномерно. Недоступность, пожелания и лимиты преподавателей не учитываются.
          </DialogDescription>
        </DialogHeader>
        <PermanentCreateForm
          resetKey={open}
          onCreated={(id) => {
            onOpenChange(false);
            onCreated(id);
          }}
          extraActions={
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  );
}
