import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Pencil, Plus, Search, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Confirm } from '@/components/common/confirm';
import { DataTable } from '@/components/common/data-table';
import { Field } from '@/components/common/field';
import { PageHeader } from '@/components/common/page-header';
import { SimpleSelect } from '@/components/common/simple-select';
import { EmptyState, ErrorState, LoadingState, Spinner } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useClassrooms, useGroups, useSemesters, useTeachers } from '@/hooks/use-reference';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, pluralize } from '@/lib/format';
import { allowedLevelsOf, CONTROL_FORM_LABELS, LESSON_TYPE_LABELS } from '@/lib/labels';
import { useApi, useApiMutation } from '@/lib/query';
import type { Assignment, SemesterItem } from '@/lib/types';
import { cn } from '@/lib/utils';
import { StreamsTab } from '@/components/workload/streams';
import { contactHours, featuresText, hoursText, isDefaultLessons, lessonsText } from '@/components/workload/format';

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
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'teachers' ? 'teachers' : params.get('tab') === 'streams' ? 'streams' : 'groups';
  return (
    <div className="space-y-5">
      <PageHeader title="Нагрузка" description="Кто ведёт дисциплины групп: виды занятий, подгруппы, потоки" />
      <Tabs
        value={tab}
        onValueChange={(v) => {
          const next = new URLSearchParams(params);
          if (v !== 'groups') next.set('tab', v);
          else next.delete('tab');
          setParams(next, { replace: true });
        }}
      >
        <TabsList>
          <TabsTrigger value="groups">По группам</TabsTrigger>
          <TabsTrigger value="teachers">По преподавателям</TabsTrigger>
          <TabsTrigger value="streams">Потоки</TabsTrigger>
        </TabsList>
        <TabsContent value="groups">
          <GroupAssignments />
        </TabsContent>
        <TabsContent value="teachers">
          <TeachersWorkload />
        </TabsContent>
        <TabsContent value="streams">
          <StreamsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function GroupAssignments() {
  const { canEdit } = useAuth();
  const [params, setParams] = useSearchParams();
  const groups = useGroups();
  const semesters = useSemesters();
  const teachers = useTeachers();
  const [search, setSearch] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [edit, setEdit] = useState<{ item: SemesterItem; assignment?: Assignment } | null>(null);

  const activeGroups = useMemo(() => (groups.data ?? []).filter((g) => g.isActive).sort((a, b) => a.code.localeCompare(b.code)), [groups.data]);
  const group = activeGroups.find((g) => g.id === params.get('group')) ?? activeGroups[0];
  const programSemesters = useMemo(
    () => (semesters.data ?? []).filter((x) => x.educationalProgramId === group?.educationalProgramId).sort((a, b) => a.number - b.number),
    [semesters.data, group],
  );
  // Семестр по умолчанию — текущий семестр группы
  const semester =
    programSemesters.find((x) => x.id === params.get('semester')) ??
    programSemesters.find((x) => x.number === group?.currentSemesterNumber) ??
    programSemesters[0];
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === 'group') next.delete('semester');
    setParams(next, { replace: true });
  };

  const items = useApi<SemesterItem[]>(['semester-items', semester?.id], semester ? `/semesters/${semester.id}/items` : null);
  const assignments = useApi<Assignment[]>(['assignments', group?.id, semester?.id], group && semester ? '/assignments' : null, {
    groupId: group?.id,
    semesterId: semester?.id,
  });
  const generate = useApiMutation(() => api.post<{ created: number }>('/assignments/generate', { studentGroupId: group!.id, semesterId: semester!.id }), {
    success: (r) => (r.created ? `Создано назначений: ${r.created}. Укажите преподавателей` : 'Все дисциплины уже имеют назначения'),
    invalidate: [['assignments']],
  });
  const remove = useApiMutation((id: string) => api.delete(`/assignments/${id}`), { success: 'Назначение удалено', invalidate: [['assignments']] });
  const setTeacher = useApiMutation((v: { id: string; teacherId: string | null }) => api.patch(`/assignments/${v.id}`, { teacherId: v.teacherId }), {
    success: 'Преподаватель назначен',
    invalidate: [['assignments'], ['hour-control'], ['teachers']],
  });

  // Только преподаватели, которым образование позволяет вести занятия у этой группы
  const level = group?.program?.specialty?.educationLevel ?? 'SPO';
  const teacherOptions = useMemo(
    () =>
      (teachers.data ?? [])
        .filter((t) => t.isActive && (t.allowedLevels ?? allowedLevelsOf(t)).includes(level))
        .map((t) => ({ value: t.id, label: t.fullName })),
    [teachers.data, level],
  );

  const byItem = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const a of assignments.data ?? []) map.set(a.semesterCurriculumItemId, [...(map.get(a.semesterCurriculumItemId) ?? []), a]);
    for (const list of map.values()) list.sort((a, b) => Number(!!a.lessonType) - Number(!!b.lessonType) || (a.subgroupNumber ?? 0) - (b.subgroupNumber ?? 0));
    return map;
  }, [assignments.data]);
  const scheduled = (items.data ?? []).filter((i) => i.curriculumItem?.itemType !== 'MODULE' && contactHours(i) > 0);
  const missing = (i: SemesterItem) => {
    const list = byItem.get(i.id) ?? [];
    return list.length === 0 || list.some((a) => !a.teacherId);
  };
  const missingCount = scheduled.filter(missing).length;
  const q = search.trim().toLowerCase();
  const shown = scheduled.filter(
    (i) =>
      (!onlyMissing || missing(i)) &&
      (!q ||
        `${i.curriculumItem?.code} ${i.curriculumItem?.name}`.toLowerCase().includes(q) ||
        (byItem.get(i.id) ?? []).some((a) => a.teacher?.fullName.toLowerCase().includes(q))),
  );

  if (groups.isLoading || semesters.isLoading) return <LoadingState rows={8} />;
  if (!group) return <EmptyState title="Нет активных групп" description="Создайте группу в разделе «Группы»" />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SimpleSelect
          value={group.id}
          onChange={(v) => setParam('group', v)}
          options={activeGroups.map((g) => ({ value: g.id, label: `${g.code} · ${g.studentCount} чел.` }))}
          className="w-full sm:w-52"
        />
        <SimpleSelect
          value={semester?.id ?? null}
          onChange={(v) => setParam('semester', v)}
          options={programSemesters.map((x) => ({
            value: x.id,
            label: `${x.number} семестр${x.number === group.currentSemesterNumber ? ' · текущий' : ''}`,
          }))}
          placeholder="Семестр"
          className="w-full sm:w-56"
        />
        <div className="relative w-full sm:w-64">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Дисциплина или преподаватель…" className="pl-8" />
        </div>
        <Button variant={onlyMissing ? 'secondary' : 'ghost'} onClick={() => setOnlyMissing(!onlyMissing)} disabled={!missingCount && !onlyMissing}>
          <TriangleAlert className={missingCount ? 'text-amber-600' : undefined} /> Без преподавателя: {missingCount}
        </Button>
        {canEdit && semester && (
          <Button variant="outline" className="sm:ml-auto" onClick={() => generate.mutate(undefined)} disabled={generate.isPending}>
            {generate.isPending ? <Spinner /> : <Sparkles />} Сформировать по плану
          </Button>
        )}
      </div>
      {semester && (
        <p className="text-muted-foreground text-sm">
          {group.program?.specialty?.code} {group.program?.specialty?.name} · {formatDate(semester.startDate)} — {formatDate(semester.endDate)} ·{' '}
          {scheduled.length} {pluralize(scheduled.length, 'дисциплина', 'дисциплины', 'дисциплин')},{' '}
          {scheduled.reduce((a, i) => a + contactHours(i), 0)} ч аудиторных
        </p>
      )}
      {items.isLoading || assignments.isLoading ? (
        <LoadingState rows={8} />
      ) : scheduled.length === 0 ? (
        <EmptyState title="В семестре нет дисциплин с аудиторными часами" />
      ) : (
        <div className="bg-card overflow-x-auto rounded-lg border scrollbar-thin">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дисциплина</TableHead>
                <TableHead>Часы</TableHead>
                <TableHead>Занятия</TableHead>
                <TableHead className="w-72">Преподаватель</TableHead>
                <TableHead>Особенности</TableHead>
                {canEdit && <TableHead className="w-24" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((item) => {
                const list = byItem.get(item.id) ?? [];
                const rows = list.length ? list : [null];
                return rows.map((a, i) => (
                  <TableRow key={a?.id ?? item.id} className={cn(i > 0 && 'border-t-0', i < rows.length - 1 && 'border-b-border/40')}>
                    {i === 0 && (
                      <>
                        <TableCell rowSpan={rows.length} className={cn('max-w-80', rows.length > 1 && 'align-top')}>
                          <div className="truncate" title={`${item.curriculumItem?.code} ${item.curriculumItem?.name}`}>
                            <span className="text-muted-foreground">{item.curriculumItem?.code}</span> {item.curriculumItem?.name}
                          </div>
                          {item.controlForm !== 'NONE' && <div className="text-muted-foreground text-xs">{CONTROL_FORM_LABELS[item.controlForm]?.toLowerCase()}</div>}
                        </TableCell>
                        <TableCell
                          rowSpan={rows.length}
                          className={cn('text-muted-foreground text-xs whitespace-nowrap tabular-nums', rows.length > 1 && 'align-top')}
                        >
                          {hoursText(item)}
                        </TableCell>
                      </>
                    )}
                    <TableCell className={cn('text-sm whitespace-nowrap', (!a || isDefaultLessons(a)) && 'text-muted-foreground')}>
                      {a ? lessonsText(a) : '—'}
                    </TableCell>
                    <TableCell>
                      {!a ? (
                        canEdit ? (
                          <Button size="sm" variant="outline" onClick={() => setEdit({ item })}>
                            <Plus /> Назначить
                          </Button>
                        ) : (
                          <span className="text-amber-600">не назначен</span>
                        )
                      ) : canEdit ? (
                        <SimpleSelect
                          size="sm"
                          value={a.teacherId}
                          allowEmpty
                          emptyLabel="Не назначен"
                          onChange={(v) => setTeacher.mutate({ id: a.id, teacherId: v })}
                          options={
                            a.teacherId && !teacherOptions.some((o) => o.value === a.teacherId)
                              ? [{ value: a.teacherId, label: a.teacher?.fullName ?? '—' }, ...teacherOptions]
                              : teacherOptions
                          }
                          className={cn('w-72', !a.teacherId && 'border-amber-400 text-amber-700')}
                        />
                      ) : (
                        (a.teacher?.fullName ?? <span className="text-amber-600">не назначен</span>)
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{a ? featuresText(a) : ''}</TableCell>
                    {canEdit && (
                      <TableCell className="text-right whitespace-nowrap">
                        {a && (
                          <>
                            <Button variant="ghost" size="icon-sm" onClick={() => setEdit({ item, assignment: a })} aria-label="Изменить назначение">
                              <Pencil />
                            </Button>
                            <Confirm
                              trigger={
                                <Button variant="ghost" size="icon-sm" aria-label="Удалить назначение">
                                  <Trash2 />
                                </Button>
                              }
                              title="Удалить назначение?"
                              description={`${item.curriculumItem?.name}: ${lessonsText(a)}`}
                              destructive
                              confirmText="Удалить"
                              onConfirm={() => remove.mutate(a.id)}
                            />
                            {i === 0 && (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => setEdit({ item })}
                                aria-label="Добавить назначение (вид занятий или подгруппа)"
                                title="Разделить: вид занятий или подгруппа"
                              >
                                <Plus />
                              </Button>
                            )}
                          </>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ));
              })}
              {shown.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canEdit ? 6 : 5} className="text-muted-foreground py-8 text-center">
                    Ничего не найдено
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
      {edit && <AssignmentDialog groupId={group.id} item={edit.item} assignment={edit.assignment} onClose={() => setEdit(null)} />}
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
          <Field label="Преподаватель" className="sm:col-span-2" hint="Только те, кто может вести занятия у групп этого уровня образования">
            <SimpleSelect
              value={teacherId}
              onChange={setTeacherId}
              allowEmpty
              emptyLabel="Не назначен"
              options={(teachers.data ?? [])
                .filter(
                  (t) =>
                    t.id === assignment?.teacherId ||
                    (t.isActive && (t.allowedLevels ?? allowedLevelsOf(t)).includes(group?.program?.specialty?.educationLevel ?? 'SPO')),
                )
                .map((t) => ({ value: t.id, label: `${t.fullName}${t.position ? ` — ${t.position.toLowerCase()}` : ''}` }))}
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
          <Field label="Поток" hint="Одинаковое название у групп одного преподавателя — общая пара (вкладка «Потоки»)">
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

function TeachersWorkload() {
  const data = useApi<TeacherWorkloadRow[]>(['workload-teachers', 'current'], '/workload/teachers', { current: true });
  const rows = useMemo(() => [...(data.data ?? [])].sort((a, b) => b.planned - a.planned || a.fullName.localeCompare(b.fullName)), [data.data]);
  const hasSubstitutions = rows.some((r) => r.substitutedHours > 0);
  const columns: ColumnDef<TeacherWorkloadRow>[] = [
    {
      accessorKey: 'fullName',
      header: 'Преподаватель',
      cell: ({ row }) => (
        <Link to={`/teachers/${row.original.teacherId}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
          {row.original.fullName}
        </Link>
      ),
    },
    { accessorKey: 'planned', header: 'План, ч', meta: { className: 'text-right' } },
    { accessorKey: 'scheduled', header: 'В расп., ч', meta: { className: 'text-right' } },
    { accessorKey: 'conducted', header: 'Проведено, ч', meta: { className: 'text-right' } },
    ...(hasSubstitutions
      ? [{ accessorKey: 'substitutedHours', header: 'Замены, ч', meta: { className: 'text-right' } } as ColumnDef<TeacherWorkloadRow>]
      : []),
    {
      id: 'week',
      header: 'Пар на неделе',
      accessorFn: (r) => r.currentWeekLessons,
      cell: ({ row }) => {
        const r = row.original;
        const over = r.currentWeekLessons > r.maxWeeklyLessons;
        return (
          <span className={cn('tabular-nums', over ? 'font-semibold text-red-600' : r.currentWeekLessons === 0 && 'text-muted-foreground')}>
            {r.currentWeekLessons} / {r.maxWeeklyLessons}
          </span>
        );
      },
    },
    {
      accessorKey: 'overloadWeeks',
      header: 'Перегрузка',
      cell: ({ getValue }) =>
        getValue<number>() ? (
          <Badge variant="destructive">
            {getValue<number>()} {pluralize(getValue<number>(), 'неделя', 'недели', 'недель')}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'groups',
      header: 'Групп / дисциплин',
      accessorFn: (r) => r.groups.length,
      cell: ({ row }) => (
        <span className="tabular-nums" title={row.original.groups.join(', ')}>
          {row.original.groups.length} / {row.original.disciplines.length}
        </span>
      ),
    },
  ];
  if (data.isLoading) return <LoadingState rows={6} />;
  if (data.error) return <ErrorState error={data.error} onRetry={() => data.refetch()} />;
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-sm">Текущие семестры всех групп (СПО и ВО). Перегрузка — недели, где пар больше недельного лимита.</p>
      <DataTable data={rows} columns={columns} searchPlaceholder="Поиск преподавателя…" dense />
    </div>
  );
}
