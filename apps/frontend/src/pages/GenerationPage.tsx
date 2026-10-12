import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Play,
  Square,
  Upload,
  XCircle,
} from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Confirm } from '@/components/common/confirm';
import { Field } from '@/components/common/field';
import { AllGroupsPlanCard, LEVEL_FILTER_OPTIONS, type LevelFilter, levelsOf } from '@/components/generation/all-groups';
import { UnplacedList } from '@/components/generation/unplaced';
import { PageHeader } from '@/components/common/page-header';
import { SimpleSelect } from '@/components/common/simple-select';
import { EmptyState, ErrorState, LoadingState, Spinner } from '@/components/common/states';
import { JobStatusBadge, PeriodStatusBadge } from '@/components/common/status-badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useGroups, usePeriods, useSemesters, useSettings } from '@/hooks/use-reference';
import { api } from '@/lib/api';
import { addDays, formatDate, formatDateShort, formatDateTime, formatNumber, isoWeekday, today, weekStart, weekdayName } from '@/lib/format';
import { LESSON_TYPE_SHORT, SOFT_VIOLATION_LABELS, SOLVER_LABELS } from '@/lib/labels';
import { useApi, useApiMutation } from '@/lib/query';
import type { AllGroupsPlan, GenerationJob, GenerationResult, PreviewLesson, SchedulePeriod } from '@/lib/types';
import { cn } from '@/lib/utils';

const ACTIVE_JOB = ['QUEUED', 'GENERATING', 'VALIDATING'];

const schema = z
  .object({
    mode: z.enum(['CALENDAR', 'WEEKLY_TEMPLATE']),
    groupIds: z.array(z.string()),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    solver: z.enum(['auto', 'cp-sat', 'heuristic']),
    timeLimitSeconds: z.number({ invalid_type_error: 'Введите число' }).int().min(5, 'Не менее 5 секунд').max(3600, 'Не более 3600 секунд'),
    lessonsPerDay: z.number({ invalid_type_error: 'Введите число' }).int().min(1).max(10, 'Не более 10 пар'),
    maxGroupLessonsPerDay: z.number({ invalid_type_error: 'Введите число' }).int().min(1, 'Не менее 1').max(10, 'Не более 10'),
    maxSameDisciplinePerDay: z.number({ invalid_type_error: 'Введите число' }).int().min(1, 'Не менее 1').max(6, 'Не более 6'),
    maxSameDisciplinePerWeek: z.number({ invalid_type_error: 'Введите число' }).int().min(1, 'Не менее 1').max(20, 'Не более 20'),
    avoidWindows: z.boolean(),
    allowLateLessons: z.boolean(),
    respectTeacherPreferences: z.boolean(),
    replaceExisting: z.boolean(),
  })
  .refine((v) => !v.dateFrom || !v.dateTo || v.dateFrom <= v.dateTo, {
    message: 'Дата начала не может быть позже даты окончания',
    path: ['dateTo'],
  });
type FormValues = z.infer<typeof schema>;

interface CapacityRow {
  groupId: string;
  groupCode: string;
  regularDays: number;
  blockedDays: number;
  practiceDays: number;
  theoreticalWeeks: number;
  availableLessons: number;
  comfortableLessons: number;
  requiredLessons: number;
  practiceRequiredLessons: number;
  averageLessonsPerWeek: number;
  scheduledLessons: number;
  conductedLessons: number;
  status: 'OK' | 'TIGHT' | 'INSUFFICIENT';
  message: string;
}

interface SolverStatus {
  mode: string;
  cpSatAvailable: boolean;
  version?: string;
  error?: string;
  queue: string;
}

interface ApplyResult {
  created: number;
  deleted: number;
  skipped: Array<{ date: string; lessonNumber: number; groups: string; discipline: string; reason: string }>;
  validation: { errors: number; warnings: number; canPublish: boolean };
}

export default function GenerationPage() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const periods = usePeriods();
  const settings = useSettings();
  const groups = useGroups();
  const solver = useApi<SolverStatus>(['solver-status'], '/solver/status', undefined, { staleTime: 60_000 });
  const [createOpen, setCreateOpen] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  // Охват: один учебный план (период) или все группы организации
  const scope = params.get('scope') === 'period' || params.has('period') ? 'period' : 'all';
  const [allDate, setAllDate] = useState(today());
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('ALL');
  const plan = useApi<AllGroupsPlan>(['all-groups-plan', allDate], scope === 'all' ? `/generation/all/plan?date=${allDate}` : null);

  const period: SchedulePeriod | undefined = useMemo(() => {
    const list = (periods.data ?? []).filter((p) => p.status !== 'ARCHIVED');
    return list.find((p) => p.id === params.get('period')) ?? list[0];
  }, [periods.data, params]);
  const jobId = params.get('job');

  const periodGroups = useMemo(
    () => (groups.data ?? []).filter((g) => g.isActive && g.educationalProgramId === period?.semester.program?.id),
    [groups.data, period],
  );

  const capacity = useApi<CapacityRow[]>(['capacity', period?.semesterId], period ? `/semesters/${period.semesterId}/capacity-forecast` : null);
  const jobsUrl = scope === 'all' ? '/generation-jobs' : period ? `/schedule-periods/${period.id}/generation-jobs` : null;
  const jobs = useApi<GenerationJob[]>(['generation-jobs', scope, period?.id], jobsUrl, undefined, {
    refetchInterval: (q) => ((q.state.data as GenerationJob[] | undefined)?.some((j) => ACTIVE_JOB.includes(j.status)) ? 3000 : false),
  });
  const currentJobId = jobId ?? jobs.data?.[0]?.id ?? null;
  const job = useApi<GenerationJob>(['generation-job', currentJobId], currentJobId ? `/generation-jobs/${currentJobId}` : null, undefined, {
    refetchInterval: (q) => (ACTIVE_JOB.includes((q.state.data as GenerationJob | undefined)?.status ?? '') ? 1500 : false),
  });

  // Сброс кэша списка заданий при завершении
  const jobStatus = job.data?.status;
  useEffect(() => {
    if (jobStatus && !ACTIVE_JOB.includes(jobStatus)) void qc.invalidateQueries({ queryKey: ['generation-jobs'] });
  }, [jobStatus, qc]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      mode: 'CALENDAR',
      groupIds: [],
      solver: 'auto',
      timeLimitSeconds: 60,
      lessonsPerDay: 6,
      maxGroupLessonsPerDay: 4,
      maxSameDisciplinePerDay: 2,
      maxSameDisciplinePerWeek: 6,
      avoidWindows: true,
      allowLateLessons: false,
      respectTeacherPreferences: true,
      replaceExisting: true,
    },
  });
  const s = settings.data?.settings;
  useEffect(() => {
    if (!s) return;
    form.reset({
      ...form.getValues(),
      timeLimitSeconds: s.solverTimeLimitSeconds,
      lessonsPerDay: s.lessonsPerDay,
      maxGroupLessonsPerDay: s.maxGroupLessonsPerDay,
      maxSameDisciplinePerDay: s.maxSameDisciplinePerDay,
      maxSameDisciplinePerWeek: s.maxSameDisciplinePerWeek,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);
  useEffect(() => {
    form.setValue('groupIds', []);
    form.setValue('dateFrom', undefined);
    form.setValue('dateTo', undefined);
  }, [period?.id, form]);

  const generate = useApiMutation((values: FormValues) => api.post<GenerationJob>(`/schedule-periods/${period!.id}/generate`, values), {
    success: 'Генерация запущена',
    invalidate: [['generation-jobs']],
    onSuccess: (j) => {
      setApplyResult(null);
      setParams({ period: period!.id, job: j.id }, { replace: true });
    },
  });
  const generateAll = useApiMutation(
    (values: FormValues) =>
      api.post<{ job: GenerationJob; createdPeriods: number }>('/generation/all', {
        ...values,
        groupIds: undefined,
        date: allDate,
        educationLevels: levelsOf(levelFilter),
      }),
    {
      success: (r) => `Генерация для всех групп запущена${r.createdPeriods ? `, создано периодов расписания: ${r.createdPeriods}` : ''}`,
      invalidate: [['generation-jobs'], ['schedule-periods'], ['all-groups-plan']],
      onSuccess: (r) => {
        setApplyResult(null);
        setParams({ scope: 'all', job: r.job.id }, { replace: true });
      },
    },
  );
  const setScope = (next: 'all' | 'period') => {
    setApplyResult(null);
    setParams(next === 'all' ? { scope: 'all' } : { scope: 'period', ...(period ? { period: period.id } : {}) }, { replace: true });
  };
  const cancel = useApiMutation((id: string) => api.post(`/generation-jobs/${id}/cancel`), {
    success: 'Задание отменено',
    invalidate: [['generation-jobs'], ['generation-job']],
  });
  const apply = useApiMutation((id: string) => api.post<ApplyResult>(`/generation-jobs/${id}/apply`), {
    success: (r) => `Расписание применено: создано ${r.created}, удалено ${r.deleted}`,
    invalidate: [['generation-jobs'], ['generation-job'], ['lessons'], ['schedule-periods'], ['hour-control'], ['validation'], ['capacity'], ['dashboard']],
    onSuccess: (r) => setApplyResult(r),
  });

  if (periods.isLoading) return <LoadingState rows={8} />;
  if (periods.error) return <ErrorState error={periods.error} onRetry={() => periods.refetch()} />;

  const selectedGroups = form.watch('groupIds');
  const running = !!job.data && ACTIVE_JOB.includes(job.data.status);
  const result = job.data?.result as GenerationResult | null | undefined;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Составление расписания"
        description="По учебным планам, календарному графику, нагрузке и ограничениям преподавателей"
        actions={
          <div className="bg-muted inline-flex h-9 rounded-md p-0.5">
            {(
              [
                ['all', 'Все группы'],
                ['period', 'Один учебный план'],
              ] as const
            ).map(([value, text]) => (
              <button
                key={value}
                type="button"
                onClick={() => setScope(value)}
                className={cn(
                  'rounded px-3 text-sm font-medium transition-colors',
                  scope === value ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {text}
              </button>
            ))}
          </div>
        }
      />

      {scope === 'period' && !period ? (
        <EmptyState
          title="Нет периодов расписания"
          description="Создайте период расписания для семестра, затем запустите генерацию"
          action={<Button onClick={() => setCreateOpen(true)}>Создать период</Button>}
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[400px_1fr]">
          <div className="min-w-0 space-y-4">
            <Card>
              <CardContent className="pt-1">
                <form className="space-y-4" onSubmit={form.handleSubmit((v) => (scope === 'all' ? generateAll.mutate(v) : generate.mutate(v)))}>
                  {scope === 'all' ? (
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Семестр групп на дату">
                        <Input type="date" value={allDate} onChange={(e) => e.target.value && setAllDate(e.target.value)} />
                      </Field>
                      <Field label="Уровень образования">
                        <SimpleSelect value={levelFilter} onChange={(v) => setLevelFilter((v as LevelFilter) ?? 'ALL')} options={LEVEL_FILTER_OPTIONS} />
                      </Field>
                    </div>
                  ) : (
                    <>
                      <Field
                        label="Период расписания"
                        hint={
                          period && (
                            <span className="flex items-center gap-2">
                              {formatDate(period.startDate)} — {formatDate(period.endDate)} <PeriodStatusBadge status={period.status} />
                            </span>
                          )
                        }
                      >
                        <div className="flex gap-2">
                          <SimpleSelect
                            value={period?.id ?? null}
                            onChange={(v) => v && setParams({ period: v }, { replace: true })}
                            options={(periods.data ?? []).filter((p) => p.status !== 'ARCHIVED').map((p) => ({ value: p.id, label: p.title }))}
                            className="min-w-0 flex-1"
                          />
                          <Button type="button" variant="outline" size="icon" onClick={() => setCreateOpen(true)} aria-label="Новый период" title="Новый период">
                            <CalendarPlus />
                          </Button>
                        </div>
                      </Field>
                      <Field label="Группы" hint="Не выбрано — все группы учебного плана">
                        <div className="grid max-h-32 grid-cols-3 gap-1.5 overflow-y-auto rounded-md border p-2 scrollbar-thin">
                          {periodGroups.map((g) => (
                            <label key={g.id} className="flex cursor-pointer items-center gap-2 text-sm">
                              <Checkbox
                                checked={selectedGroups.includes(g.id)}
                                onCheckedChange={(c) =>
                                  form.setValue('groupIds', c ? [...selectedGroups, g.id] : selectedGroups.filter((x) => x !== g.id))
                                }
                              />
                              {g.code}
                            </label>
                          ))}
                          {periodGroups.length === 0 && <span className="text-muted-foreground text-xs">Нет активных групп</span>}
                        </div>
                      </Field>
                    </>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="С даты" error={form.formState.errors.dateFrom?.message}>
                      <Input type="date" min={period?.startDate} max={period?.endDate} {...form.register('dateFrom', { setValueAs: (v) => v || undefined })} />
                    </Field>
                    <Field label="По дату" error={form.formState.errors.dateTo?.message}>
                      <Input type="date" min={period?.startDate} max={period?.endDate} {...form.register('dateTo', { setValueAs: (v) => v || undefined })} />
                    </Field>
                  </div>
                  <p className="text-muted-foreground -mt-2 text-xs text-pretty">
                    Пусто — весь семестр. «С даты» — пересоставить с этого дня: прошедшее сохранится, оставшиеся часы распределятся по
                    оставшимся неделям.
                  </p>

                  <details className="group/adv rounded-md border">
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium select-none">
                      <ChevronRight className="text-muted-foreground size-4 transition-transform group-open/adv:rotate-90" />
                      Дополнительно
                      <span className="text-muted-foreground ml-auto min-w-0 truncate text-xs font-normal">{advancedSummary(form.watch())}</span>
                    </summary>
                    <div className="space-y-3 border-t p-3">
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Режим" className="col-span-2">
                          <Controller
                            control={form.control}
                            name="mode"
                            render={({ field }) => (
                              <SimpleSelect
                                value={field.value}
                                onChange={(v) => field.onChange(v ?? 'CALENDAR')}
                                options={[
                                  { value: 'CALENDAR', label: 'По датам (рекомендуется)' },
                                  { value: 'WEEKLY_TEMPLATE', label: 'Одинаковая неделя на весь семестр' },
                                ]}
                              />
                            )}
                          />
                        </Field>
                        <Field label="Решатель">
                          <Controller
                            control={form.control}
                            name="solver"
                            render={({ field }) => (
                              <SimpleSelect
                                value={field.value}
                                onChange={(v) => field.onChange(v ?? 'auto')}
                                options={[
                                  { value: 'auto', label: 'Автоматически' },
                                  { value: 'cp-sat', label: 'CP-SAT' },
                                  { value: 'heuristic', label: 'Эвристика (быстро)' },
                                ]}
                              />
                            )}
                          />
                        </Field>
                        <Field label="Лимит времени, с" error={form.formState.errors.timeLimitSeconds?.message}>
                          <Input type="number" {...form.register('timeLimitSeconds', { valueAsNumber: true })} />
                        </Field>
                        <Field label="Пар в сетке дня" error={form.formState.errors.lessonsPerDay?.message}>
                          <Input type="number" {...form.register('lessonsPerDay', { valueAsNumber: true })} />
                        </Field>
                        <Field label="Пар у группы в день" error={form.formState.errors.maxGroupLessonsPerDay?.message}>
                          <Input type="number" {...form.register('maxGroupLessonsPerDay', { valueAsNumber: true })} />
                        </Field>
                        <Field label="Одной дисциплины в день" error={form.formState.errors.maxSameDisciplinePerDay?.message}>
                          <Input type="number" {...form.register('maxSameDisciplinePerDay', { valueAsNumber: true })} />
                        </Field>
                        <Field label="… в неделю" error={form.formState.errors.maxSameDisciplinePerWeek?.message}>
                          <Input type="number" {...form.register('maxSameDisciplinePerWeek', { valueAsNumber: true })} />
                        </Field>
                      </div>
                      <div className="space-y-2.5">
                        {(
                          [
                            ['avoidWindows', 'Убирать окна'],
                            ['allowLateLessons', 'Разрешить поздние пары'],
                            ['respectTeacherPreferences', 'Учитывать пожелания преподавателей'],
                            ['replaceExisting', 'Заменять ранее составленные занятия'],
                          ] as const
                        ).map(([name, text]) => (
                          <Controller
                            key={name}
                            control={form.control}
                            name={name}
                            render={({ field }) => (
                              <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                                {text}
                                <Switch checked={field.value} onCheckedChange={field.onChange} />
                              </label>
                            )}
                          />
                        ))}
                      </div>
                      {solver.data && (
                        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                          <Cpu className="size-3.5" />
                          {solver.data.cpSatAvailable
                            ? `OR-Tools CP-SAT ${solver.data.version ?? ''}: автоматический режим берёт лучший из двух решателей`
                            : 'CP-SAT недоступен — используется эвристика'}
                        </p>
                      )}
                    </div>
                  </details>

                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      size="lg"
                      className="flex-1"
                      disabled={generate.isPending || generateAll.isPending || running || (scope === 'all' && !plan.data?.summary.included)}
                    >
                      {generate.isPending || generateAll.isPending ? <Spinner /> : <Play />} Составить расписание
                    </Button>
                    {running && job.data && (
                      <Button type="button" variant="outline" size="lg" onClick={() => cancel.mutate(job.data!.id)}>
                        <Square /> Остановить
                      </Button>
                    )}
                  </div>
                </form>
              </CardContent>
            </Card>
            {scope === 'all' ? (
              <AllGroupsPlanCard plan={plan.data} filter={levelFilter} loading={plan.isLoading} />
            ) : (
              <CapacityCard rows={capacity.data} loading={capacity.isLoading} />
            )}
          </div>

          <div className="min-w-0 space-y-4">
            {job.isLoading && currentJobId ? (
              <LoadingState rows={6} />
            ) : !job.data ? (
              <EmptyState title="Расписание ещё не составлялось" description="Выберите, что составить, и нажмите «Составить расписание»" />
            ) : (
              <JobPanel
                job={job.data}
                result={result}
                applying={apply.isPending}
                onApply={() => apply.mutate(job.data!.id)}
                applyResult={applyResult}
                lessonsPerDay={form.getValues('lessonsPerDay')}
                workingDays={s?.workingDays ?? [1, 2, 3, 4, 5, 6]}
              />
            )}
            <JobHistory
              jobs={jobs.data ?? []}
              currentJobId={currentJobId}
              onSelect={(id) => setParams(scope === 'all' ? { scope: 'all', job: id } : { period: period!.id, job: id }, { replace: true })}
            />
          </div>
        </div>
      )}
      <CreatePeriodDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => setParams({ period: id }, { replace: true })} />
    </div>
  );
}

/** Краткое описание дополнительных настроек в свёрнутом виде */
function advancedSummary(v: FormValues): string {
  return [
    v.mode === 'CALENDAR' ? 'по датам' : 'одинаковая неделя',
    v.solver === 'auto' ? null : SOLVER_LABELS[v.solver],
    `до ${v.maxGroupLessonsPerDay} пар в день`,
    v.avoidWindows ? 'без окон' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function JobHistory({ jobs, currentJobId, onSelect }: { jobs: GenerationJob[]; currentJobId: string | null; onSelect: (id: string) => void }) {
  const [all, setAll] = useState(false);
  if (jobs.length === 0) return null;
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-base">Предыдущие запуски</CardTitle>
      </CardHeader>
      <CardContent className="px-2">
        <div className="divide-y">
          {jobs.slice(0, all ? undefined : 5).map((j) => {
            const placed = j.stats ? `${j.stats.placedLessons} из ${j.stats.requiredLessons}` : null;
            const pct = j.stats?.requiredLessons ? (j.stats.placedLessons / j.stats.requiredLessons) * 100 : null;
            return (
              <button
                key={j.id}
                type="button"
                onClick={() => onSelect(j.id)}
                className={cn(
                  'hover:bg-muted/60 flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-2 text-left text-sm transition-colors',
                  j.id === currentJobId && 'bg-primary/5',
                )}
                title={j.createdBy?.fullName ? `Запустил: ${j.createdBy.fullName}` : undefined}
              >
                <span className="shrink-0 whitespace-nowrap tabular-nums">{formatDateTime(j.createdAt)}</span>
                <span className="text-muted-foreground hidden min-w-0 flex-1 truncate text-xs sm:block">
                  {j.mode === 'CALENDAR' ? 'по датам' : 'одинаковая неделя'}
                  {j.solver ? ` · ${SOLVER_LABELS[j.solver] ?? j.solver}` : ''}
                </span>
                <span className="ml-auto shrink-0 text-right tabular-nums">
                  {placed ?? '—'}
                  {pct !== null && <span className="text-muted-foreground ml-1 text-xs">({formatNumber(pct, 1)}%)</span>}
                </span>
                <span className="shrink-0 text-right sm:w-28">
                  <JobStatusBadge status={j.status} />
                </span>
              </button>
            );
          })}
        </div>
        {jobs.length > 5 && (
          <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={() => setAll(!all)}>
            {all ? 'Свернуть' : `Все запуски (${jobs.length})`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function CapacityCard({ rows, loading }: { rows?: CapacityRow[]; loading: boolean }) {
  const [all, setAll] = useState(false);
  const list = rows ?? [];
  const problems = list.filter((r) => r.status !== 'OK');
  const shown = all ? list : problems;
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-base">Хватит ли времени на план</CardTitle>
        <CardDescription>
          {loading
            ? 'Считаем…'
            : list.length === 0
              ? 'Нет групп в семестре'
              : problems.length === 0
                ? `Учебного времени хватает всем группам (${list.length})`
                : `Плотно или не хватает: ${problems.length} из ${list.length} групп`}
        </CardDescription>
      </CardHeader>
      {(shown.length > 0 || list.length > 0) && (
        <CardContent className="space-y-2 px-4">
          {shown.map((r) => (
            <div key={r.groupId} className="space-y-1" title={r.message}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{r.groupCode}</span>
                <Badge variant={r.status === 'OK' ? 'success' : r.status === 'TIGHT' ? 'warning' : 'destructive'}>
                  {r.status === 'OK' ? 'Хватает' : r.status === 'TIGHT' ? 'Плотно' : 'Не хватает'}
                </Badge>
              </div>
              <Progress
                value={r.availableLessons ? (r.requiredLessons / r.availableLessons) * 100 : 100}
                className="h-1.5"
                indicatorClassName={r.status === 'OK' ? 'bg-emerald-500' : r.status === 'TIGHT' ? 'bg-amber-500' : 'bg-red-500'}
              />
              {r.status !== 'OK' && <div className="text-muted-foreground text-xs text-pretty">{r.message}</div>}
            </div>
          ))}
          {list.length > problems.length && (
            <Button variant="ghost" size="sm" className="w-full" onClick={() => setAll(!all)}>
              {all ? 'Только требующие внимания' : `Все группы (${list.length})`}
            </Button>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function JobPanel({
  job,
  result,
  applying,
  onApply,
  applyResult,
  lessonsPerDay,
  workingDays,
}: {
  job: GenerationJob;
  result: GenerationResult | null | undefined;
  applying: boolean;
  onApply: () => void;
  applyResult: ApplyResult | null;
  lessonsPerDay: number;
  workingDays: number[];
}) {
  const running = ACTIVE_JOB.includes(job.status);
  const stats = result?.stats;
  const canApply = (job.status === 'COMPLETED' || job.status === 'COMPLETED_WITH_CONFLICTS') && !!result;
  const pct = stats?.requiredLessons ? (stats.placedLessons / stats.requiredLessons) * 100 : 0;
  const soft = stats?.softViolations ?? {};
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              Результат <JobStatusBadge status={job.status} />
            </CardTitle>
            <CardDescription>
              {formatDateTime(job.createdAt)}
              {result?.periods && result.periods.length > 1
                ? ` · ${result.periods.reduce((a, p) => a + p.groupCodes.length, 0)} групп, ${result.periods.length} учебных планов`
                : ''}
            </CardDescription>
          </div>
          {canApply && (
            <Confirm
              trigger={
                <Button disabled={applying}>
                  {applying ? <Spinner /> : <Upload />} Применить
                </Button>
              }
              title="Применить результат?"
              description={`Будет создано ${result!.lessons.length} занятий, заменено ${result!.replaceLessonIds.length} ранее составленных. Закреплённые, ручные и проведённые занятия не изменятся.`}
              confirmText="Применить"
              onConfirm={onApply}
            />
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {running && (
            <div className="space-y-1.5">
              <Progress value={job.progress} />
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Spinner /> {job.message ?? 'Выполняется…'} ({job.progress}%)
              </div>
            </div>
          )}
          {job.status === 'FAILED' && (
            <Alert variant="destructive">
              <XCircle />
              <AlertTitle>Не удалось составить расписание</AlertTitle>
              <AlertDescription>{job.error ?? job.message}</AlertDescription>
            </Alert>
          )}
          {job.status === 'APPLIED' && (
            <Alert variant="success">
              <CheckCircle2 />
              <AlertTitle>Применено {job.appliedAt ? formatDateTime(job.appliedAt) : ''}</AlertTitle>
              <AlertDescription>
                <Link className="underline" to={(job.periodIds?.length ?? 0) > 1 ? '/schedule' : `/schedule?period=${job.schedulePeriodId}`}>
                  Открыть расписание
                </Link>
              </AlertDescription>
            </Alert>
          )}
          {applyResult && (
            <Alert variant={applyResult.validation.errors ? 'warning' : 'success'}>
              <AlertTitle>
                Создано {applyResult.created}, удалено {applyResult.deleted}
                {applyResult.skipped.length ? `, пропущено ${applyResult.skipped.length}` : ''}
              </AlertTitle>
              <AlertDescription>
                {applyResult.validation.canPublish
                  ? 'Ошибок нет — расписание можно публиковать.'
                  : `Ошибок: ${applyResult.validation.errors} — исправьте их перед публикацией.`}
                {applyResult.skipped.slice(0, 5).map((sk, i) => (
                  <div key={i} className="text-xs">
                    {formatDate(sk.date)}, {sk.lessonNumber} пара, {sk.groups}: {sk.discipline} — {sk.reason}
                  </div>
                ))}
              </AlertDescription>
            </Alert>
          )}
          {stats && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-2xl font-semibold tabular-nums">
                  {stats.placedLessons} <span className="text-muted-foreground text-base font-normal">из {stats.requiredLessons} пар</span>
                </span>
                <span className={cn('text-sm font-medium tabular-nums', stats.unplacedLessons ? 'text-amber-600' : 'text-emerald-600')}>
                  {formatNumber(pct, 1)}%
                </span>
              </div>
              <Progress value={pct} indicatorClassName={stats.unplacedLessons ? 'bg-amber-500' : 'bg-emerald-500'} />
              <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {stats.unplacedLessons > 0 && <span className="text-foreground">Не поставлено: {stats.unplacedLessons}</span>}
                <span>Окна: у групп {soft.groupWindows ?? 0}, у преподавателей {soft.teacherWindows ?? 0}</span>
                {!!soft.lateLessons && <span>Поздних пар: {soft.lateLessons}</span>}
                <span>{formatNumber(stats.durationMs / 1000, 0)} с</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {result && stats && (
        <Tabs defaultValue={result.unplaced.length ? 'unplaced' : 'groups'}>
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="unplaced">
              Не поставлено {result.unplaced.length > 0 && <Badge variant="destructive">{stats.unplacedLessons}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="groups">По группам</TabsTrigger>
            <TabsTrigger value="preview">Просмотр</TabsTrigger>
            <TabsTrigger value="details">Подробнее</TabsTrigger>
          </TabsList>
          <TabsContent value="unplaced">
            <UnplacedList items={result.unplaced} />
          </TabsContent>
          <TabsContent value="groups">
            <Card>
              <CardContent className="grid gap-x-6 gap-y-2.5 pt-2 sm:grid-cols-2">
                {[...stats.groups]
                  .sort((a, b) => a.placed / Math.max(1, a.required) - b.placed / Math.max(1, b.required) || a.groupCode.localeCompare(b.groupCode))
                  .map((g) => (
                    <div key={g.groupId}>
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">{g.groupCode}</span>
                        <span className="text-muted-foreground tabular-nums">
                          {g.placed} из {g.required}
                        </span>
                      </div>
                      <Progress
                        value={g.required ? (g.placed / g.required) * 100 : 100}
                        className="mt-1 h-1.5"
                        indicatorClassName={g.placed < g.required ? 'bg-amber-500' : 'bg-emerald-500'}
                      />
                    </div>
                  ))}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="preview">
            <PreviewGrid result={result} lessonsPerDay={lessonsPerDay} workingDays={workingDays} />
          </TabsContent>
          <TabsContent value="details">
            <Card>
              <CardContent className="space-y-4 pt-2">
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {Object.entries(soft).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      {SOFT_VIOLATION_LABELS[k] ?? k}
                      <span className="tabular-nums">{v}</span>
                    </div>
                  ))}
                </div>
                {result.warnings.length > 0 && (
                  <Alert variant="warning">
                    <AlertTriangle />
                    <AlertTitle>Предупреждения</AlertTitle>
                    <AlertDescription>
                      <ul className="list-disc pl-4">
                        {result.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
                {result.periods && result.periods.length > 1 && (
                  <div className="space-y-1 text-xs">
                    <div className="text-sm font-medium">Учебные планы</div>
                    {result.periods.map((p) => (
                      <div key={p.id}>
                        <span className="font-medium">{p.title}</span>
                        <span className="text-muted-foreground"> — {p.groupCodes.join(', ')}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div>
                  <div className="mb-1 text-sm font-medium">
                    Журнал · решатель: {SOLVER_LABELS[job.solver ?? ''] ?? job.solver ?? '—'} · недель: {stats.weeks}
                  </div>
                  <pre className="bg-muted/50 max-h-72 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap scrollbar-thin">
                    {result.log.join('\n') || 'Журнал пуст'}
                  </pre>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function PreviewGrid({ result, lessonsPerDay, workingDays }: { result: GenerationResult; lessonsPerDay: number; workingDays: number[] }) {
  const groupOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of result.lessons) l.groupIds.forEach((id, i) => map.set(id, l.groupCodes[i] ?? id));
    return [...map.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [result.lessons]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const gid = groupId ?? groupOptions[0]?.value ?? null;
  const firstDate = result.lessons.map((l) => l.date).sort()[0] ?? result.range.from;
  const [week, setWeek] = useState(weekStart(firstDate));
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i)).filter((d) => workingDays.includes(isoWeekday(d)));
  const cells = useMemo(() => {
    const map = new Map<string, PreviewLesson[]>();
    for (const l of result.lessons) {
      if (!gid || !l.groupIds.includes(gid)) continue;
      const k = `${l.date}#${l.lessonNumber}`;
      map.set(k, [...(map.get(k) ?? []), l]);
    }
    return map;
  }, [result.lessons, gid]);
  const maxN = Math.max(lessonsPerDay, ...result.lessons.map((l) => l.lessonNumber));
  return (
    <Card>
      <CardContent className="space-y-3 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-48">
            <SimpleSelect value={gid} onChange={setGroupId} options={groupOptions} />
          </div>
          <Button variant="outline" size="icon" onClick={() => setWeek(addDays(week, -7))} aria-label="Предыдущая неделя">
            <ChevronLeft />
          </Button>
          <span className="text-sm font-medium">
            {formatDate(week)} — {formatDate(addDays(week, 6))}
          </span>
          <Button variant="outline" size="icon" onClick={() => setWeek(addDays(week, 7))} aria-label="Следующая неделя">
            <ChevronRight />
          </Button>
        </div>
        <div className="overflow-x-auto rounded-md border scrollbar-thin">
          <table className="w-full min-w-[800px] border-collapse text-xs">
            <thead>
              <tr className="bg-muted/40">
                <th className="w-12 p-2 text-left">Пара</th>
                {days.map((d) => (
                  <th key={d} className="border-l p-2 text-center">
                    {weekdayName(isoWeekday(d), true)} {formatDateShort(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: maxN }, (_, i) => i + 1).map((n) => (
                <tr key={n} className="border-t">
                  <td className="p-2 text-center font-semibold">{n}</td>
                  {days.map((d) => (
                    <td key={d} className="border-l p-1 align-top">
                      {(cells.get(`${d}#${n}`) ?? []).map((l, i) => (
                        <div key={i} className="bg-primary/5 mb-1 rounded border px-1.5 py-1 leading-tight">
                          <div className="font-medium">{l.itemName}</div>
                          <div className="text-muted-foreground">
                            {LESSON_TYPE_SHORT[l.lessonType]}
                            {l.subgroupNumber ? ` · п/г ${l.subgroupNumber}` : ''} · {l.roomCode ?? 'без ауд.'}
                            {l.academicHours === 1 && <span className="ml-1 rounded bg-amber-200 px-1 text-amber-900">1 ч</span>}
                          </div>
                          <div className="text-muted-foreground truncate">{l.teacherName ?? '—'}</div>
                        </div>
                      ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

const periodSchema = z
  .object({
    semesterId: z.string({ required_error: 'Выберите семестр' }).min(1, 'Выберите семестр'),
    title: z.string().trim().min(1, 'Укажите название периода'),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.startDate <= v.endDate, {
    message: 'Дата начала позже даты окончания',
    path: ['endDate'],
  });
type PeriodForm = z.infer<typeof periodSchema>;

function CreatePeriodDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const semesters = useSemesters(open);
  const form = useForm<PeriodForm>({ resolver: zodResolver(periodSchema), defaultValues: { semesterId: '', title: '' } });
  const create = useApiMutation((v: PeriodForm) => api.post<SchedulePeriod>('/schedule-periods', v), {
    success: 'Период создан',
    invalidate: [['schedule-periods']],
    onSuccess: (p) => {
      onOpenChange(false);
      form.reset();
      onCreated(p.id);
    },
  });
  const semesterId = form.watch('semesterId');
  const sem = semesters.data?.find((x) => x.id === semesterId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новый период расписания</DialogTitle>
        </DialogHeader>
        <form id="period-form" className="space-y-3" onSubmit={form.handleSubmit((v) => create.mutate(v))}>
          <Field label="Семестр" required error={form.formState.errors.semesterId?.message}>
            <Controller
              control={form.control}
              name="semesterId"
              render={({ field }) => (
                <SimpleSelect
                  value={field.value || null}
                  onChange={(v) => {
                    field.onChange(v ?? '');
                    const s = semesters.data?.find((x) => x.id === v);
                    if (s && !form.getValues('title')) {
                      form.setValue('title', `${s.program?.title ?? ''}: ${s.number} семестр ${s.academicYear?.title ?? ''}`.trim());
                    }
                  }}
                  options={(semesters.data ?? []).map((s) => ({
                    value: s.id,
                    label: `${s.program?.title ?? ''} · ${s.number} семестр (${formatDate(s.startDate)} — ${formatDate(s.endDate)})`,
                  }))}
                />
              )}
            />
          </Field>
          <Field label="Название" required error={form.formState.errors.title?.message}>
            <Input {...form.register('title')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Начало" hint={sem ? `По умолчанию ${formatDate(sem.startDate)}` : undefined}>
              <Input type="date" {...form.register('startDate', { setValueAs: (v) => v || undefined })} />
            </Field>
            <Field label="Окончание" error={form.formState.errors.endDate?.message} hint={sem ? `По умолчанию ${formatDate(sem.endDate)}` : undefined}>
              <Input type="date" {...form.register('endDate', { setValueAs: (v) => v || undefined })} />
            </Field>
          </div>
          <Label className="text-muted-foreground text-xs font-normal">
            Даты периода должны лежать в пределах семестра. Период можно создать на неделю, месяц или весь семестр.
          </Label>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button type="submit" form="period-form" disabled={create.isPending}>
            {create.isPending && <Spinner />} Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
