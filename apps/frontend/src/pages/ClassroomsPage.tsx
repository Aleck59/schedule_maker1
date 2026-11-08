import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { Flame, Plus } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
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
import { Textarea } from '@/components/ui/textarea';
import { useClassrooms } from '@/hooks/use-reference';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { pluralize } from '@/lib/format';
import { CLASSROOM_TYPE_LABELS } from '@/lib/labels';
import { useApiMutation } from '@/lib/query';
import type { Classroom } from '@/lib/types';
import { cn } from '@/lib/utils';

function splitTags(value: string | undefined): string[] {
  return [...new Set((value ?? '').split(/[,;\n]/).map((t) => t.trim()).filter(Boolean))];
}

function TagPreview({ value }: { value: string | undefined }) {
  const tags = splitTags(value);
  if (tags.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {tags.map((t) => (
        <Badge key={t} variant="secondary" className="font-normal">
          {t}
        </Badge>
      ))}
    </div>
  );
}

function equipmentText(e: Record<string, unknown> | null): string {
  if (!e) return '';
  return Object.entries(e)
    .map(([k, v]) => (typeof v === 'boolean' ? (v ? k : '') : `${k}: ${String(v)}`))
    .filter(Boolean)
    .join(', ');
}

/** Для таблицы: примечание («note») — без служебного ключа */
function equipmentDisplay(e: Record<string, unknown> | null): string {
  if (!e) return '';
  return Object.entries(e)
    .map(([k, v]) => (k === 'note' ? String(v) : typeof v === 'boolean' ? (v ? k : '') : `${k}: ${String(v)}`))
    .filter(Boolean)
    .join(', ');
}

export default function ClassroomsPage() {
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const classrooms = useClassrooms();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string | null>(null);
  const columns: ColumnDef<Classroom>[] = [
    {
      accessorKey: 'code',
      header: 'Аудитория',
      cell: ({ row }) => (
        <div>
          <div className="font-semibold">{row.original.code}</div>
          <div className="text-muted-foreground text-xs">{row.original.name}</div>
        </div>
      ),
    },
    { accessorKey: 'classroomType', header: 'Тип', cell: ({ getValue }) => <Badge variant="secondary">{CLASSROOM_TYPE_LABELS[getValue<string>()]}</Badge> },
    {
      id: 'tags',
      header: 'Метки',
      cell: ({ row }) =>
        row.original.tags?.length ? (
          <div className="flex max-w-56 flex-wrap gap-1">
            {row.original.tags.map((t) => (
              <Badge key={t} variant="outline" className="font-normal">
                {t}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { accessorKey: 'capacity', header: 'Мест' },
    {
      id: 'location',
      header: 'Корпус / этаж',
      cell: ({ row }) => [row.original.building, row.original.floor ? `${row.original.floor} эт.` : null].filter(Boolean).join(', ') || '—',
    },
    {
      id: 'equipment',
      header: 'Оборудование',
      cell: ({ row }) => <span className="text-muted-foreground text-xs">{equipmentDisplay(row.original.equipmentJson) || '—'}</span>,
    },
    {
      id: 'status',
      header: 'Статус',
      accessorFn: (c) => (!c.isActive ? 2 : c.unavailableSlots ? 1 : 0),
      cell: ({ row }) => <ClassroomStatus classroom={row.original} />,
    },
  ];
  const data = (classrooms.data ?? []).filter((c) => !type || c.classroomType === type);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Аудиторный фонд"
        description="Аудитории, лаборатории, компьютерные классы и спортивные залы"
        actions={
          <>
            <Button
              variant="outline"
              asChild
              className="border-orange-200 bg-orange-100 text-orange-800 hover:border-orange-300 hover:bg-orange-200 hover:text-orange-900 dark:border-orange-400/25 dark:bg-orange-400/15 dark:text-orange-200 dark:hover:bg-orange-400/25"
            >
              <Link to="/classrooms/heatmap">
                <Flame /> Тепловая карта
              </Link>
            </Button>
            {canEdit && (
              <Button onClick={() => setOpen(true)}>
                <Plus /> Аудитория
              </Button>
            )}
          </>
        }
      />
      {classrooms.isLoading ? (
        <LoadingState rows={6} />
      ) : classrooms.error ? (
        <ErrorState error={classrooms.error} onRetry={() => classrooms.refetch()} />
      ) : (
        <DataTable
          data={data}
          columns={columns}
          onRowClick={(c) => navigate(`/classrooms/${c.id}`)}
          searchPlaceholder="Поиск аудитории…"
          toolbar={
            <div className="w-56">
              <SimpleSelect
                value={type}
                onChange={setType}
                allowEmpty
                emptyLabel="Все типы"
                options={Object.entries(CLASSROOM_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </div>
          }
        />
      )}
      <ClassroomDialog open={open} onOpenChange={setOpen} onSaved={(id) => navigate(`/classrooms/${id}`)} />
    </div>
  );
}

const STATUS_STYLE = {
  free: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300',
  partial: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-400/15 dark:text-yellow-300',
  off: 'bg-red-100 text-red-700 dark:bg-red-400/15 dark:text-red-300',
} as const;
const STATUS_DOT = { free: 'bg-emerald-500', partial: 'bg-yellow-600', off: 'bg-red-500' } as const;

/** Статус аудитории: доступна (зелёный), частично занята (тёмно-жёлтый), недоступна (красный) */
function ClassroomStatus({ classroom: c }: { classroom: Classroom }) {
  const kind = !c.isActive ? 'off' : c.unavailableSlots ? 'partial' : 'free';
  const label = kind === 'off' ? 'недоступна' : kind === 'partial' ? 'частично занята' : 'доступна';
  const title =
    kind === 'off'
      ? 'Не используется для занятий'
      : kind === 'partial'
        ? `Недоступна ${c.unavailableSlots} ${pluralize(c.unavailableSlots ?? 0, 'пару', 'пары', 'пар')} в неделю`
        : 'Доступна для занятий без ограничений';
  return (
    <span title={title} className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', STATUS_STYLE[kind])}>
      <span className={cn('size-1.5 rounded-full', STATUS_DOT[kind])} />
      {label}
    </span>
  );
}

const classroomSchema = z.object({
  code: z.string().trim().min(1, 'Укажите номер аудитории'),
  name: z.string().trim().min(1, 'Укажите наименование'),
  building: z.string().optional(),
  floor: z.number({ invalid_type_error: 'Введите число' }).int('Введите целое число').min(-2).max(50).optional(),
  capacity: z.number({ invalid_type_error: 'Введите число' }).int().min(1, 'Не менее 1 места').max(500, 'Не более 500'),
  classroomType: z.string().min(1, 'Выберите тип'),
  equipment: z.string().optional(),
  tags: z.string().optional(),
  isActive: z.boolean(),
});
type ClassroomForm = z.infer<typeof classroomSchema>;

export function ClassroomDialog({
  open,
  onOpenChange,
  classroom,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  classroom?: Classroom;
  onSaved?: (id: string) => void;
}) {
  const form = useForm<ClassroomForm>({
    resolver: zodResolver(classroomSchema),
    values: classroom
      ? {
          code: classroom.code,
          name: classroom.name,
          building: classroom.building ?? '',
          floor: classroom.floor ?? undefined,
          capacity: classroom.capacity,
          classroomType: classroom.classroomType,
          equipment: equipmentText(classroom.equipmentJson),
          tags: (classroom.tags ?? []).join(', '),
          isActive: classroom.isActive,
        }
      : { code: '', name: '', building: 'Главный корпус', capacity: 30, classroomType: 'GENERAL', equipment: '', tags: '', isActive: true },
  });
  const save = useApiMutation(
    (v: ClassroomForm) => {
      const equipmentJson = v.equipment
        ? Object.fromEntries(
            v.equipment
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .map((s) => {
                const [k, val] = s.split(':').map((x) => x.trim());
                return [k, val === undefined ? true : Number.isNaN(Number(val)) ? val : Number(val)];
              }),
          )
        : undefined;
      const body = {
        code: v.code,
        name: v.name,
        building: v.building || undefined,
        floor: v.floor,
        capacity: v.capacity,
        classroomType: v.classroomType,
        equipmentJson,
        tags: splitTags(v.tags),
        isActive: v.isActive,
      };
      return classroom ? api.patch<Classroom>(`/classrooms/${classroom.id}`, body) : api.post<Classroom>('/classrooms', body);
    },
    {
      success: 'Аудитория сохранена',
      invalidate: [['classrooms'], ['classroom']],
      onSuccess: (c) => {
        onOpenChange(false);
        onSaved?.(c.id);
      },
    },
  );
  const e = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{classroom ? `Аудитория ${classroom.code}` : 'Новая аудитория'}</DialogTitle>
        </DialogHeader>
        <form id="classroom-form" className="grid gap-3 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          <Field label="Номер" required error={e.code?.message}>
            <Input {...form.register('code')} />
          </Field>
          <Field label="Тип" required error={e.classroomType?.message}>
            <Controller
              control={form.control}
              name="classroomType"
              render={({ field }) => (
                <SimpleSelect
                  value={field.value}
                  onChange={(v) => field.onChange(v ?? '')}
                  options={Object.entries(CLASSROOM_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
                />
              )}
            />
          </Field>
          <Field label="Наименование" required error={e.name?.message} className="sm:col-span-2">
            <Input {...form.register('name')} />
          </Field>
          <Field label="Корпус">
            <Input {...form.register('building')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Этаж" error={e.floor?.message}>
              <Input type="number" {...form.register('floor', { setValueAs: (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)) })} />
            </Field>
            <Field label="Мест" required error={e.capacity?.message}>
              <Input type="number" {...form.register('capacity', { valueAsNumber: true })} />
            </Field>
          </div>
          <Field label="Оборудование" hint="Через запятую, например: компьютеры: 25, проектор" className="sm:col-span-2">
            <Textarea rows={2} {...form.register('equipment')} />
          </Field>
          <Field
            label="Метки: что предпочтительно проводить"
            hint="Через запятую: дисциплина, часть названия или код — «Иностранный язык», «право», «ОП.05». Пары этих дисциплин ставятся сюда в первую очередь (мягкое ограничение), «Сформировать по плану» подставляет аудиторию в нагрузку. Спортзал без меток — для физической культуры"
            className="sm:col-span-2"
          >
            <Input placeholder="Например: Иностранный язык, английский" {...form.register('tags')} />
            <TagPreview value={form.watch('tags')} />
          </Field>
          <label className="flex items-center justify-between gap-3 text-sm sm:col-span-2">
            Используется для занятий
            <Switch checked={form.watch('isActive')} onCheckedChange={(v) => form.setValue('isActive', v)} />
          </label>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button type="submit" form="classroom-form" disabled={save.isPending}>
            {save.isPending && <Spinner />} Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
