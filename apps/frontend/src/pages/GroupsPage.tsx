import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { DataTable } from '@/components/common/data-table';
import { Field } from '@/components/common/field';
import { PageHeader } from '@/components/common/page-header';
import { SimpleSelect } from '@/components/common/simple-select';
import { ErrorState, LoadingState, Spinner } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useGroups, usePrograms } from '@/hooks/use-reference';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { EDUCATION_LEVEL_LABELS, STUDY_FORM_LABELS } from '@/lib/labels';
import { useApiMutation } from '@/lib/query';
import { cn } from '@/lib/utils';
import type { Group } from '@/lib/types';

export default function GroupsPage() {
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const groups = useGroups();
  const [open, setOpen] = useState(false);
  const columns: ColumnDef<Group>[] = [
    {
      accessorKey: 'code',
      header: 'Группа',
      cell: ({ row }) => (
        <div className="whitespace-nowrap">
          <div className="font-semibold">{row.original.code}</div>
          <div className="text-muted-foreground text-xs">набор {row.original.admissionYear}</div>
        </div>
      ),
    },
    {
      id: 'program',
      header: 'Специальность',
      accessorFn: (g) => `${g.program?.specialty?.code ?? ''} ${g.program?.specialty?.name ?? ''}`,
      cell: ({ row }) => {
        const g = row.original;
        const level = g.program?.specialty?.educationLevel ?? 'SPO';
        const mode = studyModeText(g);
        return (
          <div className="max-w-96 min-w-56">
            <div className="truncate" title={g.program?.title}>
              {g.program?.specialty?.code} {g.program?.specialty?.name}
            </div>
            <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
              <Badge variant={level === 'SPO' ? 'secondary' : 'violet'} className="px-1.5 py-0 text-[11px]">
                {EDUCATION_LEVEL_LABELS[level]}
              </Badge>
              <span className="truncate">
                {STUDY_FORM_LABELS[g.program?.studyForm ?? 'FULL_TIME']?.toLowerCase()}
                {mode && ` · ${mode}`}
              </span>
            </div>
          </div>
        );
      },
    },
    { accessorKey: 'courseNumber', header: 'Курс' },
    { accessorKey: 'currentSemesterNumber', header: 'Сем.' },
    { accessorKey: 'studentCount', header: 'Студентов' },
    {
      id: 'subgroups',
      header: 'Подгруппы',
      cell: ({ row }) => row.original.subgroups.map((s) => `${s.name} (${s.studentCount})`).join(', ') || '—',
    },
    { id: 'assignments', header: 'Назначений', cell: ({ row }) => row.original._count?.assignments ?? 0 },
    {
      accessorKey: 'isActive',
      header: 'Статус',
      cell: ({ getValue }) =>
        getValue<boolean>() ? <span className="text-muted-foreground text-xs">обучается</span> : <Badge variant="muted">Выпуск / архив</Badge>,
    },
  ];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Учебные группы"
        description="Группы, подгруппы и студенты"
        actions={
          canEdit && (
            <Button onClick={() => setOpen(true)}>
              <Plus /> Группа
            </Button>
          )
        }
      />
      {groups.isLoading ? (
        <LoadingState rows={6} />
      ) : groups.error ? (
        <ErrorState error={groups.error} onRetry={() => groups.refetch()} />
      ) : (
        <DataTable data={groups.data ?? []} columns={columns} onRowClick={(g) => navigate(`/groups/${g.id}`)} searchPlaceholder="Поиск группы…" />
      )}
      <GroupDialog open={open} onOpenChange={setOpen} onSaved={(id) => navigate(`/groups/${id}`)} />
    </div>
  );
}

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

/** Режим занятий группы для таблицы: «пары 5–7, пн–сб» */
export function studyModeText(g: Pick<Group, 'studyDays' | 'firstLessonNumber' | 'lastLessonNumber'>): string {
  const parts: string[] = [];
  if (g.firstLessonNumber || g.lastLessonNumber) parts.push(`пары ${g.firstLessonNumber ?? 1}–${g.lastLessonNumber ?? '…'}`);
  if (g.studyDays?.length) parts.push(g.studyDays.map((d) => WEEKDAYS[d - 1]).join(', '));
  return parts.join(', ');
}

const lessonNumber = z.number({ invalid_type_error: 'Введите число' }).int().min(1, 'От 1').max(12, 'До 12').nullable();

const groupSchema = z
  .object({
    educationalProgramId: z.string().min(1, 'Выберите учебный план'),
    code: z.string().trim().min(1, 'Укажите шифр группы'),
    title: z.string().optional(),
    courseNumber: z.number({ invalid_type_error: 'Введите число' }).int().min(1, 'От 1').max(7, 'До 7'),
    currentSemesterNumber: z.number({ invalid_type_error: 'Введите число' }).int().min(1, 'От 1').max(14, 'До 14'),
    studentCount: z.number({ invalid_type_error: 'Введите число' }).int().min(1, 'Не менее 1 студента').max(60, 'Не более 60'),
    subgroupCount: z.number({ invalid_type_error: 'Введите число' }).int().min(1, 'От 1').max(4, 'До 4'),
    studyDays: z.array(z.number()),
    firstLessonNumber: lessonNumber,
    lastLessonNumber: lessonNumber,
  })
  .refine((v) => !v.firstLessonNumber || !v.lastLessonNumber || v.firstLessonNumber <= v.lastLessonNumber, {
    message: 'Первая пара не может быть позже последней',
    path: ['lastLessonNumber'],
  });
export type GroupForm = z.infer<typeof groupSchema>;

export function GroupDialog({
  open,
  onOpenChange,
  group,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  group?: Group;
  onSaved?: (id: string) => void;
}) {
  const programs = usePrograms(open);
  const form = useForm<GroupForm>({
    resolver: zodResolver(groupSchema),
    values: group
      ? {
          educationalProgramId: group.educationalProgramId,
          code: group.code,
          title: group.title,
          courseNumber: group.courseNumber,
          currentSemesterNumber: group.currentSemesterNumber,
          studentCount: group.studentCount,
          subgroupCount: group.subgroupCount,
          studyDays: group.studyDays ?? [],
          firstLessonNumber: group.firstLessonNumber,
          lastLessonNumber: group.lastLessonNumber,
        }
      : {
          educationalProgramId: '',
          code: '',
          title: '',
          courseNumber: 1,
          currentSemesterNumber: 1,
          studentCount: 25,
          subgroupCount: 2,
          studyDays: [],
          firstLessonNumber: null,
          lastLessonNumber: null,
        },
  });
  const save = useApiMutation(
    (v: GroupForm) => (group ? api.patch<Group>(`/groups/${group.id}`, v) : api.post<Group>('/groups', { ...v, title: v.title || v.code })),
    {
      success: 'Группа сохранена',
      invalidate: [['groups'], ['group']],
      onSuccess: (g) => {
        onOpenChange(false);
        onSaved?.(g.id);
      },
    },
  );
  const e = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{group ? `Группа ${group.code}` : 'Новая группа'}</DialogTitle>
        </DialogHeader>
        <form id="group-form" className="grid gap-3 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          <Field label="Учебный план" required error={e.educationalProgramId?.message} className="sm:col-span-2">
            <Controller
              control={form.control}
              name="educationalProgramId"
              render={({ field }) => (
                <SimpleSelect
                  value={field.value || null}
                  onChange={(v) => field.onChange(v ?? '')}
                  disabled={!!group}
                  options={(programs.data ?? []).map((p) => ({ value: p.id, label: p.title }))}
                />
              )}
            />
          </Field>
          <Field label="Шифр" required error={e.code?.message}>
            <Input placeholder="ИСП-24-1" {...form.register('code')} />
          </Field>
          <Field label="Наименование">
            <Input {...form.register('title')} />
          </Field>
          <Field label="Курс" required error={e.courseNumber?.message}>
            <Input type="number" {...form.register('courseNumber', { valueAsNumber: true })} />
          </Field>
          <Field label="Текущий семестр" required error={e.currentSemesterNumber?.message}>
            <Input type="number" {...form.register('currentSemesterNumber', { valueAsNumber: true })} />
          </Field>
          <Field label="Численность" required error={e.studentCount?.message}>
            <Input type="number" {...form.register('studentCount', { valueAsNumber: true })} />
          </Field>
          <Field label="Подгрупп" required error={e.subgroupCount?.message} hint="Для лабораторных и иностранного языка">
            <Input type="number" {...form.register('subgroupCount', { valueAsNumber: true })} />
          </Field>
          <div className="space-y-2 rounded-md border p-3 sm:col-span-2">
            <div className="text-sm font-medium">Режим занятий</div>
            <div className="text-muted-foreground text-xs">
              Для второй смены, вечерних и очно-заочных групп. Пусто — все учебные дни и все пары.
            </div>
            <Controller
              control={form.control}
              name="studyDays"
              render={({ field }) => (
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((d, i) => {
                    const day = i + 1;
                    const on = field.value.includes(day);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => field.onChange(on ? field.value.filter((x) => x !== day) : [...field.value, day].sort())}
                        className={cn(
                          'h-8 w-10 rounded-md border text-sm',
                          on ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted',
                        )}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field label="С пары" error={e.firstLessonNumber?.message}>
                <Input type="number" placeholder="1" {...form.register('firstLessonNumber', { setValueAs: (v) => (v === '' ? null : Number(v)) })} />
              </Field>
              <Field label="По пару" error={e.lastLessonNumber?.message}>
                <Input type="number" placeholder="все" {...form.register('lastLessonNumber', { setValueAs: (v) => (v === '' ? null : Number(v)) })} />
              </Field>
            </div>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button type="submit" form="group-form" disabled={save.isPending}>
            {save.isPending && <Spinner />} Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
