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
import { useApiMutation } from '@/lib/query';
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
        <div>
          <div className="font-semibold">{row.original.code}</div>
          <div className="text-muted-foreground text-xs">{row.original.title}</div>
        </div>
      ),
    },
    {
      id: 'program',
      header: 'Специальность',
      accessorFn: (g) => `${g.program?.specialty?.code ?? ''} ${g.program?.specialty?.name ?? ''}`,
      cell: ({ row }) => (
        <div className="max-w-80">
          <div className="truncate">
            {row.original.program?.specialty?.code} {row.original.program?.specialty?.name}
          </div>
          <div className="text-muted-foreground truncate text-xs">{row.original.program?.title}</div>
        </div>
      ),
    },
    { accessorKey: 'courseNumber', header: 'Курс' },
    { accessorKey: 'currentSemesterNumber', header: 'Семестр' },
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
      cell: ({ getValue }) => (getValue<boolean>() ? <Badge variant="success">Обучается</Badge> : <Badge variant="muted">Выпуск / архив</Badge>),
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

const groupSchema = z.object({
  educationalProgramId: z.string().min(1, 'Выберите учебный план'),
  code: z.string().trim().min(1, 'Укажите шифр группы'),
  title: z.string().optional(),
  courseNumber: z.number({ invalid_type_error: 'Введите число' }).int().min(1, 'От 1').max(6, 'До 6'),
  currentSemesterNumber: z.number({ invalid_type_error: 'Введите число' }).int().min(1, 'От 1').max(12, 'До 12'),
  studentCount: z.number({ invalid_type_error: 'Введите число' }).int().min(1, 'Не менее 1 студента').max(60, 'Не более 60'),
  subgroupCount: z.number({ invalid_type_error: 'Введите число' }).int().min(1, 'От 1').max(4, 'До 4'),
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
        }
      : { educationalProgramId: '', code: '', title: '', courseNumber: 1, currentSemesterNumber: 1, studentCount: 25, subgroupCount: 2 },
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
