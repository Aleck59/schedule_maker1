import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, TriangleAlert, UsersRound } from 'lucide-react';
import { Confirm } from '@/components/common/confirm';
import { Field } from '@/components/common/field';
import { SimpleSelect } from '@/components/common/simple-select';
import { EmptyState, ErrorState, LoadingState, Spinner } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useGroups, useTeachers } from '@/hooks/use-reference';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { pluralize } from '@/lib/format';
import { LESSON_TYPE_LABELS } from '@/lib/labels';
import { useApi, useApiMutation } from '@/lib/query';
import type { Assignment } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface Stream {
  name: string;
  teachers: Array<{ id: string; fullName: string }>;
  studentCount: number;
  assignments: Assignment[];
  problems: string[];
}

const typeText = (a: Assignment) => (a.lessonType ? LESSON_TYPE_LABELS[a.lessonType].toLowerCase() : 'все виды');

/**
 * Потоки: один преподаватель ведёт пару сразу у нескольких групп (физкультура, общие лекции).
 * Генератор ставит такие пары одновременно, и у преподавателя освобождается время.
 */
export function StreamsTab() {
  const { canEdit } = useAuth();
  const streams = useApi<Stream[]>(['assignment-streams'], '/assignments/streams');
  const [edit, setEdit] = useState<Stream | 'new' | null>(null);
  const remove = useApiMutation((name: string) => api.delete(`/assignments/streams/${encodeURIComponent(name)}`), {
    success: 'Поток расформирован',
    invalidate: [['assignment-streams'], ['assignments']],
  });

  if (streams.isLoading) return <LoadingState rows={4} />;
  if (streams.error) return <ErrorState error={streams.error} onRetry={() => streams.refetch()} />;
  const list = streams.data ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-muted-foreground min-w-0 flex-1 text-sm">
          Группы потока занимаются вместе: одна пара у одного преподавателя одновременно для всех групп. Подходит для физкультуры и
          общих лекций, разгружает расписание преподавателя.
        </p>
        {canEdit && (
          <Button onClick={() => setEdit('new')}>
            <Plus /> Новый поток
          </Button>
        )}
      </div>
      {list.length === 0 ? (
        <EmptyState
          title="Потоков пока нет"
          description="Объедините группы, у которых один преподаватель ведёт одну и ту же дисциплину, например физкультуру"
        />
      ) : (
        <div className="stagger grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((s) => (
            <Card key={s.name} className="lift">
              <CardContent className="space-y-2.5 p-4">
                <div className="flex items-start gap-2">
                  <UsersRound className="text-primary mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium" title={s.name}>
                      {s.name}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {s.teachers.map((t) => t.fullName).join(', ') || 'преподаватель не назначен'} · {s.studentCount}{' '}
                      {pluralize(s.studentCount, 'студент', 'студента', 'студентов')}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0">
                      <Button variant="ghost" size="icon-sm" onClick={() => setEdit(s)} aria-label="Изменить поток">
                        <Pencil />
                      </Button>
                      <Confirm
                        trigger={
                          <Button variant="ghost" size="icon-sm" aria-label="Расформировать поток">
                            <Trash2 />
                          </Button>
                        }
                        title={`Расформировать поток «${s.name}»?`}
                        description="Группы снова будут заниматься отдельно. Уже поставленные пары останутся, изменения появятся после следующего составления."
                        destructive
                        confirmText="Расформировать"
                        onConfirm={() => remove.mutate(s.name)}
                      />
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  {s.assignments.map((a) => (
                    <div key={a.id} className="flex items-center gap-2 text-sm">
                      <Badge variant="secondary" className="shrink-0">
                        {a.group.code}
                      </Badge>
                      <span className="text-muted-foreground min-w-0 truncate text-xs" title={a.semesterItem.curriculumItem.name}>
                        {a.semesterItem.curriculumItem.name} · {typeText(a)}
                      </span>
                    </div>
                  ))}
                </div>
                {s.problems.map((p) => (
                  <div key={p} className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                    <TriangleAlert className="mt-px size-3.5 shrink-0" /> {p}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {edit && <StreamDialog stream={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function StreamDialog({ stream, onClose }: { stream: Stream | null; onClose: () => void }) {
  const teachers = useTeachers();
  const groups = useGroups();
  const [teacherId, setTeacherId] = useState<string | null>(stream?.teachers[0]?.id ?? null);
  const [name, setName] = useState(stream?.name ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set(stream?.assignments.map((a) => a.id) ?? []));
  const [onlyCurrent, setOnlyCurrent] = useState(true);
  const assignments = useApi<Assignment[]>(['assignments', 'teacher', teacherId], teacherId ? '/assignments' : null, { teacherId });

  const currentSemester = useMemo(() => new Map((groups.data ?? []).map((g) => [g.id, g.currentSemesterNumber])), [groups.data]);
  const candidates = useMemo(
    () =>
      (assignments.data ?? []).filter(
        (a) =>
          a.subgroupNumber === null &&
          (selected.has(a.id) || !onlyCurrent || a.semesterItem.semester.number === currentSemester.get(a.studentGroupId)) &&
          (!a.streamKey || a.streamKey === stream?.name || selected.has(a.id)),
      ),
    [assignments.data, onlyCurrent, currentSemester, selected, stream?.name],
  );
  const chosen = (assignments.data ?? []).filter((a) => selected.has(a.id));
  const sameGroupTwice = new Set(chosen.map((a) => a.studentGroupId)).size !== chosen.length;
  const students = chosen.reduce((sum, a) => sum + a.group.studentCount, 0);

  const save = useApiMutation(
    () => api.post('/assignments/streams', { name: name.trim(), assignmentIds: [...selected], previousName: stream?.name }),
    { success: 'Поток сохранён', invalidate: [['assignment-streams'], ['assignments']], onSuccess: onClose },
  );
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{stream ? `Поток «${stream.name}»` : 'Новый поток'}</DialogTitle>
          <DialogDescription>Выберите преподавателя и отметьте группы, у которых он ведёт пару одновременно.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Преподаватель">
            <SimpleSelect
              value={teacherId}
              onChange={(v) => {
                setTeacherId(v);
                setSelected(new Set());
              }}
              options={(teachers.data ?? []).filter((t) => t.isActive).map((t) => ({ value: t.id, label: t.fullName }))}
            />
          </Field>
          <Field label="Название потока" hint="Например, «Физкультура 2 курс»">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Физкультура 2 курс" />
          </Field>
        </div>
        {teacherId && (
          <div className="space-y-2">
            <label className="text-muted-foreground flex items-center gap-2 text-xs">
              <Switch checked={onlyCurrent} onCheckedChange={setOnlyCurrent} /> Только текущие семестры групп
            </label>
            <div className="max-h-72 overflow-y-auto rounded-lg border scrollbar-thin">
              {assignments.isLoading ? (
                <div className="p-3">
                  <LoadingState rows={3} />
                </div>
              ) : candidates.length === 0 ? (
                <div className="text-muted-foreground p-4 text-center text-sm">У преподавателя нет назначений на всю группу</div>
              ) : (
                candidates.map((a) => (
                  <label
                    key={a.id}
                    className={cn(
                      'hover:bg-muted/50 flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-0',
                      selected.has(a.id) && 'bg-primary/5',
                    )}
                  >
                    <Checkbox checked={selected.has(a.id)} onCheckedChange={() => toggle(a.id)} />
                    <span className="w-24 shrink-0 font-medium">{a.group.code}</span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-muted-foreground">{a.semesterItem.curriculumItem.code}</span> {a.semesterItem.curriculumItem.name}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {typeText(a)} · {a.semesterItem.semester.number} сем.
                    </span>
                  </label>
                ))
              )}
            </div>
            <div className={cn('text-xs', sameGroupTwice ? 'text-destructive' : 'text-muted-foreground')}>
              {sameGroupTwice
                ? 'Одна группа выбрана дважды — оставьте одно назначение на группу'
                : `Выбрано групп: ${chosen.length}, студентов: ${students}. Аудитория потока должна вмещать всех.`}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={() => save.mutate(undefined)} disabled={save.isPending || selected.size < 2 || !name.trim() || sameGroupTwice}>
            {save.isPending && <Spinner />} Сохранить поток
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
