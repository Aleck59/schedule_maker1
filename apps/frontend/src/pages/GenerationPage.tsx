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
  Lightbulb,
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
import { PageHeader } from '@/components/common/page-header';
import { SimpleSelect } from '@/components/common/simple-select';
import { EmptyState, ErrorState, LoadingState, Spinner } from '@/components/common/states';
import { StatCard } from '@/components/common/stat-card';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useGroups, usePeriods, useSemesters, useSettings } from '@/hooks/use-reference';
import { api } from '@/lib/api';
import { addDays, formatDate, formatDateShort, formatDateTime, formatNumber, isoWeekday, weekStart, weekdayName } from '@/lib/format';
import { LESSON_TYPE_LABELS, LESSON_TYPE_SHORT, SOFT_VIOLATION_LABELS } from '@/lib/labels';
import { useApi, useApiMutation } from '@/lib/query';
import type { GenerationJob, GenerationResult, PreviewLesson, SchedulePeriod } from '@/lib/types';
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
  const [allJobs, setAllJobs] = useState(false);

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
  const jobs = useApi<GenerationJob[]>(['generation-jobs', period?.id], period ? `/schedule-periods/${period.id}/generation-jobs` : null, undefined, {
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
        title="Автоматическое составление расписания"
        description="Генерация по учебному плану, календарному графику, нагрузке и ограничениям"
        actions={
          <>
            {solver.data && (
              <Badge variant={solver.data.cpSatAvailable ? 'success' : 'warning'} className="h-7">
                <Cpu />
                {solver.data.cpSatAvailable ? `OR-Tools CP-SAT ${solver.data.version ?? ''}` : 'CP-SAT недоступен — эвристика'}
              </Badge>
            )}
            <Button variant="outline" onClick={() => setCreateOpen(true)}>
              <CalendarPlus /> Новый период
            </Button>
          </>
        }
      />

      {!period ? (
        <EmptyState
          title="Нет периодов расписания"
          description="Создайте период расписания для семестра, затем запустите генерацию"
          action={<Button onClick={() => setCreateOpen(true)}>Создать период</Button>}
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Параметры генерации</CardTitle>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={form.handleSubmit((v) => generate.mutate(v))}>
                  <Field label="Период расписания" required>
                    <SimpleSelect
                      value={period.id}
                      onChange={(v) => v && setParams({ period: v }, { replace: true })}
                      options={(periods.data ?? []).filter((p) => p.status !== 'ARCHIVED').map((p) => ({ value: p.id, label: p.title }))}
                    />
                  </Field>
                  <div className="text-muted-foreground -mt-2 flex items-center gap-2 text-xs">
                    {formatDate(period.startDate)} — {formatDate(period.endDate)} <PeriodStatusBadge status={period.status} />
                  </div>
                  <Field label="Режим">
                    <Controller
                      control={form.control}
                      name="mode"
                      render={({ field }) => (
                        <SimpleSelect
                          value={field.value}
                          onChange={(v) => field.onChange(v ?? 'CALENDAR')}
                          options={[
                            { value: 'CALENDAR', label: 'По датам — календарный (рекомендуется)' },
                            { value: 'WEEKLY_TEMPLATE', label: 'Постоянная неделя с развёрткой' },
                          ]}
                        />
                      )}
                    />
                  </Field>
                  <Field label="Группы" hint="Если не выбрано — все группы программы">
                    <div className="grid max-h-36 grid-cols-2 gap-1.5 overflow-y-auto rounded-md border p-2 scrollbar-thin">
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
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="С даты" error={form.formState.errors.dateFrom?.message}>
                      <Input type="date" min={period.startDate} max={period.endDate} {...form.register('dateFrom', { setValueAs: (v) => v || undefined })} />
                    </Field>
                    <Field label="По дату" error={form.formState.errors.dateTo?.message}>
                      <Input type="date" min={period.startDate} max={period.endDate} {...form.register('dateTo', { setValueAs: (v) => v || undefined })} />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
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
                              { value: 'cp-sat', label: 'OR-Tools CP-SAT' },
                              { value: 'heuristic', label: 'Эвристический' },
                            ]}
                          />
                        )}
                      />
                    </Field>
                    <Field label="Лимит времени, с" error={form.formState.errors.timeLimitSeconds?.message}>
                      <Input type="number" {...form.register('timeLimitSeconds', { valueAsNumber: true })} />
                    </Field>
                    <Field label="Пар в день (сетка)" error={form.formState.errors.lessonsPerDay?.message}>
                      <Input type="number" {...form.register('lessonsPerDay', { valueAsNumber: true })} />
                    </Field>
                    <Field label="Макс. пар у группы в день" error={form.formState.errors.maxGroupLessonsPerDay?.message}>
                      <Input type="number" {...form.register('maxGroupLessonsPerDay', { valueAsNumber: true })} />
                    </Field>
                    <Field label="Одной дисциплины в день" error={form.formState.errors.maxSameDisciplinePerDay?.message}>
                      <Input type="number" {...form.register('maxSameDisciplinePerDay', { valueAsNumber: true })} />
                    </Field>
                    <Field label="Одной дисциплины в неделю" error={form.formState.errors.maxSameDisciplinePerWeek?.message}>
                      <Input type="number" {...form.register('maxSameDisciplinePerWeek', { valueAsNumber: true })} />
                    </Field>
                  </div>
                  <div className="space-y-2.5">
                    {(
                      [
                        ['avoidWindows', 'Минимизировать окна'],
                        ['allowLateLessons', 'Разрешить поздние пары'],
                        ['respectTeacherPreferences', 'Учитывать пожелания преподавателей'],
                        ['replaceExisting', 'Заменить незакреплённые сгенерированные занятия'],
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
                  <Alert variant="info">
                    <AlertDescription className="text-xs">
                      Самостоятельная работа, экзамены, зачёты, защита курсовых, ГИА и выездная практика не ставятся в сетку — они
                      отражаются в календарном графике. Закреплённые, ручные и проведённые занятия сохраняются.
                    </AlertDescription>
                  </Alert>
                  <div className="flex gap-2">
                    <Button type="submit" className="flex-1" disabled={generate.isPending || running}>
                      {generate.isPending ? <Spinner /> : <Play />} Сгенерировать
                    </Button>
                    {running && job.data && (
                      <Button type="button" variant="outline" onClick={() => cancel.mutate(job.data!.id)}>
                        <Square /> Остановить
                      </Button>
                    )}
                  </div>
                </form>
              </CardContent>
            </Card>
            <CapacityCard rows={capacity.data} loading={capacity.isLoading} />
          </div>

          <div className="min-w-0 space-y-4">
            {job.isLoading && currentJobId ? (
              <LoadingState rows={6} />
            ) : !job.data ? (
              <EmptyState title="Генерация ещё не запускалась" description="Задайте параметры и нажмите «Сгенерировать»" />
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
            <Card>
              <CardHeader>
                <CardTitle>История генераций</CardTitle>
              </CardHeader>
              <CardContent>
                {(jobs.data ?? []).length === 0 ? (
                  <div className="text-muted-foreground text-sm">Заданий нет</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Запуск</TableHead>
                        <TableHead>Режим</TableHead>
                        <TableHead>Решатель</TableHead>
                        <TableHead className="text-right">Размещено</TableHead>
                        <TableHead>Статус</TableHead>
                        <TableHead>Автор</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(jobs.data ?? []).slice(0, allJobs ? undefined : 8).map((j) => (
                        <TableRow
                          key={j.id}
                          className={cn('cursor-pointer', j.id === currentJobId && 'bg-primary/5')}
                          onClick={() => setParams({ period: period.id, job: j.id }, { replace: true })}
                        >
                          <TableCell>{formatDateTime(j.createdAt)}</TableCell>
                          <TableCell>{j.mode === 'CALENDAR' ? 'Календарный' : 'Шаблон недели'}</TableCell>
                          <TableCell>{j.solver ?? '—'}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {j.stats ? `${j.stats.placedLessons}/${j.stats.requiredLessons}` : '—'}
                          </TableCell>
                          <TableCell>
                            <JobStatusBadge status={j.status} />
                          </TableCell>
                          <TableCell>{j.createdBy?.fullName ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                {(jobs.data ?? []).length > 8 && (
                  <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setAllJobs(!allJobs)}>
                    {allJobs ? 'Скрыть старые запуски' : `Показать все запуски (${jobs.data!.length})`}
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
      <CreatePeriodDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => setParams({ period: id }, { replace: true })} />
    </div>
  );
}

function CapacityCard({ rows, loading }: { rows?: CapacityRow[]; loading: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Прогноз ёмкости семестра</CardTitle>
        <CardDescription>Хватит ли учебного времени на план по календарному графику</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && <LoadingState rows={3} />}
        {rows?.map((r) => (
          <div key={r.groupId} className="space-y-1.5 rounded-md border p-2.5">
            <div className="flex items-center justify-between">
              <span className="font-medium">{r.groupCode}</span>
              <Badge variant={r.status === 'OK' ? 'success' : r.status === 'TIGHT' ? 'warning' : 'destructive'}>
                {r.status === 'OK' ? 'Достаточно' : r.status === 'TIGHT' ? 'Плотно' : 'Не хватает'}
              </Badge>
            </div>
            <Progress
              value={r.availableLessons ? (r.requiredLessons / r.availableLessons) * 100 : 100}
              indicatorClassName={r.status === 'OK' ? 'bg-emerald-500' : r.status === 'TIGHT' ? 'bg-amber-500' : 'bg-red-500'}
            />
            <div className="text-muted-foreground text-xs">{r.message}</div>
            <div className="text-muted-foreground grid grid-cols-2 gap-x-3 text-xs">
              <span>Учебных дней: {r.regularDays}</span>
              <span>Недель теории: {r.theoreticalWeeks}</span>
              <span>Пар в неделю: ~{formatNumber(r.averageLessonsPerWeek, 1)}</span>
              <span>Практика (пар): {r.practiceRequiredLessons}</span>
              <span>В расписании: {r.scheduledLessons}</span>
              <span>Проведено: {r.conductedLessons}</span>
            </div>
          </div>
        ))}
        {rows && rows.length === 0 && <div className="text-muted-foreground text-sm">Нет групп в семестре</div>}
      </CardContent>
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
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              Результат генерации <JobStatusBadge status={job.status} />
            </CardTitle>
            <CardDescription>
              Запуск {formatDateTime(job.createdAt)} · {job.mode === 'CALENDAR' ? 'календарный режим' : 'шаблон недели'}
              {job.solver && ` · решатель: ${job.solver}`}
            </CardDescription>
          </div>
          {canApply && (
            <Confirm
              trigger={
                <Button disabled={applying}>
                  {applying ? <Spinner /> : <Upload />} Применить
                </Button>
              }
              title="Применить результат генерации?"
              description={`Будет создано ${result!.lessons.length} занятий, заменено ${result!.replaceLessonIds.length} ранее сгенерированных. Закреплённые, ручные и проведённые занятия не изменятся.`}
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
              <AlertTitle>Генерация завершилась с ошибкой</AlertTitle>
              <AlertDescription>{job.error ?? job.message}</AlertDescription>
            </Alert>
          )}
          {job.status === 'APPLIED' && (
            <Alert variant="success">
              <CheckCircle2 />
              <AlertTitle>Результат применён {job.appliedAt ? formatDateTime(job.appliedAt) : ''}</AlertTitle>
              <AlertDescription>
                <Link className="underline" to={`/schedule?period=${job.schedulePeriodId}`}>
                  Открыть расписание
                </Link>
              </AlertDescription>
            </Alert>
          )}
          {applyResult && (
            <Alert variant={applyResult.validation.errors ? 'warning' : 'success'}>
              <AlertTitle>
                Создано {applyResult.created}, удалено {applyResult.deleted}, пропущено {applyResult.skipped.length}
              </AlertTitle>
              <AlertDescription>
                Проверка: ошибок {applyResult.validation.errors}, предупреждений {applyResult.validation.warnings}.{' '}
                {applyResult.validation.canPublish ? 'Расписание можно публиковать.' : 'Перед публикацией исправьте ошибки.'}
                {applyResult.skipped.slice(0, 5).map((sk, i) => (
                  <div key={i} className="text-xs">
                    {formatDate(sk.date)}, {sk.lessonNumber} пара, {sk.groups}: {sk.discipline} — {sk.reason}
                  </div>
                ))}
              </AlertDescription>
            </Alert>
          )}
          {stats && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard title="Требуется пар" value={stats.requiredLessons} hint={`${stats.requiredHours} ак. ч`} />
              <StatCard
                title="Размещено"
                value={stats.placedLessons}
                hint={`${stats.placedHours} ак. ч · ${formatNumber(stats.requiredLessons ? (stats.placedLessons / stats.requiredLessons) * 100 : 0, 1)}%`}
                tone="success"
              />
              <StatCard title="Не размещено" value={stats.unplacedLessons} tone={stats.unplacedLessons ? 'danger' : 'success'} />
              <StatCard title="Время расчёта" value={`${formatNumber(stats.durationMs / 1000, 1)} с`} hint={`Недель: ${stats.weeks}`} tone="info" />
            </div>
          )}
        </CardContent>
      </Card>

      {result && stats && (
        <Tabs defaultValue={result.unplaced.length ? 'unplaced' : 'groups'}>
          <TabsList>
            <TabsTrigger value="groups">По группам</TabsTrigger>
            <TabsTrigger value="unplaced">
              Не размещено {result.unplaced.length > 0 && <Badge variant="destructive">{result.unplaced.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="soft">Мягкие ограничения</TabsTrigger>
            <TabsTrigger value="preview">Предпросмотр</TabsTrigger>
            <TabsTrigger value="log">Журнал</TabsTrigger>
          </TabsList>
          <TabsContent value="groups">
            <Card>
              <CardContent className="space-y-3 pt-2">
                {stats.groups.map((g) => (
                  <div key={g.groupId}>
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{g.groupCode}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {g.placed} из {g.required} пар
                      </span>
                    </div>
                    <Progress
                      value={g.required ? (g.placed / g.required) * 100 : 100}
                      className="mt-1"
                      indicatorClassName={g.placed < g.required ? 'bg-amber-500' : 'bg-emerald-500'}
                    />
                  </div>
                ))}
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
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="unplaced">
            <UnplacedList result={result} />
          </TabsContent>
          <TabsContent value="soft">
            <Card>
              <CardContent className="grid gap-3 pt-2 sm:grid-cols-2 xl:grid-cols-3">
                {Object.entries(stats.softViolations).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between rounded-md border p-3">
                    <span className="text-sm">{SOFT_VIOLATION_LABELS[k] ?? k}</span>
                    <Badge variant={v ? 'warning' : 'success'}>{v}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="preview">
            <PreviewGrid result={result} lessonsPerDay={lessonsPerDay} workingDays={workingDays} />
          </TabsContent>
          <TabsContent value="log">
            <Card>
              <CardContent className="pt-2">
                <pre className="bg-muted/50 max-h-96 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap scrollbar-thin">
                  {result.log.join('\n') || 'Журнал пуст'}
                </pre>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function UnplacedList({ result }: { result: GenerationResult }) {
  if (result.unplaced.length === 0) {
    return (
      <Alert variant="success">
        <CheckCircle2 />
        <AlertTitle>Все занятия размещены</AlertTitle>
      </Alert>
    );
  }
  return (
    <div className="space-y-3">
      {result.unplaced.map((u) => (
        <Card key={u.demandId} className="py-4">
          <CardContent className="space-y-2 px-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium">
                {u.itemCode} {u.disciplineName}
                <span className="text-muted-foreground font-normal">
                  {' '}
                  · {LESSON_TYPE_LABELS[u.lessonType]} · {u.groupCodes.join(', ')}
                  {u.subgroupNumber ? ` (п/г ${u.subgroupNumber})` : ''}
                </span>
              </div>
              <Badge variant="destructive">
                не размещено {u.lessonsUnplaced} из {u.lessonsRequired} пар ({u.hoursUnplaced} ч)
              </Badge>
            </div>
            <div className="text-muted-foreground text-xs">Преподаватель: {u.teacherName ?? 'не назначен'}</div>
            <ul className="space-y-1 text-sm">
              {u.reasons.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                  {r.message}
                </li>
              ))}
            </ul>
            {u.suggestions.length > 0 && (
              <div className="bg-muted/40 space-y-1 rounded-md p-2 text-sm">
                {u.suggestions.map((sg, i) => (
                  <div key={i} className="flex gap-2">
                    <Lightbulb className="mt-0.5 size-4 shrink-0 text-sky-500" />
                    {sg}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
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
