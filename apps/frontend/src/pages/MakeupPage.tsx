import { useState } from 'react';
import { CalendarSearch, Check, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Confirm } from '@/components/common/confirm';
import { PageHeader } from '@/components/common/page-header';
import { SimpleSelect } from '@/components/common/simple-select';
import { EmptyState, ErrorState, LoadingState, Spinner } from '@/components/common/states';
import { StatCard } from '@/components/common/stat-card';
import { issuesFromError, IssuesList } from '@/components/schedule/issues-list';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useGroups } from '@/hooks/use-reference';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { addDays, formatDate, today, weekdayName } from '@/lib/format';
import { LESSON_TYPE_LABELS } from '@/lib/labels';
import { useApi, useApiMutation } from '@/lib/query';
import type { FreeSlot, MakeupTask, ValidationIssue } from '@/lib/types';
import { cn } from '@/lib/utils';

const STATUS_LABELS: Record<string, string> = { OPEN: 'Требуется отработка', SCHEDULED: 'Назначена', DONE: 'Проведена', CANCELLED: 'Не требуется' };
const STATUS_VARIANT = { OPEN: 'warning', SCHEDULED: 'info', DONE: 'success', CANCELLED: 'muted' } as const;

export default function MakeupPage() {
  const { canEdit, user } = useAuth();
  const [status, setStatus] = useState<string | null>('OPEN');
  const [groupId, setGroupId] = useState<string | null>(null);
  const groups = useGroups(user?.role !== 'TEACHER');
  const tasks = useApi<MakeupTask[]>(['makeup-tasks', status, groupId], '/makeup-tasks', { status: status ?? undefined, groupId: groupId ?? undefined });
  const all = useApi<MakeupTask[]>(['makeup-tasks', 'all'], '/makeup-tasks');
  const [task, setTask] = useState<MakeupTask | null>(null);
  const cancel = useApiMutation((id: string) => api.patch(`/makeup-tasks/${id}`, { status: 'CANCELLED', notes: 'Отработка не требуется' }), {
    success: 'Задача закрыта',
    invalidate: [['makeup-tasks'], ['dashboard'], ['hour-control']],
  });
  const open = (all.data ?? []).filter((t) => t.status === 'OPEN');
  return (
    <div className="space-y-5">
      <PageHeader
        title="Отработка пропущенных занятий"
        description="При отмене занятия создаётся задача «требуется отработка»: подберите свободный слот, чтобы вернуть часы в план"
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard title="Открытые задачи" value={open.length} tone={open.length ? 'warning' : 'success'} />
        <StatCard title="Часов к отработке" value={open.reduce((a, t) => a + t.academicHours, 0)} tone={open.length ? 'warning' : 'success'} />
        <StatCard title="Назначено отработок" value={(all.data ?? []).filter((t) => t.status === 'SCHEDULED').length} tone="info" />
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="w-56">
          <SimpleSelect
            value={status}
            onChange={setStatus}
            allowEmpty
            emptyLabel="Все статусы"
            options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </div>
        {user?.role !== 'TEACHER' && (
          <div className="w-48">
            <SimpleSelect value={groupId} onChange={setGroupId} allowEmpty emptyLabel="Все группы" options={(groups.data ?? []).map((g) => ({ value: g.id, label: g.code }))} />
          </div>
        )}
      </div>
      {tasks.isLoading ? (
        <LoadingState rows={5} />
      ) : tasks.error ? (
        <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} />
      ) : (tasks.data ?? []).length === 0 ? (
        <EmptyState title="Задач нет" description="Отменённые занятия, требующие отработки, появятся здесь" />
      ) : (
        <div className="bg-card overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Группа</TableHead>
                <TableHead>Дисциплина</TableHead>
                <TableHead>Вид</TableHead>
                <TableHead>Часов</TableHead>
                <TableHead>Преподаватель</TableHead>
                <TableHead>Отменённое занятие</TableHead>
                <TableHead>Отработка</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(tasks.data ?? []).map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">
                    {t.group.code}
                    {t.subgroupNumber ? ` п/г ${t.subgroupNumber}` : ''}
                  </TableCell>
                  <TableCell>
                    {t.semesterItem.curriculumItem.code} {t.semesterItem.curriculumItem.name}
                  </TableCell>
                  <TableCell>{LESSON_TYPE_LABELS[t.lessonType]}</TableCell>
                  <TableCell>{t.academicHours}</TableCell>
                  <TableCell>{t.teacher?.fullName ?? '—'}</TableCell>
                  <TableCell>
                    {t.sourceLesson ? (
                      <Link className="hover:underline" to={`/schedule?period=${t.sourceLesson.schedulePeriodId}&week=${t.sourceLesson.date}`}>
                        {formatDate(t.sourceLesson.date)}, {t.sourceLesson.lessonNumber} пара
                      </Link>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>{t.resolvedLesson ? `${formatDate(t.resolvedLesson.date)}, ${t.resolvedLesson.lessonNumber} пара` : '—'}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[t.status]}>{STATUS_LABELS[t.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {t.status === 'OPEN' && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setTask(t)}>
                          <CalendarSearch /> {canEdit ? 'Назначить' : 'Свободные слоты'}
                        </Button>
                        {canEdit && (
                          <Confirm
                            trigger={
                              <Button size="icon-sm" variant="ghost" aria-label="Отработка не требуется">
                                <X />
                              </Button>
                            }
                            title="Закрыть задачу без отработки?"
                            description="Часы останутся в дефиците, если не будут компенсированы другим способом."
                            onConfirm={() => cancel.mutate(t.id)}
                          />
                        )}
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {task && <ScheduleMakeupDialog task={task} onClose={() => setTask(null)} canSchedule={canEdit} />}
    </div>
  );
}

function ScheduleMakeupDialog({ task, onClose, canSchedule }: { task: MakeupTask; onClose: () => void; canSchedule: boolean }) {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(addDays(today(), 21));
  const slots = useApi<FreeSlot[]>(['makeup-slots', task.id, from, to], `/makeup-tasks/${task.id}/free-slots`, { from, to });
  const [selected, setSelected] = useState<FreeSlot | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null);
  const schedule = useApiMutation(
    (force: boolean) =>
      api.post(`/makeup-tasks/${task.id}/schedule`, {
        date: selected!.date,
        lessonNumber: selected!.lessonNumber,
        classroomId: selected!.classroomId ?? undefined,
        force,
      }),
    {
      success: 'Отработка поставлена в расписание',
      invalidate: [['makeup-tasks'], ['lessons'], ['hour-control'], ['dashboard']],
      onSuccess: onClose,
      onError: (e) => {
        const found = issuesFromError(e);
        setIssues(found);
        return !!found;
      },
    },
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Отработка: {task.semesterItem.curriculumItem.name}</DialogTitle>
          <DialogDescription>
            {task.group.code}
            {task.subgroupNumber ? `, подгруппа ${task.subgroupNumber}` : ''} · {LESSON_TYPE_LABELS[task.lessonType]} · {task.academicHours} ак. ч ·{' '}
            {task.teacher?.fullName ?? 'преподаватель не указан'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 text-sm">
          Искать с <Input type="date" className="w-40" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /> по
          <Input type="date" className="w-40" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </div>
        {slots.isLoading ? (
          <LoadingState rows={4} />
        ) : slots.error ? (
          <ErrorState error={slots.error} />
        ) : (slots.data ?? []).length === 0 ? (
          <EmptyState title="Свободных слотов не найдено" description="Расширьте диапазон дат или освободите время преподавателя" />
        ) : (
          <div className="grid max-h-80 gap-1.5 overflow-y-auto sm:grid-cols-2 scrollbar-thin">
            {(slots.data ?? []).map((s, i) => (
              <button
                key={i}
                type="button"
                disabled={!canSchedule}
                onClick={() => {
                  setSelected(s);
                  setIssues(null);
                }}
                className={cn(
                  'rounded-md border p-2 text-left text-sm transition',
                  canSchedule && 'hover:border-primary/60',
                  selected === s && 'border-primary bg-primary/5 ring-primary/30 ring-2',
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {weekdayName(s.weekday, true)}, {formatDate(s.date)} · {s.lessonNumber} пара
                  </span>
                  {selected === s && <Check className="text-primary size-4" />}
                </div>
                <div className="text-muted-foreground text-xs">
                  {s.startTime}–{s.endTime} · ауд. {s.classroomCode ?? '—'} · {s.note}
                </div>
              </button>
            ))}
          </div>
        )}
        {issues && issues.length > 0 && (
          <Alert variant="destructive">
            <AlertTitle>Конфликты</AlertTitle>
            <AlertDescription>
              <IssuesList issues={issues} />
            </AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Закрыть
          </Button>
          {canSchedule &&
            (issues?.some((i) => i.severity === 'ERROR') ? (
              <Button variant="destructive" onClick={() => schedule.mutate(true)} disabled={!selected || schedule.isPending}>
                Назначить несмотря на конфликты
              </Button>
            ) : (
              <Button onClick={() => schedule.mutate(false)} disabled={!selected || schedule.isPending}>
                {schedule.isPending && <Spinner />} Поставить в расписание
              </Button>
            ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
