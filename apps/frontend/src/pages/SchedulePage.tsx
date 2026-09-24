import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  ListChecks,
  Lock,
  Send,
  ShieldCheck,
  Trash2,
  Undo2,
  Unlock,
  X,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Confirm } from '@/components/common/confirm';
import { PageHeader } from '@/components/common/page-header';
import { SimpleSelect } from '@/components/common/simple-select';
import { EmptyState, ErrorState, LoadingState, Spinner } from '@/components/common/states';
import { PeriodStatusBadge } from '@/components/common/status-badge';
import { CreateLessonDialog } from '@/components/schedule/create-lesson-dialog';
import { issuesFromError, IssuesList } from '@/components/schedule/issues-list';
import { LessonDialog } from '@/components/schedule/lesson-dialog';
import { LessonTypeLegend } from '@/components/schedule/lesson-card';
import { MonthView } from '@/components/schedule/month-view';
import { ScheduleGrid, weekColumns, type GridColumn } from '@/components/schedule/week-grid';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useClassrooms, useGroups, usePeriods, useSettings, useTeachers } from '@/hooks/use-reference';
import { api, downloadFile, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { addDays, formatDate, formatDateLong, isoWeekday, today, weekStart, weekdayName } from '@/lib/format';
import { CANCELLATION_REASON_LABELS } from '@/lib/labels';
import { useApi, useApiMutation } from '@/lib/query';
import type { CalendarEvent, Lesson, SchedulePeriod, ValidationIssue, ValidationSummary } from '@/lib/types';

type View = 'group' | 'teacher' | 'classroom' | 'day' | 'month';

export default function SchedulePage() {
  const { canEdit, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const periods = usePeriods();
  const settings = useSettings();
  const groups = useGroups();
  const teachers = useTeachers(user?.role !== 'STUDENT');
  const classrooms = useClassrooms(user?.role !== 'STUDENT' && user?.role !== 'TEACHER');

  const view = (params.get('view') as View) || (user?.role === 'TEACHER' ? 'teacher' : 'group');
  const periodId = params.get('period');
  const entityId = params.get(view === 'teacher' ? 'teacherId' : view === 'classroom' ? 'classroomId' : 'groupId');
  const [monthRange, setMonthRange] = useState<{ from: string; to: string } | null>(null);
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createInitial, setCreateInitial] = useState<Record<string, string | number | undefined>>({});
  const [bulkMode, setBulkMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingMove, setPendingMove] = useState<{ lesson: Lesson; date: string; lessonNumber: number; issues: ValidationIssue[] } | null>(null);
  const [showValidation, setShowValidation] = useState(false);

  const setParam = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  const period: SchedulePeriod | undefined = useMemo(() => {
    const list = periods.data ?? [];
    return list.find((p) => p.id === periodId) ?? list.find((p) => today() >= p.startDate && today() <= p.endDate) ?? list[0];
  }, [periods.data, periodId]);

  const week = params.get('week') ?? (period ? weekStart(today() >= period.startDate && today() <= period.endDate ? today() : period.startDate) : weekStart(today()));
  const day = params.get('day') ?? (period && today() >= period.startDate && today() <= period.endDate ? today() : (period?.startDate ?? today()));

  // Сущность по умолчанию
  const periodGroups = useMemo(
    () => (groups.data ?? []).filter((g) => !period?.semester.program || g.educationalProgramId === period.semester.program.id),
    [groups.data, period],
  );
  useEffect(() => {
    if (!period) return;
    // Группа из другого учебного плана (после смены периода) заменяется первой группой периода
    if (view === 'group' && periodGroups[0] && (!entityId || !periodGroups.some((g) => g.id === entityId))) {
      setParam({ groupId: periodGroups[0].id });
    }
    if (view === 'teacher' && !entityId) {
      const id = user?.role === 'TEACHER' ? user.teacherId : teachers.data?.[0]?.id;
      if (id) setParam({ teacherId: id });
    }
    if (view === 'classroom' && !entityId && classrooms.data?.[0]) setParam({ classroomId: classrooms.data[0].id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, entityId, period, periodGroups, teachers.data, classrooms.data]);

  const range =
    view === 'month'
      ? (monthRange ?? { from: addDays(period?.startDate ?? today(), 0), to: addDays(period?.startDate ?? today(), 41) })
      : view === 'day'
        ? { from: day, to: day }
        : { from: week, to: addDays(week, 6) };

  const lessonQuery = useApi<Lesson[]>(
    ['lessons', view, period?.id, entityId, range.from, range.to],
    period && (view === 'day' || view === 'month' || entityId) ? '/schedule-lessons' : null,
    {
      periodId: view === 'teacher' || view === 'classroom' ? undefined : period?.id,
      groupId: view === 'group' || (view === 'month' && params.get('groupId')) ? (params.get('groupId') ?? undefined) : undefined,
      teacherId: view === 'teacher' ? (entityId ?? undefined) : undefined,
      classroomId: view === 'classroom' ? (entityId ?? undefined) : undefined,
      from: range.from,
      to: range.to,
    },
  );
  const lessons = lessonQuery.data ?? [];

  const events = useApi<CalendarEvent[]>(['calendar-events', range.from, range.to, period?.semester.program?.id], period ? '/calendar-events' : null, {
    from: range.from,
    to: range.to,
    programId: period?.semester.program?.id,
  });
  const blocked = useMemo(() => {
    const map: Record<string, string> = {};
    const group = periodGroups.find((g) => g.id === params.get('groupId'));
    for (const e of events.data ?? []) {
      if (!e.blocksSchedule || e.teacherId) continue;
      if (view === 'group' && e.studentGroupId && e.studentGroupId !== group?.id) continue;
      for (let d = e.startDate.slice(0, 10); d <= e.endDate.slice(0, 10); d = addDays(d, 1)) {
        if (d >= range.from && d <= range.to) map[d] = e.title;
      }
    }
    return map;
  }, [events.data, periodGroups, params, view, range.from, range.to]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['lessons'] });
    void qc.invalidateQueries({ queryKey: ['hour-control'] });
    void qc.invalidateQueries({ queryKey: ['validation'] });
  };

  const move = useApiMutation(
    (vars: { lesson: Lesson; date: string; lessonNumber: number; force?: boolean }) =>
      api.post(`/schedule-lessons/${vars.lesson.id}/move`, {
        date: vars.date,
        lessonNumber: vars.lessonNumber,
        force: vars.force,
      }),
    {
      success: 'Занятие перенесено',
      onSuccess: () => {
        setPendingMove(null);
        invalidate();
      },
      onError: (e, vars) => {
        const issues = issuesFromError(e);
        if (issues) {
          setPendingMove({ lesson: vars.lesson, date: vars.date, lessonNumber: vars.lessonNumber, issues });
          return true;
        }
        return false;
      },
    },
  );

  const validation = useApi<ValidationIssue[]>(['validation', period?.id], period && canEdit ? `/schedule-periods/${period.id}/validation-results` : null);
  const validate = useApiMutation(() => api.post<ValidationSummary>(`/schedule-periods/${period!.id}/validate`), {
    success: (r) => `Проверка завершена: ошибок ${r.errors}, предупреждений ${r.warnings}`,
    invalidate: [['validation'], ['schedule-periods']],
    onSuccess: () => setShowValidation(true),
  });
  const publish = useApiMutation(() => api.post(`/schedule-periods/${period!.id}/publish`), {
    success: 'Расписание опубликовано. Студенты и преподаватели получили уведомления',
    invalidate: [['schedule-periods'], ['validation']],
    onError: (e) => {
      toast.error(errorMessage(e), { duration: 8000 });
      setShowValidation(true);
      void qc.invalidateQueries({ queryKey: ['validation'] });
      return true;
    },
  });
  const unpublish = useApiMutation(() => api.post(`/schedule-periods/${period!.id}/unpublish`), {
    success: 'Публикация снята',
    invalidate: [['schedule-periods']],
  });

  const bulk = useApiMutation(
    (vars: { action: string; patch?: Record<string, unknown>; reason?: string }) =>
      api.post<{ processed: number; succeeded: number; failed: Array<{ message?: string }> }>('/schedule-lessons/bulk', {
        ids: [...selected],
        ...vars,
      }),
    {
      success: (r) => `Обработано: ${r.succeeded} из ${r.processed}${r.failed.length ? `. Ошибки: ${r.failed[0]?.message}` : ''}`,
      onSuccess: () => {
        setSelected(new Set());
        invalidate();
      },
    },
  );

  const columns: GridColumn[] = useMemo(() => {
    const workingDays = settings.data?.settings.workingDays ?? [1, 2, 3, 4, 5, 6];
    if (view === 'day') {
      return periodGroups.map((g) => ({
        key: g.id,
        date: day,
        title: g.code,
        subtitle: `${g.studentCount} чел.`,
        blocked: blocked[day] ?? null,
        match: (l: Lesson) => l.studentGroupId === g.id,
      }));
    }
    return weekColumns(week, workingDays, view === 'group' ? blocked : {});
  }, [view, periodGroups, day, week, blocked, settings.data]);

  const entityOptions =
    view === 'teacher'
      ? (teachers.data ?? []).map((t) => ({ value: t.id, label: t.fullName }))
      : view === 'classroom'
        ? (classrooms.data ?? []).map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))
        : periodGroups.map((g) => ({ value: g.id, label: g.code }));

  const exportPdf = async (whole: boolean) => {
    if (!period) return;
    const kind = view === 'teacher' ? 'teacher' : view === 'classroom' ? 'classroom' : 'group';
    const id = view === 'teacher' ? entityId : view === 'classroom' ? entityId : (params.get('groupId') ?? periodGroups[0]?.id);
    if (!id) return;
    try {
      await downloadFile(
        `/schedule-periods/${period.id}/export/${kind}/${id}/pdf`,
        whole ? undefined : { from: week, to: addDays(week, 6) },
        'Расписание.pdf',
      );
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (periods.isLoading) return <LoadingState rows={8} />;
  if (periods.error) return <ErrorState error={periods.error} onRetry={() => periods.refetch()} />;
  if (!period) {
    return (
      <EmptyState
        title="Периоды расписания не созданы"
        description="Создайте период и сгенерируйте расписание в разделе «Автосоставление»"
      />
    );
  }

  const errorsCount = (validation.data ?? []).filter((v) => v.severity === 'ERROR').length;
  const editable = canEdit && period.status !== 'ARCHIVED';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Расписание"
        description={`${period.title} · ${formatDate(period.startDate)} — ${formatDate(period.endDate)}`}
        actions={
          <>
            <div className="w-72">
              <SimpleSelect
                value={period.id}
                onChange={(v) => setParam({ period: v, week: null, day: null, groupId: null })}
                options={(periods.data ?? []).map((p) => ({ value: p.id, label: p.title }))}
              />
            </div>
            <PeriodStatusBadge status={period.status} />
            {canEdit && (
              <>
                <Button variant="outline" onClick={() => validate.mutate(undefined)} disabled={validate.isPending}>
                  {validate.isPending ? <Spinner /> : <ShieldCheck />} Проверить
                </Button>
                {period.status === 'PUBLISHED' ? (
                  <Confirm
                    trigger={
                      <Button variant="outline">
                        <Undo2 /> Снять с публикации
                      </Button>
                    }
                    title="Снять расписание с публикации?"
                    description="Студенты и преподаватели перестанут видеть это расписание."
                    onConfirm={() => unpublish.mutate(undefined)}
                  />
                ) : (
                  <Button onClick={() => publish.mutate(undefined)} disabled={publish.isPending}>
                    {publish.isPending ? <Spinner /> : <Send />} Опубликовать
                  </Button>
                )}
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Download /> Экспорт
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>PDF</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => exportPdf(false)}>
                  <FileText /> Текущая неделя
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportPdf(true)}>
                  <FileText /> Весь период
                </DropdownMenuItem>
                {user?.role !== 'TEACHER' && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Excel</DropdownMenuLabel>
                    <DropdownMenuItem
                      onClick={() =>
                        downloadFile(`/schedule-periods/${period.id}/export/excel`, undefined, 'Расписание.xlsx').catch((e) =>
                          toast.error(errorMessage(e)),
                        )
                      }
                    >
                      <FileSpreadsheet /> Период целиком
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {canEdit && (showValidation || errorsCount > 0) && validation.data && (
        <Alert variant={errorsCount ? 'destructive' : validation.data.length ? 'warning' : 'success'}>
          <AlertTitle className="flex items-center justify-between">
            <span>
              Проверка расписания: ошибок {errorsCount}, предупреждений{' '}
              {validation.data.filter((v) => v.severity === 'WARNING').length}
              {errorsCount > 0 && ' — публикация заблокирована'}
            </span>
            <Button variant="ghost" size="icon-sm" onClick={() => setShowValidation(false)}>
              <X />
            </Button>
          </AlertTitle>
          <AlertDescription>
            {validation.data.length === 0 ? (
              'Ошибок и предупреждений нет'
            ) : (
              <div className="max-h-56 w-full overflow-y-auto">
                <IssuesList issues={validation.data} max={100} />
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Card className="py-3">
        <CardContent className="flex flex-wrap items-center gap-2 px-3">
          <Tabs value={view} onValueChange={(v) => setParam({ view: v })}>
            <TabsList>
              <TabsTrigger value="group">Группа</TabsTrigger>
              {user?.role !== 'STUDENT' && <TabsTrigger value="teacher">Преподаватель</TabsTrigger>}
              {canEdit || user?.role === 'MANAGER' ? <TabsTrigger value="classroom">Аудитория</TabsTrigger> : null}
              <TabsTrigger value="day">День</TabsTrigger>
              <TabsTrigger value="month">Месяц</TabsTrigger>
            </TabsList>
          </Tabs>
          {(view === 'group' || view === 'teacher' || view === 'classroom' || view === 'month') && (
            <div className="w-64">
              <SimpleSelect
                value={view === 'month' ? params.get('groupId') : entityId}
                onChange={(v) =>
                  setParam({ [view === 'teacher' ? 'teacherId' : view === 'classroom' ? 'classroomId' : 'groupId']: v })
                }
                allowEmpty={view === 'month'}
                emptyLabel="Все группы"
                options={view === 'month' ? periodGroups.map((g) => ({ value: g.id, label: g.code })) : entityOptions}
                placeholder="Выберите…"
              />
            </div>
          )}
          {view !== 'month' && (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                onClick={() => (view === 'day' ? setParam({ day: addDays(day, -1) }) : setParam({ week: addDays(week, -7) }))}
                aria-label="Назад"
              >
                <ChevronLeft />
              </Button>
              <Input
                type="date"
                className="w-40"
                value={view === 'day' ? day : week}
                onChange={(e) => e.target.value && (view === 'day' ? setParam({ day: e.target.value }) : setParam({ week: weekStart(e.target.value) }))}
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => (view === 'day' ? setParam({ day: addDays(day, 1) }) : setParam({ week: addDays(week, 7) }))}
                aria-label="Вперёд"
              >
                <ChevronRight />
              </Button>
              <Button variant="ghost" onClick={() => setParam({ week: weekStart(today()), day: today() })}>
                Сегодня
              </Button>
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {editable && view !== 'month' && (
              <Button variant={bulkMode ? 'secondary' : 'ghost'} onClick={() => { setBulkMode(!bulkMode); setSelected(new Set()); }}>
                <ListChecks /> Массовое редактирование
              </Button>
            )}
            {editable && (
              <Button
                onClick={() => {
                  setCreateInitial({ groupId: params.get('groupId') ?? undefined, date: view === 'day' ? day : week });
                  setCreateOpen(true);
                }}
              >
                <CalendarPlus /> Добавить занятие
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {bulkMode && selected.size > 0 && (
        <BulkBar
          count={selected.size}
          pending={bulk.isPending}
          onAction={(action, extra) => bulk.mutate({ action, ...extra })}
          onClear={() => setSelected(new Set())}
        />
      )}

      {view === 'day' && <div className="text-sm font-medium">{weekdayName(isoWeekday(day))}, {formatDateLong(day)}{blocked[day] ? ` — ${blocked[day]}` : ''}</div>}

      {lessonQuery.isLoading ? (
        <LoadingState rows={8} />
      ) : lessonQuery.error ? (
        <ErrorState error={lessonQuery.error} onRetry={() => lessonQuery.refetch()} />
      ) : view === 'month' ? (
        <MonthView
          lessons={lessons}
          initialDate={period.startDate > today() || period.endDate < today() ? period.startDate : today()}
          onLessonClick={(l) => setLessonId(l.id)}
          onDatesChange={(from, to) => setMonthRange((r) => (r?.from === from && r?.to === to ? r : { from, to }))}
          showGroup={!params.get('groupId')}
        />
      ) : (
        <ScheduleGrid
          columns={columns}
          lessonTimes={settings.data?.lessonTimes ?? []}
          lessonsPerDay={settings.data?.settings.lessonsPerDay ?? 6}
          lessons={lessons}
          mode={view === 'day' ? 'day' : view}
          editable={editable}
          sameColumnOnly={view === 'day'}
          onLessonClick={(l) => setLessonId(l.id)}
          onMove={(lesson, date, lessonNumber) => move.mutate({ lesson, date, lessonNumber })}
          onCellClick={(date, lessonNumber, col) => {
            setCreateInitial({
              date,
              lessonNumber,
              groupId: view === 'day' ? col.key : view === 'group' ? (params.get('groupId') ?? undefined) : undefined,
              teacherId: view === 'teacher' ? (entityId ?? undefined) : undefined,
              classroomId: view === 'classroom' ? (entityId ?? undefined) : undefined,
            });
            setCreateOpen(true);
          }}
          selectedIds={bulkMode ? selected : undefined}
          onToggleSelect={
            bulkMode
              ? (id) =>
                  setSelected((s) => {
                    const n = new Set(s);
                    if (n.has(id)) n.delete(id);
                    else n.add(id);
                    return n;
                  })
              : undefined
          }
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <LessonTypeLegend />
        <div className="text-muted-foreground text-xs">
          Занятий на экране: {lessons.length}
          {editable && view !== 'month' && ' · перетащите карточку, чтобы перенести занятие'}
        </div>
      </div>

      <LessonDialog lessonId={lessonId} open={!!lessonId} onOpenChange={(o) => !o && setLessonId(null)} onChanged={invalidate} />
      <CreateLessonDialog open={createOpen} onOpenChange={setCreateOpen} period={period} initial={createInitial} onCreated={invalidate} />

      {pendingMove && (
        <Card className="border-destructive/40 fixed right-4 bottom-4 z-40 w-[420px] shadow-xl">
          <CardHeader>
            <CardTitle className="text-base">Перенос: обнаружены конфликты</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm">
              «{pendingMove.lesson.semesterItem.curriculumItem.name}» → {formatDate(pendingMove.date)}, {pendingMove.lessonNumber} пара
            </div>
            <IssuesList issues={pendingMove.issues} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPendingMove(null)}>
                Отмена
              </Button>
              <Button
                variant="destructive"
                onClick={() => move.mutate({ lesson: pendingMove.lesson, date: pendingMove.date, lessonNumber: pendingMove.lessonNumber, force: true })}
              >
                Перенести всё равно
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function BulkBar({
  count,
  pending,
  onAction,
  onClear,
}: {
  count: number;
  pending: boolean;
  onAction: (action: string, extra?: { patch?: Record<string, unknown>; reason?: string }) => void;
  onClear: () => void;
}) {
  const classrooms = useClassrooms();
  const teachers = useTeachers();
  const [classroomId, setClassroomId] = useState<string | null>(null);
  const [teacherId, setTeacherId] = useState<string | null>(null);
  const [shift, setShift] = useState('7');
  const [reason, setReason] = useState('OTHER');
  return (
    <Card className="border-primary/40 py-3">
      <CardContent className="flex flex-wrap items-center gap-2 px-3">
        <Badge>{count}</Badge>
        <span className="text-sm font-medium">выбрано</span>
        <div className="w-44">
          <SimpleSelect value={classroomId} onChange={setClassroomId} placeholder="Аудитория…" options={(classrooms.data ?? []).map((c) => ({ value: c.id, label: c.code }))} size="sm" />
        </div>
        <Button size="sm" variant="outline" disabled={!classroomId || pending} onClick={() => onAction('update', { patch: { classroomId } })}>
          Сменить аудиторию
        </Button>
        <div className="w-52">
          <SimpleSelect value={teacherId} onChange={setTeacherId} placeholder="Преподаватель…" options={(teachers.data ?? []).map((t) => ({ value: t.id, label: t.fullName }))} size="sm" />
        </div>
        <Button size="sm" variant="outline" disabled={!teacherId || pending} onClick={() => onAction('update', { patch: { teacherId } })}>
          Сменить преподавателя
        </Button>
        <Input className="h-8 w-16" type="number" value={shift} onChange={(e) => setShift(e.target.value)} />
        <Button size="sm" variant="outline" disabled={pending} onClick={() => onAction('update', { patch: { shiftDays: Number(shift) } })}>
          Сдвинуть на дни
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => onAction('lock')}>
          <Lock /> Закрепить
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => onAction('unlock')}>
          <Unlock /> Открепить
        </Button>
        <div className="w-48">
          <SimpleSelect value={reason} onChange={(v) => setReason(v ?? 'OTHER')} options={Object.entries(CANCELLATION_REASON_LABELS).map(([value, label]) => ({ value, label }))} size="sm" />
        </div>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => onAction('cancel', { reason })}>
          Отменить
        </Button>
        <Confirm
          trigger={
            <Button size="sm" variant="destructive" disabled={pending}>
              <Trash2 /> Удалить
            </Button>
          }
          title={`Удалить ${count} занятий?`}
          destructive
          confirmText="Удалить"
          onConfirm={() => onAction('delete')}
        />
        <Button size="sm" variant="ghost" onClick={onClear}>
          Сбросить выбор
        </Button>
      </CardContent>
    </Card>
  );
}
