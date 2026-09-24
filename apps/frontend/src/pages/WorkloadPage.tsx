import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Pencil, Plus, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Confirm } from '@/components/common/confirm';
import { DataTable } from '@/components/common/data-table';
import { Field } from '@/components/common/field';
import { PageHeader } from '@/components/common/page-header';
import { SimpleSelect } from '@/components/common/simple-select';
import { EmptyState, ErrorState, LoadingState, Spinner } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useClassrooms, useGroups, useSemesters, useTeachers } from '@/hooks/use-reference';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { CONTROL_FORM_LABELS, LESSON_TYPE_LABELS } from '@/lib/labels';
import { useApi, useApiMutation } from '@/lib/query';
import type { Assignment, SemesterItem } from '@/lib/types';

interface TeacherWorkloadRow {
  teacherId: string;
  fullName: string;
  department: string | null;
  isActive: boolean;
  planned: number;
  scheduled: number;
  conducted: number;
  substitutedHours: number;
  currentWeekLessons: number;
  maxWeeklyLessons: number;
  overloadWeeks: number;
  disciplines: string[];
  groups: string[];
}

export default function WorkloadPage() {
  const semesters = useSemesters();
  const [semesterId, setSemesterId] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const current = (semesters.data ?? []).find((s) => s.startDate.slice(0, 10) <= today && s.endDate.slice(0, 10) >= today);
  const sid = semesterId ?? current?.id ?? semesters.data?.[0]?.id ?? null;
  const semester = semesters.data?.find((s) => s.id === sid);

  if (semesters.isLoading) return <LoadingState rows={8} />;
  if (semesters.error) return <ErrorState error={semesters.error} onRetry={() => semesters.refetch()} />;
  if (!sid || !semester) return <EmptyState title="Семестры не созданы" description="Создайте учебный план с семестрами" />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Педагогическая нагрузка"
        description="Назначение преподавателей на дисциплины и виды занятий, подгруппы, потоки и недельная интенсивность"
        actions={
          <div className="w-96">
            <SimpleSelect
              value={sid}
              onChange={setSemesterId}
              options={(semesters.data ?? []).map((s) => ({
                value: s.id,
                label: `${s.program?.title ?? ''} · ${s.number} семестр (${formatDate(s.startDate)} — ${formatDate(s.endDate)})`,
              }))}
            />
          </div>
        }
      />
      <Tabs defaultValue="assignments">
        <TabsList>
          <TabsTrigger value="assignments">Назначения по группам</TabsTrigger>
          <TabsTrigger value="teachers">Нагрузка преподавателей</TabsTrigger>
        </TabsList>
        <TabsContent value="assignments">
          <AssignmentsEditor semesterId={sid} programId={semester.educationalProgramId} />
        </TabsContent>
        <TabsContent value="teachers">
          <TeachersWorkload semesterId={sid} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AssignmentsEditor({ semesterId, programId }: { semesterId: string; programId: string }) {
  const { canEdit } = useAuth();
  const groups = useGroups();
  const programGroups = (groups.data ?? []).filter((g) => g.educationalProgramId === programId && g.isActive);
  const [groupId, setGroupId] = useState<string | null>(null);
  const gid = groupId && programGroups.some((g) => g.id === groupId) ? groupId : (programGroups[0]?.id ?? null);
  const items = useApi<SemesterItem[]>(['semester-items', semesterId], `/semesters/${semesterId}/items`);
  const assignments = useApi<Assignment[]>(['assignments', gid, semesterId], gid ? '/assignments' : null, { groupId: gid ?? undefined, semesterId });
  const [edit, setEdit] = useState<{ item: SemesterItem; assignment?: Assignment } | null>(null);

  const generate = useApiMutation(() => api.post<{ created: number }>('/assignments/generate', { studentGroupId: gid, semesterId }), {
    success: (r) => (r.created ? `Создано назначений: ${r.created}. Укажите преподавателей` : 'Все дисциплины уже имеют назначения'),
    invalidate: [['assignments']],
  });
  const remove = useApiMutation((id: string) => api.delete(`/assignments/${id}`), { success: 'Назначение удалено', invalidate: [['assignments']] });
  const setTeacher = useApiMutation((v: { id: string; teacherId: string | null }) => api.patch(`/assignments/${v.id}`, { teacherId: v.teacherId }), {
    success: 'Преподаватель назначен',
    invalidate: [['assignments'], ['hour-control']],
  });
  const teachers = useTeachers();

  const scheduledItems = (items.data ?? []).filter(
    (i) =>
      i.curriculumItem?.itemType !== 'MODULE' &&
      i.lectureHours + i.practicalHours + i.laboratoryHours + i.consultationHours + (i.practiceAtCollege ? i.practiceHours : 0) > 0,
  );
  const byItem = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const a of assignments.data ?? []) map.set(a.semesterCurriculumItemId, [...(map.get(a.semesterCurriculumItemId) ?? []), a]);
    return map;
  }, [assignments.data]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-56">
          <SimpleSelect value={gid} onChange={setGroupId} options={programGroups.map((g) => ({ value: g.id, label: `${g.code} (${g.studentCount} чел.)` }))} />
        </div>
        {canEdit && gid && (
          <Button variant="outline" onClick={() => generate.mutate(undefined)} disabled={generate.isPending}>
            {generate.isPending ? <Spinner /> : <Sparkles />} Сформировать по учебному плану
          </Button>
        )}
      </div>
      {items.isLoading || assignments.isLoading ? (
        <LoadingState rows={6} />
      ) : (
        <div className="space-y-3">
          {scheduledItems.map((item) => {
            const list = byItem.get(item.id) ?? [];
            const missing = list.length === 0 || list.some((a) => !a.teacher);
            return (
              <Card key={item.id} className="gap-3 py-4">
                <CardHeader className="flex flex-row items-start justify-between gap-2 px-4">
                  <div>
                    <CardTitle className="text-base">
                      {item.curriculumItem?.code} {item.curriculumItem?.name}
                    </CardTitle>
                    <CardDescription>
                      {[
                        item.lectureHours && `лекции ${item.lectureHours} ч`,
                        item.practicalHours && `практические ${item.practicalHours} ч`,
                        item.laboratoryHours && `лабораторные ${item.laboratoryHours} ч`,
                        item.consultationHours && `консультации ${item.consultationHours} ч`,
                        item.practiceAtCollege && item.practiceHours && `практика ${item.practiceHours} ч`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      {item.controlForm !== 'NONE' && ` · ${CONTROL_FORM_LABELS[item.controlForm]}`}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {missing && (
                      <Badge variant="warning">
                        <TriangleAlert /> не назначен преподаватель
                      </Badge>
                    )}
                    {canEdit && (
                      <Button size="sm" variant="outline" onClick={() => setEdit({ item })}>
                        <Plus /> Назначение
                      </Button>
                    )}
                  </div>
                </CardHeader>
                {list.length > 0 && (
                  <CardContent className="px-4">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Вид занятий</TableHead>
                          <TableHead>Подгруппа</TableHead>
                          <TableHead className="w-72">Преподаватель</TableHead>
                          <TableHead>Пар в неделю</TableHead>
                          <TableHead>Аудитория</TableHead>
                          <TableHead>Поток</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {list.map((a) => (
                          <TableRow key={a.id}>
                            <TableCell>{a.lessonType ? LESSON_TYPE_LABELS[a.lessonType] : 'Все виды'}</TableCell>
                            <TableCell>{a.subgroupNumber ? `${a.subgroupNumber} подгруппа` : 'Вся группа'}</TableCell>
                            <TableCell>
                              {canEdit ? (
                                <SimpleSelect
                                  size="sm"
                                  value={a.teacherId}
                                  allowEmpty
                                  emptyLabel="Не назначен"
                                  onChange={(v) => setTeacher.mutate({ id: a.id, teacherId: v })}
                                  options={(teachers.data ?? []).filter((t) => t.isActive).map((t) => ({ value: t.id, label: t.fullName }))}
                                />
                              ) : (
                                (a.teacher?.fullName ?? 'Не назначен')
                              )}
                            </TableCell>
                            <TableCell>{a.weeklyLessonTarget ?? 'авто'}</TableCell>
                            <TableCell>{a.preferredClassroom?.code ?? (a.classroomTypes.length ? a.classroomTypes.length + ' тип(а)' : 'по плану')}</TableCell>
                            <TableCell>{a.streamKey ?? '—'}</TableCell>
                            <TableCell className="text-right whitespace-nowrap">
                              {canEdit && (
                                <>
                                  <Button variant="ghost" size="icon-sm" onClick={() => setEdit({ item, assignment: a })} aria-label="Изменить">
                                    <Pencil />
                                  </Button>
                                  <Confirm
                                    trigger={
                                      <Button variant="ghost" size="icon-sm" aria-label="Удалить">
                                        <Trash2 />
                                      </Button>
                                    }
                                    title="Удалить назначение?"
                                    destructive
                                    confirmText="Удалить"
                                    onConfirm={() => remove.mutate(a.id)}
                                  />
                                </>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                )}
              </Card>
            );
          })}
          {scheduledItems.length === 0 && <EmptyState title="В семестре нет дисциплин с аудиторными часами" />}
        </div>
      )}
      {edit && gid && <AssignmentDialog groupId={gid} item={edit.item} assignment={edit.assignment} onClose={() => setEdit(null)} />}
    </div>
  );
}

function AssignmentDialog({ groupId, item, assignment, onClose }: { groupId: string; item: SemesterItem; assignment?: Assignment; onClose: () => void }) {
  const teachers = useTeachers();
  const classrooms = useClassrooms();
  const groups = useGroups();
  const group = groups.data?.find((g) => g.id === groupId);
  const [lessonType, setLessonType] = useState<string | null>(assignment?.lessonType ?? null);
  const [subgroup, setSubgroup] = useState<string | null>(assignment?.subgroupNumber ? String(assignment.subgroupNumber) : null);
  const [teacherId, setTeacherId] = useState<string | null>(assignment?.teacherId ?? null);
  const [weekly, setWeekly] = useState(assignment?.weeklyLessonTarget ? String(assignment.weeklyLessonTarget) : '');
  const [roomId, setRoomId] = useState<string | null>(assignment?.preferredClassroomId ?? null);
  const [streamKey, setStreamKey] = useState(assignment?.streamKey ?? '');
  const [priority, setPriority] = useState(String(assignment?.priority ?? 0));
  const [allowExcess, setAllowExcess] = useState(assignment?.allowHoursExcess ?? false);

  const body = {
    studentGroupId: groupId,
    semesterCurriculumItemId: item.id,
    lessonType,
    subgroupNumber: subgroup ? Number(subgroup) : null,
    teacherId,
    weeklyLessonTarget: weekly ? Number(weekly) : null,
    preferredClassroomId: roomId,
    streamKey: streamKey || null,
    priority: Number(priority) || 0,
    allowHoursExcess: allowExcess,
  };
  const save = useApiMutation(() => (assignment ? api.patch(`/assignments/${assignment.id}`, body) : api.post('/assignments', body)), {
    success: 'Назначение сохранено',
    invalidate: [['assignments'], ['hour-control']],
    onSuccess: onClose,
  });
  const types: Array<[string, number]> = [
    ['LECTURE', item.lectureHours],
    ['PRACTICAL', item.practicalHours],
    ['LABORATORY', item.laboratoryHours],
    ['CONSULTATION', item.consultationHours],
    ['PRACTICE', item.practiceAtCollege ? item.practiceHours : 0],
  ];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {assignment ? 'Назначение' : 'Новое назначение'}: {item.curriculumItem?.name}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Вид занятий" hint="«Все виды» — если один преподаватель ведёт всё">
            <SimpleSelect
              value={lessonType}
              onChange={setLessonType}
              allowEmpty
              emptyLabel="Все виды"
              options={types.filter(([, h]) => h > 0).map(([t, h]) => ({ value: t, label: `${LESSON_TYPE_LABELS[t]} (${h} ч)` }))}
            />
          </Field>
          <Field label="Подгруппа" hint="Для лабораторных и иностранного языка">
            <SimpleSelect
              value={subgroup}
              onChange={setSubgroup}
              allowEmpty
              emptyLabel="Вся группа"
              options={(group?.subgroups ?? []).map((s) => ({ value: String(s.number), label: `${s.name} (${s.studentCount} чел.)` }))}
            />
          </Field>
          <Field label="Преподаватель" className="sm:col-span-2">
            <SimpleSelect
              value={teacherId}
              onChange={setTeacherId}
              allowEmpty
              emptyLabel="Не назначен"
              options={(teachers.data ?? []).filter((t) => t.isActive).map((t) => ({ value: t.id, label: `${t.fullName}${t.department ? ` — ${t.department}` : ''}` }))}
            />
          </Field>
          <Field label="Пар в неделю" hint="Пусто — рассчитать автоматически">
            <Input type="number" min={1} max={10} value={weekly} onChange={(e) => setWeekly(e.target.value)} />
          </Field>
          <Field label="Приоритет" hint="Больше — ставится раньше">
            <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
          </Field>
          <Field label="Предпочтительная аудитория">
            <SimpleSelect
              value={roomId}
              onChange={setRoomId}
              allowEmpty
              emptyLabel="Любая подходящая"
              options={(classrooms.data ?? []).filter((c) => c.isActive).map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))}
            />
          </Field>
          <Field label="Ключ потока" hint="Одинаковый ключ у групп — общая лекция">
            <Input value={streamKey} onChange={(e) => setStreamKey(e.target.value)} placeholder="напр. ИСП-24-ЭВМ" />
          </Field>
          <label className="flex items-center justify-between gap-3 text-sm sm:col-span-2">
            Разрешить превышение плановых часов
            <Switch checked={allowExcess} onCheckedChange={setAllowExcess} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={() => save.mutate(undefined)} disabled={save.isPending}>
            {save.isPending && <Spinner />} Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TeachersWorkload({ semesterId }: { semesterId: string }) {
  const data = useApi<TeacherWorkloadRow[]>(['workload-teachers', semesterId], '/workload/teachers', { semesterId });
  const columns: ColumnDef<TeacherWorkloadRow>[] = [
    {
      accessorKey: 'fullName',
      header: 'Преподаватель',
      cell: ({ row }) => (
        <Link to={`/teachers/${row.original.teacherId}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
          {row.original.fullName}
          {row.original.department && <div className="text-muted-foreground text-xs font-normal">{row.original.department}</div>}
        </Link>
      ),
    },
    { accessorKey: 'planned', header: 'План, ч', meta: { className: 'text-right' } },
    { accessorKey: 'scheduled', header: 'В расписании, ч', meta: { className: 'text-right' } },
    { accessorKey: 'conducted', header: 'Проведено, ч', meta: { className: 'text-right' } },
    { accessorKey: 'substitutedHours', header: 'Замены, ч', meta: { className: 'text-right' } },
    {
      id: 'week',
      header: 'Пар на этой неделе',
      cell: ({ row }) => (
        <span className={row.original.currentWeekLessons > row.original.maxWeeklyLessons ? 'font-semibold text-red-600' : undefined}>
          {row.original.currentWeekLessons} / {row.original.maxWeeklyLessons}
        </span>
      ),
    },
    {
      accessorKey: 'overloadWeeks',
      header: 'Недель с перегрузкой',
      cell: ({ getValue }) => (getValue<number>() ? <Badge variant="destructive">{getValue<number>()}</Badge> : <Badge variant="success">0</Badge>),
    },
    { id: 'groups', header: 'Группы', cell: ({ row }) => row.original.groups.join(', ') || '—' },
    { id: 'disc', header: 'Дисциплин', cell: ({ row }) => row.original.disciplines.length },
  ];
  if (data.isLoading) return <LoadingState rows={6} />;
  if (data.error) return <ErrorState error={data.error} onRetry={() => data.refetch()} />;
  return <DataTable data={data.data ?? []} columns={columns} searchPlaceholder="Поиск преподавателя…" />;
}
