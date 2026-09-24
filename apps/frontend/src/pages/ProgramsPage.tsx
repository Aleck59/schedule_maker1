import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { BookPlus, Plus } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import { usePrograms } from '@/hooks/use-reference';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PROGRAM_STATUS_LABELS, STUDY_FORM_LABELS } from '@/lib/labels';
import { useApi, useApiMutation } from '@/lib/query';
import type { Program, Specialty } from '@/lib/types';

export default function ProgramsPage() {
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const programs = usePrograms();
  const [open, setOpen] = useState(false);
  const [specialtyOpen, setSpecialtyOpen] = useState(false);

  const columns: ColumnDef<Program>[] = [
    {
      accessorKey: 'title',
      header: 'Учебный план',
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.title}</div>
          <div className="text-muted-foreground text-xs">
            {row.original.specialty.code} {row.original.specialty.name} · {row.original.specialty.qualification}
          </div>
        </div>
      ),
    },
    { accessorKey: 'admissionYear', header: 'Год набора' },
    { accessorKey: 'studyForm', header: 'Форма', cell: ({ getValue }) => STUDY_FORM_LABELS[getValue<string>()] },
    {
      id: 'duration',
      header: 'Срок',
      cell: ({ row }) => `${Math.floor(row.original.durationMonths / 12)} г. ${row.original.durationMonths % 12} мес.`,
    },
    { id: 'semesters', header: 'Семестров', cell: ({ row }) => row.original.totalSemesters },
    { id: 'items', header: 'Элементов', cell: ({ row }) => row.original._count?.items ?? 0 },
    { id: 'groups', header: 'Групп', cell: ({ row }) => row.original._count?.groups ?? 0 },
    {
      id: 'hours',
      header: 'Аудиторных часов',
      cell: ({ row }) => {
        const h = row.original.hours;
        return (
          <span className="tabular-nums" title={`Лекции ${h.lecture}, практ. ${h.practical}, лаб. ${h.laboratory}, конс. ${h.consultation}`}>
            {h.lecture + h.practical + h.laboratory + h.consultation}
          </span>
        );
      },
    },
    {
      accessorKey: 'status',
      header: 'Статус',
      cell: ({ getValue }) => (
        <Badge variant={getValue<string>() === 'APPROVED' ? 'success' : getValue<string>() === 'DRAFT' ? 'muted' : 'secondary'}>
          {PROGRAM_STATUS_LABELS[getValue<string>()]}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Учебные планы"
        description="Образовательные программы СПО: специальность, семестры, дисциплины и часы"
        actions={
          canEdit && (
            <>
              <Button variant="outline" onClick={() => setSpecialtyOpen(true)}>
                <BookPlus /> Специальность
              </Button>
              <Button onClick={() => setOpen(true)}>
                <Plus /> Учебный план
              </Button>
            </>
          )
        }
      />
      {programs.isLoading ? (
        <LoadingState rows={6} />
      ) : programs.error ? (
        <ErrorState error={programs.error} onRetry={() => programs.refetch()} />
      ) : (
        <DataTable data={programs.data ?? []} columns={columns} onRowClick={(p) => navigate(`/programs/${p.id}`)} emptyText="Учебные планы не созданы" />
      )}
      <CreateProgramDialog open={open} onOpenChange={setOpen} onCreated={(id) => navigate(`/programs/${id}`)} />
      <CreateSpecialtyDialog open={specialtyOpen} onOpenChange={setSpecialtyOpen} />
    </div>
  );
}

const programSchema = z.object({
  specialtyId: z.string().min(1, 'Выберите специальность'),
  title: z.string().trim().min(1, 'Укажите название'),
  admissionYear: z.number({ invalid_type_error: 'Введите год' }).int().min(2000, 'Некорректный год').max(2100, 'Некорректный год'),
  studyForm: z.enum(['FULL_TIME', 'PART_TIME', 'EXTRAMURAL']),
  durationMonths: z.number({ invalid_type_error: 'Введите число' }).int().min(1, 'Не менее 1 месяца'),
  totalSemesters: z.number({ invalid_type_error: 'Введите число' }).int().min(1, 'Не менее 1').max(12, 'Не более 12'),
  generateStructure: z.boolean(),
});
type ProgramForm = z.infer<typeof programSchema>;

function CreateProgramDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const specialties = useApi<Specialty[]>(['specialties'], open ? '/specialties' : null);
  const form = useForm<ProgramForm>({
    resolver: zodResolver(programSchema),
    defaultValues: {
      specialtyId: '',
      title: '',
      admissionYear: new Date().getFullYear(),
      studyForm: 'FULL_TIME',
      durationMonths: 46,
      totalSemesters: 8,
      generateStructure: true,
    },
  });
  const create = useApiMutation((v: ProgramForm) => api.post<Program>('/programs', v), {
    success: 'Учебный план создан',
    invalidate: [['programs'], ['semesters']],
    onSuccess: (p) => {
      onOpenChange(false);
      form.reset();
      onCreated(p.id);
    },
  });
  const e = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Новый учебный план</DialogTitle>
        </DialogHeader>
        <form id="program-form" className="grid gap-3 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => create.mutate(v))}>
          <Field label="Специальность" required error={e.specialtyId?.message} className="sm:col-span-2">
            <Controller
              control={form.control}
              name="specialtyId"
              render={({ field }) => (
                <SimpleSelect
                  value={field.value || null}
                  onChange={(v) => {
                    field.onChange(v ?? '');
                    const s = specialties.data?.find((x) => x.id === v);
                    if (s) {
                      form.setValue('durationMonths', s.durationMonths);
                      if (!form.getValues('title')) form.setValue('title', `${s.code} ${s.name} (набор ${form.getValues('admissionYear')})`);
                    }
                  }}
                  options={(specialties.data ?? []).map((s) => ({ value: s.id, label: `${s.code} ${s.name}` }))}
                />
              )}
            />
          </Field>
          <Field label="Название" required error={e.title?.message} className="sm:col-span-2">
            <Input {...form.register('title')} />
          </Field>
          <Field label="Год набора" required error={e.admissionYear?.message}>
            <Input type="number" {...form.register('admissionYear', { valueAsNumber: true })} />
          </Field>
          <Field label="Форма обучения">
            <Controller
              control={form.control}
              name="studyForm"
              render={({ field }) => (
                <SimpleSelect
                  value={field.value}
                  onChange={(v) => field.onChange(v ?? 'FULL_TIME')}
                  options={Object.entries(STUDY_FORM_LABELS).map(([value, label]) => ({ value, label }))}
                />
              )}
            />
          </Field>
          <Field label="Срок обучения, мес." required error={e.durationMonths?.message} hint="3 г. 10 мес. = 46">
            <Input type="number" {...form.register('durationMonths', { valueAsNumber: true })} />
          </Field>
          <Field label="Количество семестров" required error={e.totalSemesters?.message}>
            <Input type="number" {...form.register('totalSemesters', { valueAsNumber: true })} />
          </Field>
          <Controller
            control={form.control}
            name="generateStructure"
            render={({ field }) => (
              <label className="flex items-center justify-between gap-3 text-sm sm:col-span-2">
                Создать учебные годы и семестры автоматически (сентябрь–декабрь, январь–июнь)
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </label>
            )}
          />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button type="submit" form="program-form" disabled={create.isPending}>
            {create.isPending && <Spinner />} Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const specialtySchema = z.object({
  code: z.string().trim().regex(/^\d{2}\.\d{2}\.\d{2}$/, 'Код в формате 09.02.07'),
  name: z.string().trim().min(1, 'Укажите наименование'),
  qualification: z.string().trim().min(1, 'Укажите квалификацию'),
  fgosNumber: z.string().optional(),
  durationMonths: z.number({ invalid_type_error: 'Введите число' }).int().min(1, 'Не менее 1 месяца'),
});
type SpecialtyForm = z.infer<typeof specialtySchema>;

function CreateSpecialtyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const form = useForm<SpecialtyForm>({
    resolver: zodResolver(specialtySchema),
    defaultValues: { code: '', name: '', qualification: '', durationMonths: 46 },
  });
  const create = useApiMutation((v: SpecialtyForm) => api.post('/specialties', { ...v, fgosNumber: v.fgosNumber || undefined }), {
    success: 'Специальность добавлена',
    invalidate: [['specialties']],
    onSuccess: () => {
      onOpenChange(false);
      form.reset();
    },
  });
  const e = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новая специальность</DialogTitle>
        </DialogHeader>
        <form id="specialty-form" className="grid gap-3" onSubmit={form.handleSubmit((v) => create.mutate(v))}>
          <Field label="Код" required error={e.code?.message}>
            <Input placeholder="09.02.07" {...form.register('code')} />
          </Field>
          <Field label="Наименование" required error={e.name?.message}>
            <Input {...form.register('name')} />
          </Field>
          <Field label="Квалификация" required error={e.qualification?.message}>
            <Input {...form.register('qualification')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Приказ ФГОС">
              <Input {...form.register('fgosNumber')} />
            </Field>
            <Field label="Срок, мес." required error={e.durationMonths?.message}>
              <Input type="number" {...form.register('durationMonths', { valueAsNumber: true })} />
            </Field>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button type="submit" form="specialty-form" disabled={create.isPending}>
            {create.isPending && <Spinner />} Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
