import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { BookOpen, CalendarClock, Plus, Search, Users } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Field } from '@/components/common/field';
import { PageHeader } from '@/components/common/page-header';
import { SimpleSelect } from '@/components/common/simple-select';
import { EmptyState, ErrorState, LoadingState, Spinner } from '@/components/common/states';
import { employmentState, LevelBadges, qualificationLine, teachesAllLevels } from '@/components/teachers/qualification';
import { TeacherPhoto } from '@/components/teachers/teacher-photo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useTeachers } from '@/hooks/use-reference';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { pluralize } from '@/lib/format';
import {
  ACADEMIC_DEGREE_LABELS,
  ACADEMIC_TITLE_LABELS,
  allowedLevelsOf,
  EDUCATION_LEVEL_LABELS,
  TEACHER_EDUCATION_LABELS,
  TEACHER_POSITIONS,
} from '@/lib/labels';
import { useApiMutation } from '@/lib/query';
import type { AcademicDegree, AcademicTitle, EducationLevel, Teacher, TeacherEducation } from '@/lib/types';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Работают' },
  { value: 'inactive', label: 'Не активные' },
  { value: 'all', label: 'Все' },
];

export default function TeachersPage() {
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const teachers = useTeachers();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const [department, setDepartment] = useState<string | null>(null);
  const [status, setStatus] = useState('active');

  const list = useMemo(() => teachers.data ?? [], [teachers.data]);
  const positions = useMemo(() => [...new Set(list.map((t) => t.position || 'Преподаватель'))].sort(), [list]);
  const departments = useMemo(() => [...new Set(list.map((t) => t.department).filter((d): d is string => !!d))].sort(), [list]);
  const q = search.trim().toLowerCase();
  const shown = list.filter(
    (t) =>
      (status === 'all' || t.isActive === (status === 'active')) &&
      (!position || (t.position || 'Преподаватель') === position) &&
      (!department || t.department === department) &&
      (!level || (t.allowedLevels ?? allowedLevelsOf(t)).includes(level as EducationLevel)) &&
      (!q || t.fullName.toLowerCase().includes(q) || (t.disciplines ?? []).some((d) => d.toLowerCase().includes(q))),
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Преподаватели"
        description="Откройте карточку, чтобы увидеть дисциплины, расписание и ограничения."
        actions={
          canEdit && (
            <Button onClick={() => setOpen(true)}>
              <Plus /> Преподаватель
            </Button>
          )
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ФИО или дисциплина…" className="pl-8" />
        </div>
        <SimpleSelect value={position} onChange={setPosition} options={positions.map((p) => ({ value: p, label: p }))} allowEmpty emptyLabel="Все должности" placeholder="Должность" className="w-full sm:w-52" />
        <SimpleSelect
          value={level}
          onChange={setLevel}
          options={Object.entries(EDUCATION_LEVEL_LABELS).map(([value, label]) => ({ value, label: `Может вести: ${label}` }))}
          allowEmpty
          emptyLabel="Любой уровень"
          placeholder="Может вести"
          className="w-full sm:w-56"
        />
        {departments.length > 1 && (
          <SimpleSelect value={department} onChange={setDepartment} options={departments.map((d) => ({ value: d, label: d }))} allowEmpty emptyLabel="Все кафедры и ПЦК" placeholder="Кафедра / ПЦК" className="w-full sm:w-56" />
        )}
        <SimpleSelect value={status} onChange={(v) => setStatus(v ?? 'active')} options={STATUS_OPTIONS} className="w-full sm:w-40" />
        <span className="text-muted-foreground ml-auto text-sm">
          {shown.length} {pluralize(shown.length, 'преподаватель', 'преподавателя', 'преподавателей')}
        </span>
      </div>
      {teachers.isLoading ? (
        <LoadingState rows={6} />
      ) : teachers.error ? (
        <ErrorState error={teachers.error} onRetry={() => teachers.refetch()} />
      ) : shown.length === 0 ? (
        <EmptyState
          title={list.length ? 'Никого не нашлось' : 'Преподавателей пока нет'}
          description={list.length ? 'Измените условия поиска или фильтры.' : 'Добавьте преподавателей — затем распределите нагрузку по дисциплинам.'}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {shown.map((t) => (
            <TeacherTile key={t.id} teacher={t} />
          ))}
        </div>
      )}
      <TeacherDialog open={open} onOpenChange={setOpen} onSaved={(id) => navigate(`/teachers/${id}`)} />
    </div>
  );
}

function TeacherTile({ teacher: t }: { teacher: Teacher }) {
  const state = employmentState(t);
  const disciplines = t.disciplines ?? [];
  const restrictions = (t._count?.availability ?? 0) + (t._count?.availabilityRules ?? 0);
  return (
    <Link
      to={`/teachers/${t.id}`}
      className="lift bg-card focus-visible:ring-ring flex flex-col gap-3 rounded-xl border p-4 outline-none focus-visible:ring-2"
    >
      <div className="flex items-start gap-3">
        <TeacherPhoto teacher={t} />
        <div className="min-w-0 flex-1">
          <div className="leading-tight font-medium">{t.fullName}</div>
          <div className="text-muted-foreground mt-0.5 text-xs">{qualificationLine(t)}</div>
          {t.educationLevel && <div className="text-muted-foreground text-xs">{TEACHER_EDUCATION_LABELS[t.educationLevel]}</div>}
        </div>
        {state.label !== 'Работает' && (
          <Badge variant={state.variant} className="shrink-0">
            {state.label}
          </Badge>
        )}
      </div>
      {/* «Все уровни» — обычный случай, на плитке показываем только ограничения */}
      {!teachesAllLevels(t) && (
        <div className="space-y-1">
          <div className="text-muted-foreground text-xs">Может вести</div>
          <LevelBadges teacher={t} compact />
        </div>
      )}
      <div className="text-sm">
        <div className="flex items-start gap-1.5">
          <BookOpen className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
          {disciplines.length ? (
            <span className="line-clamp-2">
              {disciplines.slice(0, 3).join(', ')}
              {disciplines.length > 3 && <span className="text-muted-foreground"> и ещё {disciplines.length - 3}</span>}
            </span>
          ) : (
            <span className="text-muted-foreground">Дисциплины не назначены</span>
          )}
        </div>
      </div>
      <div className="text-muted-foreground mt-auto flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-xs">
        <span className="inline-flex items-center gap-1">
          <Users className="size-3.5" />
          {t.groupsCount ?? 0} {pluralize(t.groupsCount ?? 0, 'группа', 'группы', 'групп')}
        </span>
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="size-3.5" />
          {restrictions ? `${restrictions} ${pluralize(restrictions, 'ограничение', 'ограничения', 'ограничений')}` : 'без ограничений'}
        </span>
        <span>
          до {t.maxDailyLessons} пар в день, {t.maxWeeklyLessons} в неделю
        </span>
      </div>
    </Link>
  );
}

const LEVELS = Object.keys(EDUCATION_LEVEL_LABELS) as EducationLevel[];
const optionalDate = z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД')]);

const teacherSchema = z
  .object({
    fullName: z.string().trim().min(3, 'Укажите ФИО полностью'),
    department: z.string().optional(),
    position: z.string().optional(),
    email: z.union([z.literal(''), z.string().email('Некорректный e-mail')]).optional(),
    phone: z.string().optional(),
    educationLevel: z.string().nullable(),
    academicDegree: z.string(),
    academicTitle: z.string(),
    manualLevels: z.boolean(),
    teachableLevels: z.array(z.string()),
    employedFrom: optionalDate,
    employedTo: optionalDate,
    maxWeeklyLessons: z.number({ invalid_type_error: 'Введите число' }).int().min(1, 'От 1').max(40, 'До 40'),
    maxDailyLessons: z.number({ invalid_type_error: 'Введите число' }).int().min(1, 'От 1').max(8, 'До 8'),
    preferredStartLesson: z.number({ invalid_type_error: 'Введите число' }).int().min(1).max(8),
    preferredEndLesson: z.number({ invalid_type_error: 'Введите число' }).int().min(1).max(8),
    isActive: z.boolean(),
  })
  .refine((v) => v.preferredStartLesson <= v.preferredEndLesson, {
    message: 'Первая пара не может быть позже последней',
    path: ['preferredEndLesson'],
  })
  .refine((v) => !v.employedFrom || !v.employedTo || v.employedFrom <= v.employedTo, {
    message: 'Дата окончания раньше даты начала',
    path: ['employedTo'],
  })
  .refine((v) => !v.manualLevels || v.teachableLevels.length > 0, {
    message: 'Отметьте хотя бы один уровень',
    path: ['teachableLevels'],
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
          educationLevel: teacher.educationLevel,
          academicDegree: teacher.academicDegree,
          academicTitle: teacher.academicTitle,
          manualLevels: teacher.teachableLevels.length > 0,
          teachableLevels: teacher.teachableLevels,
          employedFrom: teacher.employedFrom?.slice(0, 10) ?? '',
          employedTo: teacher.employedTo?.slice(0, 10) ?? '',
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
          educationLevel: null,
          academicDegree: 'NONE',
          academicTitle: 'NONE',
          manualLevels: false,
          teachableLevels: [],
          employedFrom: '',
          employedTo: '',
          maxWeeklyLessons: 18,
          maxDailyLessons: 4,
          preferredStartLesson: 1,
          preferredEndLesson: 5,
          isActive: true,
        },
  });
  const save = useApiMutation(
    ({ manualLevels, ...v }: TeacherForm) => {
      const body = {
        ...v,
        email: v.email || undefined,
        phone: v.phone || undefined,
        department: v.department || undefined,
        position: v.position || undefined,
        educationLevel: (v.educationLevel as TeacherEducation | null) ?? null,
        academicDegree: v.academicDegree as AcademicDegree,
        academicTitle: v.academicTitle as AcademicTitle,
        teachableLevels: manualLevels ? v.teachableLevels : [],
        employedFrom: v.employedFrom || null,
        employedTo: v.employedTo || null,
      };
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
  const v = form.watch();
  const autoLevels = allowedLevelsOf({ ...v, teachableLevels: [] });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{teacher ? 'Преподаватель' : 'Новый преподаватель'}</DialogTitle>
          <DialogDescription>Образование, учёная степень и звание определяют, у каких групп (СПО, бакалавриат…) преподаватель может вести занятия.</DialogDescription>
        </DialogHeader>
        <form id="teacher-form" className="grid gap-3 sm:grid-cols-2" onSubmit={form.handleSubmit((x) => save.mutate(x))}>
          <Field label="ФИО" required error={e.fullName?.message} className="sm:col-span-2">
            <Input {...form.register('fullName')} />
          </Field>
          <Field label="Должность" hint="Выберите из списка или введите свою">
            <Input list="teacher-positions" {...form.register('position')} />
            <datalist id="teacher-positions">
              {TEACHER_POSITIONS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </Field>
          <Field label="Кафедра / ПЦК">
            <Input {...form.register('department')} />
          </Field>

          <div className="bg-muted/40 grid gap-3 rounded-lg border p-3 sm:col-span-2 sm:grid-cols-3">
            <Field label="Образование">
              <SimpleSelect
                value={v.educationLevel}
                onChange={(x) => form.setValue('educationLevel', x, { shouldDirty: true })}
                options={Object.entries(TEACHER_EDUCATION_LABELS).map(([value, label]) => ({ value, label }))}
                allowEmpty
                emptyLabel="Не указано"
              />
            </Field>
            <Field label="Учёная степень">
              <SimpleSelect
                value={v.academicDegree}
                onChange={(x) => form.setValue('academicDegree', x ?? 'NONE', { shouldDirty: true })}
                options={Object.entries(ACADEMIC_DEGREE_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <Field label="Учёное звание">
              <SimpleSelect
                value={v.academicTitle}
                onChange={(x) => form.setValue('academicTitle', x ?? 'NONE', { shouldDirty: true })}
                options={Object.entries(ACADEMIC_TITLE_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <div className="space-y-2 text-sm sm:col-span-3">
              <div>
                <span className="text-muted-foreground">
                  Может вести {v.academicDegree !== 'NONE' || v.academicTitle !== 'NONE' ? '(есть степень или звание)' : v.educationLevel ? '(по образованию)' : '(образование не указано)'}:{' '}
                </span>
                {autoLevels.map((l) => EDUCATION_LEVEL_LABELS[l]).join(', ')}
              </div>
              <label className="flex items-center gap-2">
                <Checkbox checked={v.manualLevels} onCheckedChange={(x) => form.setValue('manualLevels', x === true, { shouldDirty: true })} />
                Задать уровни вручную (например, по решению учёного совета)
              </label>
              {v.manualLevels && (
                <div className="flex flex-wrap gap-3 pl-6">
                  {LEVELS.map((l) => (
                    <label key={l} className="flex items-center gap-1.5">
                      <Checkbox
                        checked={v.teachableLevels.includes(l)}
                        onCheckedChange={(x) =>
                          form.setValue('teachableLevels', x === true ? [...v.teachableLevels, l] : v.teachableLevels.filter((y) => y !== l), {
                            shouldDirty: true,
                            shouldValidate: true,
                          })
                        }
                      />
                      {EDUCATION_LEVEL_LABELS[l]}
                    </label>
                  ))}
                </div>
              )}
              {e.teachableLevels?.message && <div className="text-destructive text-xs">{e.teachableLevels.message}</div>}
            </div>
          </div>

          <Field label="Работает с" hint="Вышел в середине семестра — раньше этой даты занятия не ставятся" error={e.employedFrom?.message}>
            <Input type="date" {...form.register('employedFrom')} />
          </Field>
          <Field label="Работает по" hint="Увольнение, окончание договора" error={e.employedTo?.message}>
            <Input type="date" {...form.register('employedTo')} />
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
            <Switch checked={v.isActive} onCheckedChange={(x) => form.setValue('isActive', x)} />
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
