import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { DataTable } from '@/components/common/data-table';
import { Field } from '@/components/common/field';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState, LoadingState, Spinner } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useTeachers } from '@/hooks/use-reference';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/query';
import type { Teacher } from '@/lib/types';

export default function TeachersPage() {
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const teachers = useTeachers();
  const [open, setOpen] = useState(false);
  const columns: ColumnDef<Teacher>[] = [
    {
      accessorKey: 'fullName',
      header: 'ФИО',
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.fullName}</div>
          <div className="text-muted-foreground text-xs">{row.original.position}</div>
        </div>
      ),
    },
    { accessorKey: 'department', header: 'Кафедра / ПЦК', cell: ({ getValue }) => getValue<string>() ?? '—' },
    { id: 'limits', header: 'Макс. пар в неделю / день', cell: ({ row }) => `${row.original.maxWeeklyLessons} / ${row.original.maxDailyLessons}` },
    {
      id: 'preferred',
      header: 'Предпочтительные пары',
      cell: ({ row }) => `${row.original.preferredStartLesson}–${row.original.preferredEndLesson}`,
    },
    { id: 'assignments', header: 'Назначений', cell: ({ row }) => row.original._count?.assignments ?? 0 },
    { id: 'availability', header: 'Ограничений доступности', cell: ({ row }) => row.original._count?.availability ?? 0 },
    {
      id: 'account',
      header: 'Учётная запись',
      cell: ({ row }) => (row.original.user ? row.original.user.email : <span className="text-muted-foreground">—</span>),
    },
    {
      accessorKey: 'isActive',
      header: 'Статус',
      cell: ({ getValue }) => (getValue<boolean>() ? <Badge variant="success">Работает</Badge> : <Badge variant="muted">Не активен</Badge>),
    },
  ];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Преподаватели"
        description="Кадровый состав, ограничения нагрузки и доступность"
        actions={
          canEdit && (
            <Button onClick={() => setOpen(true)}>
              <Plus /> Преподаватель
            </Button>
          )
        }
      />
      {teachers.isLoading ? (
        <LoadingState rows={6} />
      ) : teachers.error ? (
        <ErrorState error={teachers.error} onRetry={() => teachers.refetch()} />
      ) : (
        <DataTable data={teachers.data ?? []} columns={columns} onRowClick={(t) => navigate(`/teachers/${t.id}`)} searchPlaceholder="Поиск преподавателя…" />
      )}
      <TeacherDialog open={open} onOpenChange={setOpen} onSaved={(id) => navigate(`/teachers/${id}`)} />
    </div>
  );
}

const teacherSchema = z
  .object({
    fullName: z.string().trim().min(3, 'Укажите ФИО полностью'),
    department: z.string().optional(),
    position: z.string().optional(),
    email: z.union([z.literal(''), z.string().email('Некорректный e-mail')]).optional(),
    phone: z.string().optional(),
    maxWeeklyLessons: z.number({ invalid_type_error: 'Введите число' }).int().min(1, 'От 1').max(40, 'До 40'),
    maxDailyLessons: z.number({ invalid_type_error: 'Введите число' }).int().min(1, 'От 1').max(8, 'До 8'),
    preferredStartLesson: z.number({ invalid_type_error: 'Введите число' }).int().min(1).max(8),
    preferredEndLesson: z.number({ invalid_type_error: 'Введите число' }).int().min(1).max(8),
    isActive: z.boolean(),
  })
  .refine((v) => v.preferredStartLesson <= v.preferredEndLesson, {
    message: 'Первая пара не может быть позже последней',
    path: ['preferredEndLesson'],
  });
type TeacherForm = z.infer<typeof teacherSchema>;

export function TeacherDialog({
  open,
  onOpenChange,
  teacher,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  teacher?: Teacher;
  onSaved?: (id: string) => void;
}) {
  const form = useForm<TeacherForm>({
    resolver: zodResolver(teacherSchema),
    values: teacher
      ? {
          fullName: teacher.fullName,
          department: teacher.department ?? '',
          position: teacher.position ?? '',
          email: teacher.email ?? '',
          phone: teacher.phone ?? '',
          maxWeeklyLessons: teacher.maxWeeklyLessons,
          maxDailyLessons: teacher.maxDailyLessons,
          preferredStartLesson: teacher.preferredStartLesson,
          preferredEndLesson: teacher.preferredEndLesson,
          isActive: teacher.isActive,
        }
      : {
          fullName: '',
          department: '',
          position: 'Преподаватель',
          email: '',
          phone: '',
          maxWeeklyLessons: 18,
          maxDailyLessons: 4,
          preferredStartLesson: 1,
          preferredEndLesson: 5,
          isActive: true,
        },
  });
  const save = useApiMutation(
    (v: TeacherForm) => {
      const body = { ...v, email: v.email || undefined, phone: v.phone || undefined, department: v.department || undefined, position: v.position || undefined };
      return teacher ? api.patch<Teacher>(`/teachers/${teacher.id}`, body) : api.post<Teacher>('/teachers', body);
    },
    {
      success: 'Преподаватель сохранён',
      invalidate: [['teachers'], ['teacher']],
      onSuccess: (t) => {
        onOpenChange(false);
        onSaved?.(t.id);
      },
    },
  );
  const e = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{teacher ? 'Преподаватель' : 'Новый преподаватель'}</DialogTitle>
        </DialogHeader>
        <form id="teacher-form" className="grid gap-3 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          <Field label="ФИО" required error={e.fullName?.message} className="sm:col-span-2">
            <Input {...form.register('fullName')} />
          </Field>
          <Field label="Кафедра / ПЦК">
            <Input {...form.register('department')} />
          </Field>
          <Field label="Должность">
            <Input {...form.register('position')} />
          </Field>
          <Field label="E-mail" error={e.email?.message}>
            <Input type="email" {...form.register('email')} />
          </Field>
          <Field label="Телефон">
            <Input {...form.register('phone')} />
          </Field>
          <Field label="Макс. пар в неделю" required error={e.maxWeeklyLessons?.message}>
            <Input type="number" {...form.register('maxWeeklyLessons', { valueAsNumber: true })} />
          </Field>
          <Field label="Макс. пар в день" required error={e.maxDailyLessons?.message}>
            <Input type="number" {...form.register('maxDailyLessons', { valueAsNumber: true })} />
          </Field>
          <Field label="Предпочтительно с пары" error={e.preferredStartLesson?.message}>
            <Input type="number" {...form.register('preferredStartLesson', { valueAsNumber: true })} />
          </Field>
          <Field label="по пару" error={e.preferredEndLesson?.message}>
            <Input type="number" {...form.register('preferredEndLesson', { valueAsNumber: true })} />
          </Field>
          <label className="flex items-center justify-between gap-3 text-sm sm:col-span-2">
            Работает (участвует в составлении расписания)
            <Switch checked={form.watch('isActive')} onCheckedChange={(v) => form.setValue('isActive', v)} />
          </label>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button type="submit" form="teacher-form" disabled={save.isPending}>
            {save.isPending && <Spinner />} Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
