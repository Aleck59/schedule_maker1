import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarPlus, Sparkles, Trash2 } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Confirm } from '@/components/common/confirm';
import { Field } from '@/components/common/field';
import { PageHeader } from '@/components/common/page-header';
import { SimpleSelect } from '@/components/common/simple-select';
import { EmptyState, ErrorState, LoadingState, Spinner } from '@/components/common/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useGroups, usePrograms, useSemesters, useTeachers } from '@/hooks/use-reference';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateShort } from '@/lib/format';
import { CALENDAR_EVENT_CODES, CALENDAR_EVENT_COLORS, CALENDAR_EVENT_LABELS, CONTROL_FORM_LABELS } from '@/lib/labels';
import { useApi, useApiMutation } from '@/lib/query';
import type { CalendarEvent, CalendarEventType } from '@/lib/types';
import { cn } from '@/lib/utils';

interface GraphWeek {
  index: number;
  start: string;
  end: string;
  type: CalendarEventType | null;
  code: string;
  label: string;
  mixed: boolean;
  holidays: number;
  workingDays: number;
  blockedDays: number;
  eventIds: string[];
}

interface CalendarGraph {
  program: { id: string; title: string; groups: Array<{ id: string; code: string }> };
  years: Array<{
    academicYearId: string;
    title: string;
    courseNumber: number | null;
    startDate: string;
    endDate: string;
    semesters: Array<{ id: string; number: number; startDate: string; endDate: string }>;
    weeks: GraphWeek[];
    summary: Record<string, number>;
  }>;
  legend: Array<{ type: string; code: string; label: string; blocksSchedule: boolean }>;
}

interface AssessmentEvent {
  id: string;
  date: string;
  lessonNumber: number | null;
  controlForm: string;
  group: { id: string; code: string };
  semesterItem: { curriculumItem: { code: string; name: string } };
  teacher: { id: string; fullName: string } | null;
  classroom: { id: string; code: string } | null;
}

const WEEK_TYPES: CalendarEventType[] = [
  'THEORETICAL_TRAINING',
  'EXAM_SESSION',
  'VACATION',
  'EDUCATIONAL_PRACTICE',
  'INDUSTRIAL_PRACTICE',
  'PRE_DIPLOMA_PRACTICE',
  'FINAL_ATTESTATION',
  'DIPLOMA_PREPARATION',
  'DIPLOMA_DEFENSE',
  'DEMO_EXAM',
];

export default function CalendarGraphPage() {
  const { canEdit } = useAuth();
  const programs = usePrograms();
  const [programId, setProgramId] = useState<string | null>(null);
  const pid = programId ?? programs.data?.[0]?.id ?? null;
  const graph = useApi<CalendarGraph>(['calendar-graph', pid], pid ? `/programs/${pid}/calendar-graph` : null);

  if (programs.isLoading) return <LoadingState rows={8} />;
  if (!pid) return <EmptyState title="Нет учебных планов" description="Создайте учебный план, чтобы вести календарный график" />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Календарный учебный график"
        description="Теоретическое обучение, промежуточная аттестация, практики, каникулы и праздничные дни"
        actions={
          <div className="w-80">
            <SimpleSelect value={pid} onChange={setProgramId} options={(programs.data ?? []).map((p) => ({ value: p.id, label: p.title }))} />
          </div>
        }
      />
      <Tabs defaultValue="graph">
        <TabsList>
          <TabsTrigger value="graph">График по неделям</TabsTrigger>
          <TabsTrigger value="events">Периоды и события</TabsTrigger>
          <TabsTrigger value="assessments">Экзамены и зачёты</TabsTrigger>
        </TabsList>
        <TabsContent value="graph" className="space-y-4">
          {graph.isLoading ? (
            <LoadingState rows={6} />
          ) : graph.error ? (
            <ErrorState error={graph.error} onRetry={() => graph.refetch()} />
          ) : (
            <GraphView graph={graph.data!} editable={canEdit} />
          )}
        </TabsContent>
        <TabsContent value="events">
          <EventsView programId={pid} editable={canEdit} />
        </TabsContent>
        <TabsContent value="assessments">
          <AssessmentsView programId={pid} editable={canEdit} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function GraphView({ graph, editable }: { graph: CalendarGraph; editable: boolean }) {
  const setWeek = useApiMutation(
    (v: { weekStart: string; courseNumber: number | null; eventType: CalendarEventType | null }) =>
      api.put(`/programs/${graph.program.id}/calendar-graph/week`, v),
    {
      success: 'Тип недели изменён',
      invalidate: [['calendar-graph'], ['calendar-events'], ['capacity']],
    },
  );
  return (
    <>
      <Card>
        <CardContent className="flex flex-wrap gap-2 pt-2">
          {graph.legend
            .filter((l) => l.type !== 'OTHER')
            .map((l) => (
              <span key={l.type} className={cn('inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium', CALENDAR_EVENT_COLORS[l.type])}>
                <b>{l.code}</b> {l.label}
              </span>
            ))}
        </CardContent>
      </Card>
      {graph.years.length === 0 && <EmptyState title="Учебные годы не созданы" />}
      {graph.years.map((year) => (
        <Card key={year.academicYearId}>
          <CardHeader>
            <CardTitle>
              {year.courseNumber ? `${year.courseNumber} курс` : ''} · {year.title}
            </CardTitle>
            <CardDescription>
              {year.semesters.map((s) => `${s.number} семестр: ${formatDate(s.startDate)} — ${formatDate(s.endDate)}`).join(' · ')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-1">
              {year.weeks.map((w) => {
                const cell = (
                  <button
                    type="button"
                    className={cn(
                      'relative flex h-12 w-10 flex-col items-center justify-center rounded border text-[10px] leading-tight transition hover:ring-2 hover:ring-primary/40',
                      w.type ? CALENDAR_EVENT_COLORS[w.type] : 'bg-card text-muted-foreground',
                      !editable && 'cursor-default',
                    )}
                  >
                    <span className="text-[9px] opacity-70">{w.index}</span>
                    <span className="text-xs font-bold">{w.code || '·'}</span>
                    <span className="text-[9px] opacity-70">{formatDateShort(w.start)}</span>
                    {w.mixed && <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-current opacity-60" />}
                    {w.holidays > 0 && w.type !== 'HOLIDAY' && <span className="absolute bottom-0.5 left-0.5 size-1.5 rounded-full bg-red-500" />}
                  </button>
                );
                const tip = (
                  <div className="text-xs">
                    <div className="font-medium">
                      Неделя {w.index}: {formatDate(w.start)} — {formatDate(w.end)}
                    </div>
                    <div>{w.label}</div>
                    {w.mixed && <div>Смешанная неделя</div>}
                    {w.holidays > 0 && <div>Праздничных дней: {w.holidays}</div>}
                    <div>
                      Учебных дней заблокировано: {w.blockedDays} из {w.workingDays}
                    </div>
                  </div>
                );
                return editable ? (
                  <Popover key={w.start}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <PopoverTrigger asChild>{cell}</PopoverTrigger>
                      </TooltipTrigger>
                      <TooltipContent>{tip}</TooltipContent>
                    </Tooltip>
                    <PopoverContent className="w-64 p-2">
                      <div className="mb-1.5 px-1 text-xs font-medium">
                        Тип недели {formatDate(w.start)} — {formatDate(w.end)}
                      </div>
                      <div className="grid gap-1">
                        {WEEK_TYPES.map((t) => (
                          <button
                            key={t}
                            type="button"
                            className={cn('rounded px-2 py-1 text-left text-xs hover:opacity-80', CALENDAR_EVENT_COLORS[t])}
                            onClick={() => setWeek.mutate({ weekStart: w.start, courseNumber: year.courseNumber, eventType: t })}
                          >
                            <b>{CALENDAR_EVENT_CODES[t]}</b> {CALENDAR_EVENT_LABELS[t]}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="hover:bg-muted rounded border px-2 py-1 text-left text-xs"
                          onClick={() => setWeek.mutate({ weekStart: w.start, courseNumber: year.courseNumber, eventType: null })}
                        >
                          Очистить неделю
                        </button>
                      </div>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <Tooltip key={w.start}>
                    <TooltipTrigger asChild>{cell}</TooltipTrigger>
                    <TooltipContent>{tip}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(year.summary).map(([t, n]) => (
                <Badge key={t} variant="outline">
                  {CALENDAR_EVENT_LABELS[t]}: {n} нед.
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </>
  );
}

const eventSchema = z
  .object({
    eventType: z.string().min(1, 'Выберите тип'),
    title: z.string().trim().min(1, 'Укажите название'),
    startDate: z.string().min(1, 'Укажите дату начала'),
    endDate: z.string().min(1, 'Укажите дату окончания'),
    scope: z.enum(['program', 'course', 'group', 'college', 'teacher']),
    courseNumber: z.string().optional(),
    studentGroupId: z.string().optional(),
    teacherId: z.string().optional(),
    blocksSchedule: z.boolean(),
    notes: z.string().optional(),
  })
  .refine((v) => v.startDate <= v.endDate, { message: 'Дата окончания раньше даты начала', path: ['endDate'] })
  .refine((v) => v.scope !== 'group' || !!v.studentGroupId, { message: 'Выберите группу', path: ['studentGroupId'] })
  .refine((v) => v.scope !== 'course' || !!v.courseNumber, { message: 'Выберите курс', path: ['courseNumber'] })
  .refine((v) => v.scope !== 'teacher' || !!v.teacherId, { message: 'Выберите преподавателя', path: ['teacherId'] });
type EventForm = z.infer<typeof eventSchema>;

function EventsView({ programId, editable }: { programId: string; editable: boolean }) {
  const events = useApi<CalendarEvent[]>(['calendar-events', 'program', programId], '/calendar-events', { programId });
  const [open, setOpen] = useState(false);
  const remove = useApiMutation((id: string) => api.delete(`/calendar-events/${id}`), {
    success: 'Событие удалено',
    invalidate: [['calendar-events'], ['calendar-graph'], ['capacity']],
  });
  const sorted = useMemo(() => [...(events.data ?? [])].sort((a, b) => a.startDate.localeCompare(b.startDate)), [events.data]);
  return (
    <div className="space-y-3">
      {editable && (
        <Button onClick={() => setOpen(true)}>
          <CalendarPlus /> Добавить период
        </Button>
      )}
      {events.isLoading ? (
        <LoadingState rows={6} />
      ) : (
        <div className="bg-card rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Тип</TableHead>
                <TableHead>Название</TableHead>
                <TableHead>Даты</TableHead>
                <TableHead>Для кого</TableHead>
                <TableHead>Блокирует занятия</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', CALENDAR_EVENT_COLORS[e.eventType])}>
                      {CALENDAR_EVENT_LABELS[e.eventType]}
                    </span>
                  </TableCell>
                  <TableCell>{e.title}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(e.startDate)} — {formatDate(e.endDate)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {e.group
                      ? `Группа ${e.group.code}`
                      : e.teacher
                        ? `Преподаватель ${e.teacher.fullName}`
                        : e.courseNumber
                          ? `${e.courseNumber} курс`
                          : e.educationalProgramId
                            ? 'Вся программа'
                            : 'Весь колледж'}
                  </TableCell>
                  <TableCell>{e.blocksSchedule ? <Badge variant="warning">Да</Badge> : <Badge variant="muted">Нет</Badge>}</TableCell>
                  <TableCell className="text-right">
                    {editable && (
                      <Confirm
                        trigger={
                          <Button variant="ghost" size="icon-sm" aria-label="Удалить">
                            <Trash2 />
                          </Button>
                        }
                        title="Удалить событие календарного графика?"
                        destructive
                        confirmText="Удалить"
                        onConfirm={() => remove.mutate(e.id)}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground h-20 text-center">
                    Событий нет
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
      <EventDialog open={open} onOpenChange={setOpen} programId={programId} />
    </div>
  );
}

function EventDialog({ open, onOpenChange, programId }: { open: boolean; onOpenChange: (o: boolean) => void; programId: string }) {
  const groups = useGroups();
  const teachers = useTeachers();
  const form = useForm<EventForm>({
    resolver: zodResolver(eventSchema),
    defaultValues: { eventType: 'VACATION', title: '', startDate: '', endDate: '', scope: 'program', blocksSchedule: true },
  });
  const scope = form.watch('scope');
  const create = useApiMutation(
    (v: EventForm) =>
      api.post('/calendar-events', {
        eventType: v.eventType,
        title: v.title,
        startDate: v.startDate,
        endDate: v.endDate,
        blocksSchedule: v.blocksSchedule,
        notes: v.notes || undefined,
        educationalProgramId: v.scope === 'college' || v.scope === 'teacher' ? null : programId,
        courseNumber: v.scope === 'course' ? Number(v.courseNumber) : null,
        studentGroupId: v.scope === 'group' ? v.studentGroupId : null,
        teacherId: v.scope === 'teacher' ? v.teacherId : null,
      }),
    {
      success: 'Период добавлен',
      invalidate: [['calendar-events'], ['calendar-graph'], ['capacity']],
      onSuccess: () => {
        onOpenChange(false);
        form.reset();
      },
    },
  );
  const e = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Период календарного графика</DialogTitle>
        </DialogHeader>
        <form id="event-form" className="grid gap-3 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => create.mutate(v))}>
          <Field label="Тип" required error={e.eventType?.message}>
            <Controller
              control={form.control}
              name="eventType"
              render={({ field }) => (
                <SimpleSelect
                  value={field.value}
                  onChange={(v) => {
                    field.onChange(v ?? '');
                    form.setValue('blocksSchedule', v !== 'THEORETICAL_TRAINING');
                    if (!form.getValues('title') && v) form.setValue('title', CALENDAR_EVENT_LABELS[v]);
                  }}
                  options={Object.entries(CALENDAR_EVENT_LABELS).map(([value, label]) => ({ value, label }))}
                />
              )}
            />
          </Field>
          <Field label="Название" required error={e.title?.message}>
            <Input {...form.register('title')} />
          </Field>
          <Field label="С" required error={e.startDate?.message}>
            <Input type="date" {...form.register('startDate')} />
          </Field>
          <Field label="По" required error={e.endDate?.message}>
            <Input type="date" {...form.register('endDate')} />
          </Field>
          <Field label="Область действия">
            <Controller
              control={form.control}
              name="scope"
              render={({ field }) => (
                <SimpleSelect
                  value={field.value}
                  onChange={(v) => field.onChange(v ?? 'program')}
                  options={[
                    { value: 'program', label: 'Вся программа' },
                    { value: 'course', label: 'Курс' },
                    { value: 'group', label: 'Группа' },
                    { value: 'college', label: 'Весь колледж (праздник)' },
                    { value: 'teacher', label: 'Преподаватель (отпуск, командировка)' },
                  ]}
                />
              )}
            />
          </Field>
          {scope === 'course' && (
            <Field label="Курс" error={e.courseNumber?.message}>
              <Controller
                control={form.control}
                name="courseNumber"
                render={({ field }) => (
                  <SimpleSelect
                    value={field.value ?? null}
                    onChange={(v) => field.onChange(v ?? undefined)}
                    options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} курс` }))}
                  />
                )}
              />
            </Field>
          )}
          {scope === 'group' && (
            <Field label="Группа" error={e.studentGroupId?.message}>
              <Controller
                control={form.control}
                name="studentGroupId"
                render={({ field }) => (
                  <SimpleSelect
                    value={field.value ?? null}
                    onChange={(v) => field.onChange(v ?? undefined)}
                    options={(groups.data ?? []).filter((g) => g.educationalProgramId === programId).map((g) => ({ value: g.id, label: g.code }))}
                  />
                )}
              />
            </Field>
          )}
          {scope === 'teacher' && (
            <Field label="Преподаватель" error={e.teacherId?.message}>
              <Controller
                control={form.control}
                name="teacherId"
                render={({ field }) => (
                  <SimpleSelect
                    value={field.value ?? null}
                    onChange={(v) => field.onChange(v ?? undefined)}
                    options={(teachers.data ?? []).map((t) => ({ value: t.id, label: t.fullName }))}
                  />
                )}
              />
            </Field>
          )}
          <Controller
            control={form.control}
            name="blocksSchedule"
            render={({ field }) => (
              <label className="flex items-center justify-between gap-3 text-sm sm:col-span-2">
                Блокирует постановку обычных занятий
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </label>
            )}
          />
          <Field label="Примечание" className="sm:col-span-2">
            <Textarea rows={2} {...form.register('notes')} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button type="submit" form="event-form" disabled={create.isPending}>
            {create.isPending && <Spinner />} Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssessmentsView({ programId, editable }: { programId: string; editable: boolean }) {
  const semesters = useSemesters();
  const programSemesters = (semesters.data ?? []).filter((s) => s.educationalProgramId === programId);
  const [semesterId, setSemesterId] = useState<string | null>(null);
  const sid = semesterId ?? programSemesters[0]?.id ?? null;
  const list = useApi<AssessmentEvent[]>(['assessments', sid], sid ? '/assessment-events' : null, { semesterId: sid ?? undefined });
  const [warnings, setWarnings] = useState<string[]>([]);
  const autoPlace = useApiMutation(() => api.post<{ created: number; warnings: string[] }>('/assessment-events/auto-place', { semesterId: sid }), {
    success: (r) => `Распределено контрольных мероприятий: ${r.created}`,
    invalidate: [['assessments']],
    onSuccess: (r) => setWarnings(r.warnings),
  });
  const remove = useApiMutation((id: string) => api.delete(`/assessment-events/${id}`), {
    success: 'Удалено',
    invalidate: [['assessments']],
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-72">
          <SimpleSelect
            value={sid}
            onChange={setSemesterId}
            options={programSemesters.map((s) => ({ value: s.id, label: `${s.number} семестр (${formatDate(s.startDate)} — ${formatDate(s.endDate)})` }))}
          />
        </div>
        {editable && sid && (
          <Button variant="outline" onClick={() => autoPlace.mutate(undefined)} disabled={autoPlace.isPending}>
            {autoPlace.isPending ? <Spinner /> : <Sparkles />} Распределить автоматически
          </Button>
        )}
      </div>
      <Alert variant="info">
        <AlertDescription>
          Экзамены ставятся в недели промежуточной аттестации с интервалом между экзаменами группы, зачёты — на последние занятия теоретического
          обучения. Часы экзаменов в сетку занятий не входят.
        </AlertDescription>
      </Alert>
      {warnings.length > 0 && (
        <Alert variant="warning">
          <AlertDescription>
            <ul className="list-disc pl-4">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {list.isLoading ? (
        <LoadingState rows={4} />
      ) : list.error ? (
        <ErrorState error={list.error} />
      ) : (
        <div className="bg-card rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Группа</TableHead>
                <TableHead>Дисциплина</TableHead>
                <TableHead>Форма контроля</TableHead>
                <TableHead>Преподаватель</TableHead>
                <TableHead>Аудитория</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(list.data ?? []).map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(a.date)}
                    {a.lessonNumber ? `, ${a.lessonNumber} пара` : ''}
                  </TableCell>
                  <TableCell>{a.group.code}</TableCell>
                  <TableCell>
                    {a.semesterItem.curriculumItem.code} {a.semesterItem.curriculumItem.name}
                  </TableCell>
                  <TableCell>
                    <Badge variant={a.controlForm === 'EXAM' ? 'destructive' : 'info'}>{CONTROL_FORM_LABELS[a.controlForm]}</Badge>
                  </TableCell>
                  <TableCell>{a.teacher?.fullName ?? '—'}</TableCell>
                  <TableCell>{a.classroom?.code ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    {editable && (
                      <Button variant="ghost" size="icon-sm" onClick={() => remove.mutate(a.id)} aria-label="Удалить">
                        <Trash2 />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(list.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground h-20 text-center">
                    Контрольные мероприятия не назначены
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
