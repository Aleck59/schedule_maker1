import { useState } from 'react';
import { ArrowLeft, Download, Pencil, Trash2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AvailabilityEditor } from '@/components/common/availability-editor';
import { Confirm } from '@/components/common/confirm';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState, LoadingState } from '@/components/common/states';
import { StatCard } from '@/components/common/stat-card';
import { EntityWeekSchedule } from '@/components/schedule/entity-week-schedule';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePeriods, useSettings } from '@/hooks/use-reference';
import { api, downloadFile, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { addDays, formatDate, today, weekStart } from '@/lib/format';
import { CLASSROOM_TYPE_LABELS, WEEKDAYS_SHORT } from '@/lib/labels';
import { useApi, useApiMutation } from '@/lib/query';
import type { Classroom } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ClassroomDialog } from './ClassroomsPage';

interface Occupancy {
  range: { from: string; to: string };
  occupancy: { slotsTotal: number; slotsUsed: number; percent: number; grid: Record<string, number> };
}

export default function ClassroomDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const settings = useSettings();
  const classroom = useApi<Classroom>(['classroom', id], `/classrooms/${id}`);
  const periods = usePeriods();
  const [edit, setEdit] = useState(false);
  const from = weekStart(today());
  const [range, setRange] = useState({ from, to: addDays(from, 27) });
  const occupancy = useApi<Occupancy>(['classroom-occupancy', id, range], `/classrooms/${id}/schedule`, range);
  const remove = useApiMutation(() => api.delete(`/classrooms/${id}`), {
    success: 'Аудитория удалена',
    invalidate: [['classrooms']],
    onSuccess: () => navigate('/classrooms'),
  });
  if (classroom.isLoading) return <LoadingState rows={8} />;
  if (classroom.error) return <ErrorState error={classroom.error} onRetry={() => classroom.refetch()} />;
  const c = classroom.data!;
  const period = (periods.data ?? []).find((p) => p.status !== 'ARCHIVED');
  const days = settings.data?.settings.workingDays ?? [1, 2, 3, 4, 5, 6];
  const lessons = settings.data?.settings.lessonsPerDay ?? 6;
  const weeks = Math.max(1, Math.round((new Date(range.to).getTime() - new Date(range.from).getTime()) / (7 * 86400000)));
  const o = occupancy.data?.occupancy;

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link to="/classrooms">
          <ArrowLeft /> Аудитории
        </Link>
      </Button>
      <PageHeader
        title={`Аудитория ${c.code}`}
        description={`${c.name} · ${CLASSROOM_TYPE_LABELS[c.classroomType]} · ${c.capacity} мест${c.building ? ` · ${c.building}` : ''}`}
        actions={
          <>
            {!c.isActive && <Badge variant="muted">Не используется</Badge>}
            {period && (
              <Button
                variant="outline"
                onClick={() => downloadFile(`/schedule-periods/${period.id}/export/classroom/${c.id}/pdf`, undefined, 'Аудитория.pdf').catch((e) => toast.error(errorMessage(e)))}
              >
                <Download /> PDF занятости
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
                  title="Удалить аудиторию?"
                  description="Аудиторию с занятиями в расписании удалить нельзя — отметьте её как неиспользуемую."
                  destructive
                  confirmText="Удалить"
                  onConfirm={() => remove.mutate(undefined)}
                />
              </>
            )}
          </>
        }
      />
      <Tabs defaultValue="schedule">
        <TabsList>
          <TabsTrigger value="schedule">Расписание</TabsTrigger>
          <TabsTrigger value="occupancy">Занятость</TabsTrigger>
          <TabsTrigger value="availability">Доступность</TabsTrigger>
        </TabsList>
        <TabsContent value="schedule">
          <EntityWeekSchedule filter={{ classroomId: c.id }} mode="classroom" />
        </TabsContent>
        <TabsContent value="occupancy" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Период:</span>
            <input type="date" className="rounded border px-2 py-1" value={range.from} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} />
            <span>—</span>
            <input type="date" className="rounded border px-2 py-1" value={range.to} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} />
          </div>
          {occupancy.isLoading || !o ? (
            <LoadingState rows={4} />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <StatCard title="Загрузка" value={`${o.percent}%`} tone={o.percent > 85 ? 'danger' : o.percent > 60 ? 'warning' : 'success'} />
                <StatCard title="Занято слотов" value={o.slotsUsed} />
                <StatCard title="Всего слотов" value={o.slotsTotal} hint={`${formatDate(range.from)} — ${formatDate(range.to)}`} />
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>Тепловая карта занятости</CardTitle>
                  <CardDescription>Сколько раз слот (день недели × пара) занят за период ({weeks} нед.)</CardDescription>
                </CardHeader>
                <CardContent>
                  <table className="border-collapse text-xs">
                    <thead>
                      <tr>
                        <th />
                        {Array.from({ length: lessons }, (_, i) => (
                          <th key={i} className="w-14 p-1 font-medium">
                            {i + 1} пара
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {days.map((d) => (
                        <tr key={d}>
                          <td className="pr-2 font-medium">{WEEKDAYS_SHORT[d]}</td>
                          {Array.from({ length: lessons }, (_, i) => {
                            const v = o.grid[`${d}-${i + 1}`] ?? 0;
                            const ratio = Math.min(1, v / weeks);
                            return (
                              <td key={i} className="p-0.5">
                                <div
                                  className={cn('flex h-8 w-14 items-center justify-center rounded border', ratio > 0.5 && 'text-white')}
                                  style={{ background: v ? `color-mix(in oklab, var(--primary) ${Math.round(15 + ratio * 85)}%, transparent)` : undefined }}
                                >
                                  {v || ''}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
        <TabsContent value="availability">
          <Card>
            <CardHeader>
              <CardTitle>Доступность аудитории</CardTitle>
              <CardDescription>Недоступные слоты (ремонт, мероприятия) не используются генератором</CardDescription>
            </CardHeader>
            <CardContent>
              <AvailabilityEditor path={`/classrooms/${c.id}/availability`} editable={canEdit} invalidateKey={['classroom', id]} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <ClassroomDialog open={edit} onOpenChange={setEdit} classroom={c} />
    </div>
  );
}
