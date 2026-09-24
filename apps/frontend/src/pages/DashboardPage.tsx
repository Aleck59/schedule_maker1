import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CalendarX2,
  ClipboardCheck,
  GraduationCap,
  RotateCcw,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { StatCard } from '@/components/common/stat-card';
import { HourStatusBadge, PeriodStatusBadge } from '@/components/common/status-badge';
import { LessonDialog } from '@/components/schedule/lesson-dialog';
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
  const navigate = useNavigate();
  const c = data.counters;
  const pie = data.planCompletion
    ? (Object.entries(data.planCompletion.byStatus) as Array<[HourStatus, number]>)
        .filter(([, v]) => v > 0)
        .map(([status, value]) => ({ status, name: HOUR_STATUS_LABELS[status], value }))
    : [];
  return (
    <div className="space-y-5">
      <PageHeader title="Главная" description={`Сегодня ${formatDateLong(data.today)}`} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Активные группы" value={c.activeGroups} icon={GraduationCap} onClick={() => navigate('/groups')} />
        <StatCard title="Преподаватели" value={c.teachers} icon={Users} onClick={() => navigate('/teachers')} />
        <StatCard title="Аудитории" value={c.classrooms} icon={Building2} onClick={() => navigate('/classrooms')} />
        <StatCard title="Занятий сегодня" value={c.lessonsToday} icon={CalendarClock} tone="info" onClick={() => navigate('/schedule?view=day')} />
        <StatCard
          title="Отменённые занятия"
          value={c.cancelledLessons}
          hint="±30 дней от сегодня"
          icon={CalendarX2}
          tone={c.cancelledLessons ? 'warning' : 'success'}
        />
        <StatCard
          title="Часы к отработке"
          value={c.hoursToMakeUp}
          hint={`Открытых задач: ${c.openMakeupTasks}`}
          icon={RotateCcw}
          tone={c.hoursToMakeUp ? 'warning' : 'success'}
          onClick={() => navigate('/makeup')}
        />
        <StatCard
          title="Дисциплины с дефицитом часов"
          value={c.deficitDisciplines}
          hint={`В зоне риска: ${c.riskDisciplines}`}
          icon={ClipboardCheck}
          tone={c.deficitDisciplines ? 'danger' : c.riskDisciplines ? 'warning' : 'success'}
          onClick={() => navigate('/hour-control')}
        />
        <StatCard
          title="Конфликты в расписании"
          value={c.validationErrors}
          hint={`Предупреждений: ${c.validationWarnings} · перегрузка преподавателей: ${c.workloadWarnings}`}
          icon={ShieldAlert}
          tone={c.validationErrors ? 'danger' : c.validationWarnings || c.workloadWarnings ? 'warning' : 'success'}
          onClick={() => navigate('/schedule')}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
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
                    <span className="text-3xl font-semibold tabular-nums">{formatNumber(data.planCompletion.percent, 1)}%</span>
                    <span className="text-muted-foreground text-sm">прогноз {formatNumber(data.planCompletion.forecastPercent, 1)}%</span>
                  </div>
                  <Progress value={data.planCompletion.percent} className="mt-2" />
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="bg-muted/50 rounded-md p-2">
                    <div className="text-muted-foreground text-xs">План</div>
                    <div className="font-semibold tabular-nums">{data.planCompletion.planned} ч</div>
                  </div>
                  <div className="bg-muted/50 rounded-md p-2">
                    <div className="text-muted-foreground text-xs">В расписании</div>
                    <div className="font-semibold tabular-nums">{data.planCompletion.scheduled} ч</div>
                  </div>
                  <div className="bg-muted/50 rounded-md p-2">
                    <div className="text-muted-foreground text-xs">Проведено</div>
                    <div className="font-semibold tabular-nums">{data.planCompletion.conducted} ч</div>
                  </div>
                </div>
                {pie.length > 0 && (
                  <div className="flex items-center gap-4">
                    <div className="h-32 w-32 shrink-0">
                      <ResponsiveContainer>
                        <PieChart>
                          <Pie data={pie} dataKey="value" nameKey="name" innerRadius={34} outerRadius={60} paddingAngle={2}>
                            {pie.map((p) => (
                              <Cell key={p.status} fill={STATUS_COLORS[p.status]} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-1 text-sm">
                      {pie.map((p) => (
                        <div key={p.status} className="flex items-center gap-2">
                          <span className="size-2.5 rounded-sm" style={{ background: STATUS_COLORS[p.status] }} />
                          {p.name}: <span className="font-medium tabular-nums">{p.value}</span>
                        </div>
                      ))}
                    </div>
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
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={30} />
                <Tooltip formatter={(v) => [v, 'Занятий']} labelFormatter={(l) => `День: ${l}`} />
                <Bar dataKey="lessons" fill="var(--primary)" radius={[4, 4, 0, 0]} />
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
        <Card className="xl:col-span-2">
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
                      <TableCell className="font-medium">
                        {d.groupCode}
                        {d.subgroupNumber ? ` (п/г ${d.subgroupNumber})` : ''}
                      </TableCell>
                      <TableCell className="max-w-72 truncate">{d.discipline}</TableCell>
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
        <div className="space-y-4">
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
                  <Link key={w.teacherId} to={`/teachers/${w.teacherId}`} className="hover:bg-muted/50 block rounded-md border p-2 text-sm">
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
                <Link key={p.id} to={`/schedule?period=${p.id}`} className="hover:bg-muted/50 flex items-center justify-between gap-2 rounded-md border p-2">
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

function LessonRow({ lesson, onClick, showGroup = true }: { lesson: Lesson; onClick?: () => void; showGroup?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'hover:bg-muted/50 flex w-full items-center gap-3 rounded-md border p-2.5 text-left transition-colors',
        lesson.status === 'CANCELLED' && 'opacity-60',
      )}
    >
      <div className="bg-primary/10 text-primary flex size-10 shrink-0 flex-col items-center justify-center rounded-md">
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
