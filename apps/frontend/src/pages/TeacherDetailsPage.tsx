import { useState } from 'react';
import { ArrowLeft, Download, Pencil, Trash2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AvailabilityEditor } from '@/components/common/availability-editor';
import { Confirm } from '@/components/common/confirm';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState, LoadingState } from '@/components/common/states';
import { StatCard } from '@/components/common/stat-card';
import { HourStatusBadge } from '@/components/common/status-badge';
import { EntityWeekSchedule } from '@/components/schedule/entity-week-schedule';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePeriods } from '@/hooks/use-reference';
import { api, downloadFile, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateShort } from '@/lib/format';
import { LESSON_TYPE_LABELS } from '@/lib/labels';
import { useApi, useApiMutation } from '@/lib/query';
import type { HourControlRow, Teacher } from '@/lib/types';
import { TeacherDialog } from './TeachersPage';

interface Workload {
  teacher: { id: string; fullName: string; maxWeeklyLessons: number; maxDailyLessons: number };
  planned: { total: number; byType: Record<string, number> };
  scheduled: { total: number; byType: Record<string, number> };
  conducted: { total: number; byType: Record<string, number>; substitutedHours: number };
  remaining: number;
  currentWeek: { from: string; to: string; lessons: number; limit: number; overload: boolean };
  weeks: Array<{ week: string; lessons: number; overload: boolean }>;
  overloadWeeks: number;
  rows: HourControlRow[];
}

export default function TeacherDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const teacher = useApi<Teacher>(['teacher', id], `/teachers/${id}`);
  const workload = useApi<Workload>(['teacher-workload', id], `/teachers/${id}/workload`);
  const periods = usePeriods();
  const [edit, setEdit] = useState(false);
  const remove = useApiMutation(() => api.delete(`/teachers/${id}`), {
    success: 'Преподаватель удалён',
    invalidate: [['teachers']],
    onSuccess: () => navigate('/teachers'),
  });
  if (teacher.isLoading) return <LoadingState rows={8} />;
  if (teacher.error) return <ErrorState error={teacher.error} onRetry={() => teacher.refetch()} />;
  const t = teacher.data!;
  const w = workload.data;
  const period = (periods.data ?? []).find((p) => p.status !== 'ARCHIVED');

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link to="/teachers">
          <ArrowLeft /> Преподаватели
        </Link>
      </Button>
      <PageHeader
        title={t.fullName}
        description={[t.position, t.department, t.email, t.phone].filter(Boolean).join(' · ')}
        actions={
          <>
            {!t.isActive && <Badge variant="muted">Не активен</Badge>}
            {period && (
              <Button
                variant="outline"
                onClick={() =>
                  downloadFile(`/schedule-periods/${period.id}/export/teacher/${t.id}/pdf`, undefined, 'Расписание.pdf').catch((e) => toast.error(errorMessage(e)))
                }
              >
                <Download /> PDF расписания
              </Button>
            )}
            {canEdit && (
              <>
                <Button variant="outline" onClick={() => setEdit(true)}>
                  <Pencil /> Изменить
                </Button>
                <Confirm
                  trigger={
                    <Button variant="ghost" size="icon" aria-label="Удалить">
                      <Trash2 />
                    </Button>
                  }
                  title="Удалить преподавателя?"
                  description="Преподавателя с занятиями в расписании удалить нельзя — отметьте его как неактивного."
                  destructive
                  confirmText="Удалить"
                  onConfirm={() => remove.mutate(undefined)}
                />
              </>
            )}
          </>
        }
      />
      {w && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard title="Плановая нагрузка" value={`${w.planned.total} ч`} />
          <StatCard title="В расписании" value={`${w.scheduled.total} ч`} tone="info" />
          <StatCard
            title="Проведено"
            value={`${w.conducted.total} ч`}
            hint={w.conducted.substitutedHours ? `в т. ч. замены: ${w.conducted.substitutedHours} ч` : undefined}
            tone="success"
          />
          <StatCard title="Осталось" value={`${w.remaining} ч`} />
          <StatCard
            title="Пар на этой неделе"
            value={`${w.currentWeek.lessons} / ${w.currentWeek.limit}`}
            hint={`Недель с перегрузкой: ${w.overloadWeeks}`}
            tone={w.currentWeek.overload || w.overloadWeeks ? 'danger' : 'success'}
          />
        </div>
      )}
      <Tabs defaultValue="schedule">
        <TabsList>
          <TabsTrigger value="schedule">Расписание</TabsTrigger>
          <TabsTrigger value="workload">Нагрузка</TabsTrigger>
          <TabsTrigger value="availability">Доступность</TabsTrigger>
        </TabsList>
        <TabsContent value="schedule">
          <EntityWeekSchedule filter={{ teacherId: t.id }} mode="teacher" />
        </TabsContent>
        <TabsContent value="workload" className="space-y-4">
          {!w ? (
            <LoadingState rows={5} />
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Пары по неделям</CardTitle>
                  <CardDescription>Красная линия — недельный лимит ({w.teacher.maxWeeklyLessons} пар)</CardDescription>
                </CardHeader>
                <CardContent className="h-64">
                  <ResponsiveContainer>
                    <BarChart data={w.weeks.map((x) => ({ ...x, label: formatDateShort(x.week) }))}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} width={30} />
                      <Tooltip formatter={(v) => [v, 'Пар']} />
                      <ReferenceLine y={w.teacher.maxWeeklyLessons} stroke="#ef4444" strokeDasharray="4 4" />
                      <Bar dataKey="lessons" fill="var(--primary)" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>По видам занятий</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Вид</TableHead>
                        <TableHead className="text-right">План</TableHead>
                        <TableHead className="text-right">В расписании</TableHead>
                        <TableHead className="text-right">Проведено</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.keys({ ...w.planned.byType, ...w.scheduled.byType, ...w.conducted.byType }).map((type) => (
                        <TableRow key={type}>
                          <TableCell>{LESSON_TYPE_LABELS[type]}</TableCell>
                          <TableCell className="text-right tabular-nums">{w.planned.byType[type] ?? 0}</TableCell>
                          <TableCell className="text-right tabular-nums">{w.scheduled.byType[type] ?? 0}</TableCell>
                          <TableCell className="text-right tabular-nums">{w.conducted.byType[type] ?? 0}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Группы и дисциплины</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Группа</TableHead>
                        <TableHead>Сем.</TableHead>
                        <TableHead>Дисциплина</TableHead>
                        <TableHead>Виды занятий</TableHead>
                        <TableHead className="text-right">План</TableHead>
                        <TableHead className="text-right">В расп.</TableHead>
                        <TableHead className="text-right">Проведено</TableHead>
                        <TableHead>Статус</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {w.rows.map((r) => {
                        const types = Object.entries(r.byType);
                        const sum = (k: 'planned' | 'scheduled' | 'conducted') => types.reduce((a, [, h]) => a + (h?.[k] ?? 0), 0);
                        return (
                          <TableRow key={r.key}>
                            <TableCell>
                              {r.groupCode}
                              {r.subgroupNumber ? ` п/г ${r.subgroupNumber}` : ''}
                            </TableCell>
                            <TableCell>{r.semesterNumber}</TableCell>
                            <TableCell>
                              {r.itemCode} {r.itemName}
                            </TableCell>
                            <TableCell className="text-xs">{types.map(([k]) => LESSON_TYPE_LABELS[k]).join(', ')}</TableCell>
                            <TableCell className="text-right tabular-nums">{sum('planned')}</TableCell>
                            <TableCell className="text-right tabular-nums">{sum('scheduled')}</TableCell>
                            <TableCell className="text-right tabular-nums">{sum('conducted')}</TableCell>
                            <TableCell>
                              <HourStatusBadge status={r.status} />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
        <TabsContent value="availability">
          <Card>
            <CardHeader>
              <CardTitle>Доступность по дням недели и парам</CardTitle>
              <CardDescription>
                Предпочтительные пары: {t.preferredStartLesson}–{t.preferredEndLesson}. Недоступные слоты — жёсткое ограничение генератора.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AvailabilityEditor path={`/teachers/${t.id}/availability`} editable={canEdit} invalidateKey={['teacher', id]} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <TeacherDialog open={edit} onOpenChange={setEdit} teacher={t} />
    </div>
  );
}
