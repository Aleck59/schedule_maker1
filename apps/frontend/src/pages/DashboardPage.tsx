import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CalendarX2,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Compass,
  GraduationCap,
  RotateCcw,
  ShieldAlert,
  Users,
  Wand2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AnimatedNumber } from '@/components/common/animated-number';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { StatCard } from '@/components/common/stat-card';
import { HourStatusBadge, PeriodStatusBadge } from '@/components/common/status-badge';
import { LessonDialog } from '@/components/schedule/lesson-dialog';
import { guideLink, useSetupStatus } from '@/components/setup/use-setup';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateLong, formatNumber, shortName } from '@/lib/format';
import { HOUR_STATUS_LABELS, LESSON_STATUS_LABELS, LESSON_TYPE_LABELS } from '@/lib/labels';
import { useApi } from '@/lib/query';
import type { HourStatus, Lesson, PeriodStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

interface StaffDashboard {
  role: string;
  today: string;
  counters: {
    activeGroups: number;
    teachers: number;
    classrooms: number;
    lessonsToday: number;
    cancelledLessons: number;
    hoursToMakeUp: number;
    openMakeupTasks: number;
    deficitDisciplines: number;
    riskDisciplines: number;
    workloadWarnings: number;
    validationErrors: number;
    validationWarnings: number;
  };
  planCompletion: {
    percent: number;
    forecastPercent: number;
    planned: number;
    conducted: number;
    scheduled: number;
    byStatus: Record<HourStatus, number>;
  } | null;
  deficits: Array<{
    groupCode: string;
    subgroupNumber: number | null;
    discipline: string;
    status: HourStatus;
    planned: number;
    scheduled: number;
    conducted: number;
    deficit: number;
  }>;
  workloadWarnings: Array<{
    teacherId: string;
    fullName: string;
    weekLessons: number;
    maxWeeklyLessons: number;
    maxDayLessons: number;
    maxDailyLessons: number;
  }>;
  lessonsByWeekday: Array<{ weekday: number; label: string; date: string; lessons: number }>;
  classroomOccupancy: {
    week: { from: string; to: string };
    percent: number;
    rooms: Array<{ classroomId: string; code: string; used: number; slots: number; percent: number }>;
  };
  periods: Array<{ id: string; title: string; status: PeriodStatus; startDate: string; endDate: string; semester: number; program: string }>;
}

interface TeacherDashboard {
  role: 'TEACHER';
  today: string;
  todayLessons: Lesson[];
  unmarked: Lesson[];
  weekLessons: number;
  openMakeupTasks?: number;
  workload?: {
    planned: number;
    scheduled: number;
    conducted: number;
    currentWeek: { from: string; to: string; lessons: number; limit: number; overload: boolean };
  };
}

interface StudentDashboard {
  role: 'STUDENT';
  today: string;
  group?: { id: string; code: string; title: string } | null;
  todayLessons: Lesson[];
  tomorrowLessons: Lesson[];
  changes: Lesson[];
  conductedLessons?: number;
}

const STATUS_COLORS: Record<HourStatus, string> = {
  NORMAL: '#10b981',
  RISK: '#f59e0b',
  DEFICIT: '#ef4444',
  EXCESS: '#8b5cf6',
};

export default function DashboardPage() {
  const { user } = useAuth();
  const q = useApi<StaffDashboard | TeacherDashboard | StudentDashboard>(['dashboard'], '/dashboard', undefined, {
    refetchInterval: 120_000,
  });
  if (q.isLoading) return <LoadingState rows={10} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const data = q.data!;
  if (user?.role === 'TEACHER') return <TeacherView data={data as TeacherDashboard} />;
  if (user?.role === 'STUDENT') return <StudentView data={data as StudentDashboard} />;
  return <StaffView data={data as StaffDashboard} />;
}

function StaffView({ data }: { data: StaffDashboard }) {
  const { canEdit } = useAuth();
  const c = data.counters;
  const pie = data.planCompletion
    ? (Object.entries(data.planCompletion.byStatus) as Array<[HourStatus, number]>)
        .filter(([, v]) => v > 0)
        .map(([status, value]) => ({ status, name: HOUR_STATUS_LABELS[status], value }))
    : [];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Главная"
        description={`Сегодня ${formatDateLong(data.today)}`}
        actions={
          canEdit && (
            <Button asChild>
              <Link to="/generation?scope=all">
                <Wand2 /> Составить расписание
              </Link>
            </Button>
          )
        }
      />
      <SetupBanner />
      <Card className="py-0">
        <CardContent className="grid grid-cols-2 divide-y px-0 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          {(
            [
              ['Занятий сегодня', c.lessonsToday, CalendarClock, '/schedule?view=day'],
              ['Активных групп', c.activeGroups, GraduationCap, '/groups'],
              ['Преподавателей', c.teachers, Users, '/teachers'],
              ['Аудиторий', c.classrooms, Building2, '/classrooms'],
            ] as const
          ).map(([title, value, Icon, to], i) => (
            <Link
              key={title}
              to={to}
              className={cn(
                'group hover:bg-muted/40 flex items-center gap-3 px-3 py-3.5 transition-colors sm:px-5 sm:py-4',
                i % 2 === 1 && 'border-l sm:border-l-0',
              )}
            >
              <Icon className="text-muted-foreground size-4 shrink-0" />
              <div className="min-w-0">
                <div className="text-2xl leading-tight font-semibold tracking-tight tabular-nums">
                  <AnimatedNumber value={value} />
                </div>
                <div className="text-muted-foreground text-xs leading-tight">{title}</div>
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>
      <Attention counters={c} />

      <div className="grid gap-4 xl:grid-cols-3 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Выполнение учебного плана</CardTitle>
            <CardDescription>Текущие семестры, проведённые часы от плана</CardDescription>
          </CardHeader>
          <CardContent>
            {data.planCompletion ? (
              <div className="space-y-4">
                <div>
                  <div className="flex items-end justify-between">
                    <span className="text-3xl font-semibold tracking-tight tabular-nums">
                      <AnimatedNumber value={data.planCompletion.percent} format={(n) => `${formatNumber(n, 1)}%`} />
                    </span>
                    <span className="text-muted-foreground text-sm">прогноз {formatNumber(data.planCompletion.forecastPercent, 1)}%</span>
                  </div>
                  <Progress value={data.planCompletion.percent} className="mt-2" />
                </div>
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  {(
                    [
                      ['План', data.planCompletion.planned],
                      ['В расписании', data.planCompletion.scheduled],
                      ['Проведено', data.planCompletion.conducted],
                    ] as const
                  ).map(([label, hours]) => (
                    <div key={label}>
                      <dt className="text-muted-foreground text-xs">{label}</dt>
                      <dd className="font-semibold tabular-nums">{hours} ч</dd>
                    </div>
                  ))}
                </dl>
                {pie.length > 0 && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-sm">
                    {pie.map((p) => (
                      <div key={p.status} className="flex items-center gap-2">
                        <span className="size-2 rounded-full" style={{ background: STATUS_COLORS[p.status] }} />
                        {p.name}: <span className="font-medium tabular-nums">{p.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <EmptyState title="Нет текущих семестров" description="Сегодняшняя дата не попадает ни в один семестр" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Занятия на текущей неделе</CardTitle>
            <CardDescription>
              {formatDate(data.classroomOccupancy.week.from)} — {formatDate(data.classroomOccupancy.week.to)}
            </CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer>
              <BarChart data={data.lessonsByWeekday}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={30} tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }} />
                <Tooltip
                  cursor={{ fill: 'var(--accent)', radius: 8 }}
                  contentStyle={{ borderRadius: 8, border: '1px solid var(--border)', boxShadow: 'none' }}
                  formatter={(v) => [v, 'Занятий']}
                  labelFormatter={(l) => `День: ${l}`}
                />
                <Bar dataKey="lessons" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={32} animationDuration={700} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Загрузка аудиторий</CardTitle>
            <CardDescription>Средняя загрузка за неделю: {formatNumber(data.classroomOccupancy.percent, 1)}%</CardDescription>
          </CardHeader>
          <CardContent className="max-h-64 space-y-2 overflow-y-auto scrollbar-thin">
            {data.classroomOccupancy.rooms.map((r) => (
              <Link key={r.classroomId} to={`/classrooms/${r.classroomId}`} className="block">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{r.code}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {r.used}/{r.slots} · {formatNumber(r.percent, 1)}%
                  </span>
                </div>
                <Progress
                  value={r.percent}
                  className="mt-1 h-1.5"
                  indicatorClassName={r.percent > 85 ? 'bg-red-500' : r.percent > 60 ? 'bg-amber-500' : undefined}
                />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="min-w-0 xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-500" /> Дисциплины с отставанием
            </CardTitle>
            <CardDescription>Дефицит часов в расписании или прогноз невыполнения плана</CardDescription>
          </CardHeader>
          <CardContent>
            {data.deficits.length === 0 ? (
              <div className="text-muted-foreground py-6 text-center text-sm">Отставаний нет — все дисциплины выполняются по плану</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Группа</TableHead>
                    <TableHead>Дисциплина</TableHead>
                    <TableHead className="text-right">План</TableHead>
                    <TableHead className="text-right">В расп.</TableHead>
                    <TableHead className="text-right">Проведено</TableHead>
                    <TableHead className="text-right">Дефицит</TableHead>
                    <TableHead>Статус</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.deficits.map((d, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium whitespace-nowrap">
                        {d.groupCode}
                        {d.subgroupNumber ? ` (п/г ${d.subgroupNumber})` : ''}
                      </TableCell>
                      <TableCell className="max-w-60 truncate">{d.discipline}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.planned}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.scheduled}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.conducted}</TableCell>
                      <TableCell className="text-right font-semibold text-red-600 tabular-nums">{d.deficit}</TableCell>
                      <TableCell>
                        <HourStatusBadge status={d.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Перегрузка преподавателей</CardTitle>
              <CardDescription>Текущая неделя</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.workloadWarnings.length === 0 ? (
                <div className="text-muted-foreground text-sm">Превышений недельной и дневной нагрузки нет</div>
              ) : (
                data.workloadWarnings.map((w) => (
                  <Link key={w.teacherId} to={`/teachers/${w.teacherId}`} className="hover:bg-muted/50 hover:border-primary/25 block rounded-xl border p-2.5 text-sm transition-colors">
                    <div className="font-medium">{w.fullName}</div>
                    <div className="text-muted-foreground text-xs">
                      Пар за неделю: {w.weekLessons} (макс. {w.maxWeeklyLessons}) · в день до {w.maxDayLessons} (макс.{' '}
                      {w.maxDailyLessons})
                    </div>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Периоды расписания</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.periods.length === 0 && <div className="text-muted-foreground text-sm">Периоды не созданы</div>}
              {data.periods.map((p) => (
                <Link key={p.id} to={`/schedule?period=${p.id}`} className="hover:bg-muted/50 hover:border-primary/25 flex items-center justify-between gap-2 rounded-xl border p-2.5 transition-colors">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{p.title}</div>
                    <div className="text-muted-foreground text-xs">
                      {formatDate(p.startDate)} — {formatDate(p.endDate)}
                    </div>
                  </div>
                  <PeriodStatusBadge status={p.status} />
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Что требует внимания диспетчера: только ненулевые показатели, иначе — короткое «всё в порядке» */
function Attention({ counters: c }: { counters: StaffDashboard['counters'] }) {
  const items = [
    c.validationErrors > 0 && {
      to: '/schedule',
      icon: ShieldAlert,
      tone: 'text-red-600',
      text: `Конфликтов в расписании: ${c.validationErrors}`,
      hint: 'исправить в «Расписании» → «Проверить»',
    },
    c.deficitDisciplines > 0 && {
      to: '/hour-control?status=DEFICIT',
      icon: ClipboardCheck,
      tone: 'text-red-600',
      text: `Дисциплин с дефицитом часов: ${c.deficitDisciplines}`,
      hint: c.riskDisciplines ? `ещё в зоне риска: ${c.riskDisciplines}` : null,
    },
    c.hoursToMakeUp > 0 && {
      to: '/makeup',
      icon: RotateCcw,
      tone: 'text-amber-600',
      text: `Часов к отработке: ${c.hoursToMakeUp}`,
      hint: `открытых задач: ${c.openMakeupTasks}`,
    },
    c.cancelledLessons > 0 && {
      to: '/reports',
      icon: CalendarX2,
      tone: 'text-amber-600',
      text: `Отменённых занятий: ${c.cancelledLessons}`,
      hint: '±30 дней от сегодня',
    },
    c.workloadWarnings > 0 && {
      to: '/hour-control',
      icon: Users,
      tone: 'text-amber-600',
      text: `Перегружены преподаватели: ${c.workloadWarnings}`,
      hint: 'текущая неделя',
    },
  ].filter(Boolean) as Array<{ to: string; icon: typeof Users; tone: string; text: string; hint: string | null }>;
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
        <CheckCircle2 className="size-4" /> Конфликтов, отмен, отработок и перегрузок нет
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => (
        <Link
          key={it.text}
          to={it.to}
          className="lift group bg-card flex min-w-0 items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm shadow-soft"
        >
          <it.icon className={cn('size-4 shrink-0', it.tone)} />
          <span className="font-medium">{it.text}</span>
          {it.hint && <span className="text-muted-foreground hidden truncate sm:inline">· {it.hint}</span>}
          <ChevronRight className="text-muted-foreground size-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      ))}
    </div>
  );
}

function LessonRow({ lesson, onClick, showGroup = true }: { lesson: Lesson; onClick?: () => void; showGroup?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'hover:bg-muted/50 hover:border-primary/25 flex w-full cursor-pointer items-center gap-3 rounded-xl border p-2.5 text-left transition-colors',
        lesson.status === 'CANCELLED' && 'opacity-60',
      )}
    >
      <div className="bg-primary/10 text-primary flex size-10 shrink-0 flex-col items-center justify-center rounded-lg">
        <span className="text-sm leading-none font-semibold">{lesson.lessonNumber}</span>
        <span className="text-[9px]">пара</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-sm font-medium', lesson.status === 'CANCELLED' && 'line-through')}>
          {lesson.semesterItem.curriculumItem.name}
        </div>
        <div className="text-muted-foreground truncate text-xs">
          {lesson.startTime}–{lesson.endTime} · {LESSON_TYPE_LABELS[lesson.lessonType]}
          {showGroup && ` · ${lesson.studentGroup.code}`}
          {lesson.subgroupNumber ? ` (п/г ${lesson.subgroupNumber})` : ''} · {lesson.classroom?.code ?? 'без аудитории'}
          {!showGroup && ` · ${shortName(lesson.teacher?.fullName)}`}
        </div>
      </div>
      {lesson.status !== 'PLANNED' && <Badge variant={lesson.status === 'CONDUCTED' ? 'success' : lesson.status === 'CANCELLED' ? 'destructive' : 'warning'}>{LESSON_STATUS_LABELS[lesson.status]}</Badge>}
    </button>
  );
}

function TeacherView({ data }: { data: TeacherDashboard }) {
  const [lessonId, setLessonId] = useState<string | null>(null);
  const qc = useQueryClient();
  const w = data.workload;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Главная"
        description={`Сегодня ${formatDateLong(data.today)}`}
        actions={
          <Button asChild variant="outline">
            <Link to="/my">Моё расписание</Link>
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Пар сегодня" value={data.todayLessons.filter((l) => l.status !== 'CANCELLED' && l.status !== 'MOVED').length} icon={CalendarClock} />
        <StatCard
          title="Пар на неделе"
          value={data.weekLessons}
          hint={w ? `Лимит: ${w.currentWeek.limit}` : undefined}
          icon={CalendarClock}
          tone={w?.currentWeek.overload ? 'danger' : 'info'}
        />
        <StatCard title="Не отмечено проведение" value={data.unmarked.length} hint="За последние 30 дней" icon={ClipboardCheck} tone={data.unmarked.length ? 'warning' : 'success'} />
        <StatCard title="Задачи на отработку" value={data.openMakeupTasks ?? 0} icon={RotateCcw} tone={data.openMakeupTasks ? 'warning' : 'success'} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Сегодня</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.todayLessons.length === 0 ? (
              <div className="text-muted-foreground text-sm">Сегодня занятий нет</div>
            ) : (
              data.todayLessons.map((l) => <LessonRow key={l.id} lesson={l} onClick={() => setLessonId(l.id)} />)
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Требуется отметить проведение</CardTitle>
            <CardDescription>Нажмите на занятие, чтобы отметить факт проведения</CardDescription>
          </CardHeader>
          <CardContent className="max-h-96 space-y-2 overflow-y-auto scrollbar-thin">
            {data.unmarked.length === 0 ? (
              <div className="text-muted-foreground text-sm">Все прошедшие занятия отмечены</div>
            ) : (
              data.unmarked.map((l) => (
                <div key={l.id}>
                  <div className="text-muted-foreground mb-1 text-xs">{formatDate(l.date)}</div>
                  <LessonRow lesson={l} onClick={() => setLessonId(l.id)} />
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
      {w && (
        <Card>
          <CardHeader>
            <CardTitle>Моя нагрузка</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div>
              <div className="text-muted-foreground text-xs">Плановая нагрузка</div>
              <div className="text-2xl font-semibold tabular-nums">{w.planned} ч</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">В расписании</div>
              <div className="text-2xl font-semibold tabular-nums">{w.scheduled} ч</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Проведено</div>
              <div className="text-2xl font-semibold tabular-nums">{w.conducted} ч</div>
              <Progress value={w.planned ? (w.conducted / w.planned) * 100 : 0} className="mt-2" />
            </div>
          </CardContent>
        </Card>
      )}
      <LessonDialog
        lessonId={lessonId}
        open={!!lessonId}
        onOpenChange={(o) => !o && setLessonId(null)}
        onChanged={() => void qc.invalidateQueries({ queryKey: ['dashboard'] })}
      />
    </div>
  );
}

function StudentView({ data }: { data: StudentDashboard }) {
  const [lessonId, setLessonId] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <PageHeader
        title={data.group ? `Группа ${data.group.code}` : 'Главная'}
        description={`Сегодня ${formatDateLong(data.today)}`}
        actions={
          <Button asChild variant="outline">
            <Link to="/my">Расписание на неделю</Link>
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Сегодня</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.todayLessons.length === 0 ? (
              <div className="text-muted-foreground text-sm">Сегодня занятий нет</div>
            ) : (
              data.todayLessons.map((l) => <LessonRow key={l.id} lesson={l} showGroup={false} onClick={() => setLessonId(l.id)} />)
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Завтра</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.tomorrowLessons.length === 0 ? (
              <div className="text-muted-foreground text-sm">Завтра занятий нет</div>
            ) : (
              data.tomorrowLessons.map((l) => <LessonRow key={l.id} lesson={l} showGroup={false} onClick={() => setLessonId(l.id)} />)
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Изменения в расписании</CardTitle>
          <CardDescription>Отмены, переносы и замены на ближайшие две недели</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.changes.length === 0 ? (
            <div className="text-muted-foreground text-sm">Изменений нет</div>
          ) : (
            data.changes.map((l) => (
              <div key={l.id} className="flex items-center gap-3">
                <div className="text-muted-foreground w-20 shrink-0 text-xs">{formatDate(l.date)}</div>
                <div className="flex-1">
                  <LessonRow lesson={l} showGroup={false} onClick={() => setLessonId(l.id)} />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
      <LessonDialog lessonId={lessonId} open={!!lessonId} onOpenChange={(o) => !o && setLessonId(null)} />
    </div>
  );
}

/** Напоминание о незавершённой настройке со ссылкой на следующий шаг мастера */
function SetupBanner() {
  const setup = useSetupStatus();
  const data = setup.data;
  if (!data?.next) return null;
  const next = data.steps.find((s) => s.key === data.next)!;
  return (
    <Alert variant="info">
      <Compass />
      <AlertTitle>
        Подготовка расписания: выполнено {data.completed} из {data.total} шагов
      </AlertTitle>
      <AlertDescription>
        <div>
          Следующий шаг — <b>{next.title}</b>: {next.description}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" asChild>
            <Link to={guideLink(next.link)}>{next.action}</Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to="/setup">Мастер настройки</Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
