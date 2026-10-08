import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { Pencil, UserPlus } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
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
import { Switch } from '@/components/ui/switch';
import { useGroups, useTeachers } from '@/hooks/use-reference';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { ROLE_LABELS } from '@/lib/labels';
import { useApi, useApiMutation } from '@/lib/query';
import type { User, UserRole } from '@/lib/types';

export default function UsersPage() {
  const users = useApi<User[]>(['users'], '/users');
  const [edit, setEdit] = useState<User | null>(null);
  const [create, setCreate] = useState(false);
  const columns: ColumnDef<User>[] = [
    {
      accessorKey: 'fullName',
      header: 'Пользователь',
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.fullName}</div>
          <div className="text-muted-foreground text-xs">{row.original.email}</div>
        </div>
      ),
    },
    { accessorKey: 'role', header: 'Роль', cell: ({ getValue }) => <Badge variant="secondary">{ROLE_LABELS[getValue<string>()]}</Badge> },
    {
      id: 'link',
      header: 'Связь',
      cell: ({ row }) =>
        row.original.teacher ? `Преподаватель: ${row.original.teacher.fullName}` : row.original.studentGroup ? `Группа ${row.original.studentGroup.code}` : '—',
    },
    { accessorKey: 'lastLoginAt', header: 'Последний вход', cell: ({ getValue }) => formatDateTime(getValue<string | null>()) },
    {
      accessorKey: 'isActive',
      header: 'Статус',
      cell: ({ getValue }) => (getValue<boolean>() ? <Badge variant="success">Активен</Badge> : <Badge variant="muted">Заблокирован</Badge>),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <Button variant="ghost" size="icon-sm" onClick={() => setEdit(row.original)} aria-label="Изменить">
          <Pencil />
        </Button>
      ),
    },
  ];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Пользователи"
        description="Учётные записи и роли: администратор, диспетчер, преподаватель, студент, руководитель"
        actions={
          <Button onClick={() => setCreate(true)}>
            <UserPlus /> Пользователь
          </Button>
        }
      />
      {users.isLoading ? (
        <LoadingState rows={6} />
      ) : users.error ? (
        <ErrorState error={users.error} onRetry={() => users.refetch()} />
      ) : (
        <DataTable data={users.data ?? []} columns={columns} searchPlaceholder="Поиск пользователя…" />
      )}
      {(create || edit) && (
        <UserDialog
          user={edit ?? undefined}
          onClose={() => {
            setCreate(false);
            setEdit(null);
          }}
        />
      )}
    </div>
  );
}

const ROLES: UserRole[] = ['ADMIN', 'DISPATCHER', 'TEACHER', 'STUDENT', 'MANAGER'];

const userSchema = z
  .object({
    fullName: z.string().trim().min(3, 'Укажите ФИО'),
    email: z.string().trim().email('Некорректный e-mail'),
    role: z.enum(['ADMIN', 'DISPATCHER', 'TEACHER', 'STUDENT', 'MANAGER']),
    password: z.string().optional(),
    teacherId: z.string().optional(),
    studentGroupId: z.string().optional(),
    isActive: z.boolean(),
    isNew: z.boolean(),
  })
  .refine((v) => !v.isNew || (v.password?.length ?? 0) >= 8, { message: 'Пароль не короче 8 символов', path: ['password'] })
  .refine((v) => !v.password || v.password.length >= 8, { message: 'Пароль не короче 8 символов', path: ['password'] })
  .refine((v) => v.role !== 'TEACHER' || !!v.teacherId, { message: 'Выберите преподавателя', path: ['teacherId'] })
  .refine((v) => v.role !== 'STUDENT' || !!v.studentGroupId, { message: 'Выберите группу', path: ['studentGroupId'] });
type UserForm = z.infer<typeof userSchema>;

function UserDialog({ user, onClose }: { user?: User; onClose: () => void }) {
  const teachers = useTeachers();
  const groups = useGroups();
  const form = useForm<UserForm>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      fullName: user?.fullName ?? '',
      email: user?.email ?? '',
      role: user?.role ?? 'TEACHER',
      password: '',
      teacherId: user?.teacherId ?? undefined,
      studentGroupId: user?.studentGroupId ?? undefined,
      isActive: user?.isActive ?? true,
      isNew: !user,
    },
  });
  const role = form.watch('role');
  const save = useApiMutation(
    (v: UserForm) => {
      const body = {
        fullName: v.fullName,
        email: v.email,
        role: v.role,
        password: v.password || undefined,
        teacherId: v.role === 'TEACHER' ? v.teacherId : null,
        studentGroupId: v.role === 'STUDENT' ? v.studentGroupId : null,
      };
      if (user) return api.patch(`/users/${user.id}`, { ...body, isActive: v.isActive });
      return api.post('/auth/register', {
        ...body,
        teacherId: body.teacherId ?? undefined,
        studentGroupId: body.studentGroupId ?? undefined,
      });
    },
    { success: 'Пользователь сохранён', invalidate: [['users']], onSuccess: onClose },
  );
  const e = form.formState.errors;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{user ? 'Пользователь' : 'Новый пользователь'}</DialogTitle>
        </DialogHeader>
        <form id="user-form" className="grid gap-3" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          <Field label="ФИО" required error={e.fullName?.message}>
            <Input {...form.register('fullName')} />
          </Field>
          <Field label="E-mail (логин)" required error={e.email?.message}>
            <Input type="email" {...form.register('email')} />
          </Field>
          <Field label="Роль" required>
            <Controller
              control={form.control}
              name="role"
              render={({ field }) => (
                <SimpleSelect value={field.value} onChange={(v) => field.onChange(v ?? 'TEACHER')} options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
              )}
            />
          </Field>
          {role === 'TEACHER' && (
            <Field label="Преподаватель" required error={e.teacherId?.message}>
              <Controller
                control={form.control}
                name="teacherId"
                render={({ field }) => (
                  <SimpleSelect
                    value={field.value ?? null}
                    onChange={(v) => field.onChange(v ?? undefined)}
                    options={(teachers.data ?? []).map((t) => ({ value: t.id, label: t.fullName }))}
                  />
                )}
              />
            </Field>
          )}
          {role === 'STUDENT' && (
            <Field label="Группа" required error={e.studentGroupId?.message}>
              <Controller
                control={form.control}
                name="studentGroupId"
                render={({ field }) => (
                  <SimpleSelect
                    value={field.value ?? null}
                    onChange={(v) => field.onChange(v ?? undefined)}
                    options={(groups.data ?? []).map((g) => ({ value: g.id, label: g.code }))}
                  />
                )}
              />
            </Field>
          )}
          <Field label={user ? 'Новый пароль' : 'Пароль'} required={!user} error={e.password?.message} hint={user ? 'Оставьте пустым, чтобы не менять' : 'Не короче 8 символов'}>
            <Input type="password" autoComplete="new-password" {...form.register('password')} />
          </Field>
          {user && (
            <Controller
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <label className="flex items-center justify-between gap-3 text-sm">
                  Учётная запись активна
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </label>
              )}
            />
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" form="user-form" disabled={save.isPending}>
            {save.isPending && <Spinner />} Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
