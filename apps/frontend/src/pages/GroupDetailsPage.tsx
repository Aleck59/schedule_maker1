import { useState } from 'react';
import { ArrowLeft, Download, Pencil, Trash2, UserPlus } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Confirm } from '@/components/common/confirm';
import { PageHeader } from '@/components/common/page-header';
import { SimpleSelect } from '@/components/common/simple-select';
import { ErrorState, LoadingState, Spinner } from '@/components/common/states';
import { StatCard } from '@/components/common/stat-card';
import { HourStatusBadge } from '@/components/common/status-badge';
import { EntityWeekSchedule } from '@/components/schedule/entity-week-schedule';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { usePeriods } from '@/hooks/use-reference';
import { api, downloadFile, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatNumber } from '@/lib/format';
import { LESSON_TYPE_LABELS } from '@/lib/labels';
import { useApi, useApiMutation } from '@/lib/query';
import type { Assignment, Group, HourControlResponse, Student } from '@/lib/types';
import { GroupDialog } from './GroupsPage';

export default function GroupDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const group = useApi<Group>(['group', id], `/groups/${id}`);
  const periods = usePeriods();
  const [edit, setEdit] = useState(false);
  const remove = useApiMutation(() => api.delete(`/groups/${id}`), {
    success: 'Группа удалена',
    invalidate: [['groups']],
    onSuccess: () => navigate('/groups'),
  });
  if (group.isLoading) return <LoadingState rows={8} />;
  if (group.error) return <ErrorState error={group.error} onRetry={() => group.refetch()} />;
  const g = group.data!;
  const period = (periods.data ?? []).find((p) => p.semester.program?.id === g.educationalProgramId && p.status !== 'ARCHIVED');

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link to="/groups">
          <ArrowLeft /> Группы
        </Link>
      </Button>
      <PageHeader
        title={`Группа ${g.code}`}
        description={`${g.program?.specialty?.code ?? ''} ${g.program?.specialty?.name ?? ''} · ${g.courseNumber} курс · ${g.currentSemesterNumber} семестр`}
        actions={
          <>
            {period && (
              <Button
                variant="outline"
                onClick={() =>
                  downloadFile(`/schedule-periods/${period.id}/export/group/${g.id}/pdf`, undefined, `Расписание_${g.code}.pdf`).catch((e) =>
                    toast.error(errorMessage(e)),
                  )
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
                    <Button variant="ghost" size="icon" aria-label="Удалить группу">
                      <Trash2 />
                    </Button>
                  }
                  title={`Удалить группу ${g.code}?`}
                  description="Группу с занятиями в расписании удалить нельзя — сделайте её неактивной."
                  destructive
                  confirmText="Удалить"
                  onConfirm={() => remove.mutate(undefined)}
                />
              </>
            )}
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard title="Студентов" value={g.studentCount} />
        <StatCard title="Подгрупп" value={g.subgroups.length} hint={g.subgroups.map((s) => `${s.name}: ${s.studentCount}`).join(' · ')} />
        <StatCard title="Назначений нагрузки" value={g._count?.assignments ?? 0} />
        <StatCard title="Занятий в расписании" value={g._count?.lessons ?? 0} />
      </div>
      <Tabs defaultValue="schedule">
        <TabsList>
          <TabsTrigger value="schedule">Расписание</TabsTrigger>
          <TabsTrigger value="hours">Выполнение часов</TabsTrigger>
          <TabsTrigger value="students">Подгруппы и студенты</TabsTrigger>
          <TabsTrigger value="workload">Нагрузка</TabsTrigger>
        </TabsList>
        <TabsContent value="schedule">
          <EntityWeekSchedule filter={{ groupId: g.id }} mode="group" />
        </TabsContent>
        <TabsContent value="hours">
          <GroupHours groupId={g.id} />
        </TabsContent>
        <TabsContent value="students">
          <StudentsTab group={g} editable={canEdit} />
        </TabsContent>
        <TabsContent value="workload">
          <GroupAssignments groupId={g.id} />
        </TabsContent>
      </Tabs>
      <GroupDialog open={edit} onOpenChange={setEdit} group={g} />
    </div>
  );
}

function GroupHours({ groupId }: { groupId: string }) {
  const data = useApi<HourControlResponse>(['hour-control', 'group', groupId], `/groups/${groupId}/hour-control`);
  if (data.isLoading) return <LoadingState rows={5} />;
  if (data.error) return <ErrorState error={data.error} />;
  const { rows, summary } = data.data!;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard title="По плану" value={`${summary.total.planned} ч`} />
        <StatCard title="В расписании" value={`${summary.total.scheduled} ч`} tone="info" />
        <StatCard title="Проведено" value={`${summary.total.conducted} ч`} hint={`${formatNumber(summary.completionPercent, 1)}%`} tone="success" />
        <StatCard
          title="Дефицит в расписании"
          value={`${summary.total.scheduleDeficit} ч`}
          tone={summary.total.scheduleDeficit ? 'danger' : 'success'}
        />
      </div>
      <div className="bg-card overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Сем.</TableHead>
              <TableHead>Дисциплина</TableHead>
              <TableHead>П/г</TableHead>
              <TableHead className="text-right">План</TableHead>
              <TableHead className="text-right">В расп.</TableHead>
              <TableHead className="text-right">Проведено</TableHead>
              <TableHead className="text-right">Осталось</TableHead>
              <TableHead className="text-right">Дефицит</TableHead>
              <TableHead className="w-32">Выполнение</TableHead>
              <TableHead>Статус</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell>{r.semesterNumber}</TableCell>
                <TableCell>
                  {r.itemCode} {r.itemName}
                </TableCell>
                <TableCell>{r.subgroupNumber ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{r.total.planned}</TableCell>
                <TableCell className="text-right tabular-nums">{r.total.scheduled}</TableCell>
                <TableCell className="text-right tabular-nums">{r.total.conducted}</TableCell>
                <TableCell className="text-right tabular-nums">{r.total.remaining}</TableCell>
                <TableCell className="text-right tabular-nums">{r.total.scheduleDeficit}</TableCell>
                <TableCell>
                  <Progress value={r.completionPercent} className="h-1.5" />
                </TableCell>
                <TableCell>
                  <HourStatusBadge status={r.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function StudentsTab({ group, editable }: { group: Group; editable: boolean }) {
  const students = useApi<Student[]>(['students', group.id], `/groups/${group.id}/students`);
  const [addOpen, setAddOpen] = useState(false);
  const [names, setNames] = useState('');
  const [subgroups, setSubgroups] = useState(group.subgroups.map((s) => ({ number: s.number, name: s.name })));
  const invalidate: unknown[][] = [['students', group.id], ['group', group.id], ['groups']];
  const move = useApiMutation((v: { id: string; subgroupNumber: number | null }) => api.patch(`/students/${v.id}`, { subgroupNumber: v.subgroupNumber }), {
    success: 'Студент переведён',
    invalidate,
  });
  const removeStudent = useApiMutation((sid: string) => api.delete(`/students/${sid}`), { success: 'Студент удалён', invalidate });
  const add = useApiMutation(
    () => {
      const list = names
        .split('\n')
        .map((n) => n.trim())
        .filter(Boolean);
      const count = Math.max(1, group.subgroups.length);
      return api.post(`/groups/${group.id}/students`, {
        students: list.map((fullName, i) => ({ fullName, subgroupNumber: group.subgroups.length ? (i % count) + 1 : undefined })),
      });
    },
    {
      success: 'Студенты добавлены',
      invalidate,
      onSuccess: () => {
        setAddOpen(false);
        setNames('');
      },
    },
  );
  const saveSubgroups = useApiMutation(() => api.post(`/groups/${group.id}/subgroups`, { subgroups }), {
    success: 'Подгруппы сохранены',
    invalidate,
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Студенты ({students.data?.length ?? 0})</CardTitle>
          {editable && (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <UserPlus /> Добавить
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {students.isLoading ? (
            <LoadingState rows={5} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>№</TableHead>
                  <TableHead>ФИО</TableHead>
                  <TableHead>Зачётная книжка</TableHead>
                  <TableHead className="w-48">Подгруппа</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(students.data ?? []).map((s, i) => (
                  <TableRow key={s.id}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell className="font-medium">{s.fullName}</TableCell>
                    <TableCell>{s.recordBookNumber ?? '—'}</TableCell>
                    <TableCell>
                      {editable ? (
                        <SimpleSelect
                          size="sm"
                          value={s.subgroup ? String(s.subgroup.number) : null}
                          allowEmpty
                          emptyLabel="Без подгруппы"
                          onChange={(v) => move.mutate({ id: s.id, subgroupNumber: v ? Number(v) : null })}
                          options={group.subgroups.map((sg) => ({ value: String(sg.number), label: sg.name }))}
                        />
                      ) : (
                        (s.subgroup?.name ?? '—')
                      )}
                    </TableCell>
                    <TableCell>
                      {editable && (
                        <Confirm
                          trigger={
                            <Button variant="ghost" size="icon-sm" aria-label="Удалить студента">
                              <Trash2 />
                            </Button>
                          }
                          title={`Удалить студента ${s.fullName}?`}
                          destructive
                          confirmText="Удалить"
                          onConfirm={() => removeStudent.mutate(s.id)}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(students.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground h-16 text-center">
                      Список студентов пуст. Численность группы: {group.studentCount}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Подгруппы</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {subgroups.map((s, i) => (
            <div key={s.number} className="flex items-center gap-2">
              <Badge variant="secondary">{s.number}</Badge>
              <Input
                value={s.name}
                disabled={!editable}
                onChange={(e) => setSubgroups(subgroups.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
              <span className="text-muted-foreground w-16 text-right text-xs">{group.subgroups.find((x) => x.number === s.number)?.studentCount ?? 0} чел.</span>
            </div>
          ))}
          {editable && (
            <div className="flex flex-wrap gap-2 pt-2">
              <Button size="sm" variant="outline" onClick={() => setSubgroups([...subgroups, { number: subgroups.length + 1, name: `Подгруппа ${subgroups.length + 1}` }])}>
                Добавить подгруппу
              </Button>
              {subgroups.length > 1 && (
                <Button size="sm" variant="ghost" onClick={() => setSubgroups(subgroups.slice(0, -1))}>
                  Убрать последнюю
                </Button>
              )}
              <Button size="sm" onClick={() => saveSubgroups.mutate(undefined)} disabled={saveSubgroups.isPending}>
                {saveSubgroups.isPending && <Spinner />} Сохранить
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Добавление студентов</DialogTitle>
            <DialogDescription>По одному ФИО в строке. Студенты распределяются по подгруппам поочерёдно.</DialogDescription>
          </DialogHeader>
          <Textarea rows={10} value={names} onChange={(e) => setNames(e.target.value)} placeholder={'Иванов Иван Иванович\nПетрова Анна Сергеевна'} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Отмена
            </Button>
            <Button onClick={() => add.mutate(undefined)} disabled={!names.trim() || add.isPending}>
              {add.isPending && <Spinner />} Добавить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GroupAssignments({ groupId }: { groupId: string }) {
  const data = useApi<Assignment[]>(['assignments', 'group', groupId], '/assignments', { groupId });
  if (data.isLoading) return <LoadingState rows={5} />;
  if (data.error) return <ErrorState error={data.error} />;
  return (
    <div className="space-y-2">
      <div className="text-muted-foreground text-sm">
        Изменение назначений — в разделе{' '}
        <Link to="/workload" className="text-primary underline">
          «Нагрузка»
        </Link>
      </div>
      <div className="bg-card rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Сем.</TableHead>
              <TableHead>Дисциплина</TableHead>
              <TableHead>Вид занятий</TableHead>
              <TableHead>Подгруппа</TableHead>
              <TableHead>Преподаватель</TableHead>
              <TableHead>Пар/нед.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data.data ?? []).map((a) => (
              <TableRow key={a.id}>
                <TableCell>{a.semesterItem.semester?.number}</TableCell>
                <TableCell>
                  {a.semesterItem.curriculumItem.code} {a.semesterItem.curriculumItem.name}
                </TableCell>
                <TableCell>{a.lessonType ? LESSON_TYPE_LABELS[a.lessonType] : 'Все виды'}</TableCell>
                <TableCell>{a.subgroupNumber ?? 'вся группа'}</TableCell>
                <TableCell>{a.teacher?.fullName ?? <Badge variant="warning">не назначен</Badge>}</TableCell>
                <TableCell>{a.weeklyLessonTarget ?? 'авто'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
