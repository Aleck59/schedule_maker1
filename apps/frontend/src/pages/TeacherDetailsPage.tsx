import { useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRightLeft, Camera, Download, Mail, Pencil, Phone, Trash2, X } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AvailabilityEditor } from '@/components/common/availability-editor';
import { AvailabilityRules } from '@/components/common/availability-rules';
import { Confirm } from '@/components/common/confirm';
import { EmptyState, ErrorState, LoadingState, Spinner } from '@/components/common/states';
import { StatCard } from '@/components/common/stat-card';
import { HourStatusBadge } from '@/components/common/status-badge';
import { EntityWeekSchedule } from '@/components/schedule/entity-week-schedule';
import { HandoverDialog, type HandoverTarget } from '@/components/teachers/handover-dialog';
import { employmentState, LevelBadges, qualificationLine } from '@/components/teachers/qualification';
import { TeacherAbsences } from '@/components/teachers/teacher-absences';
import { TeacherPhoto } from '@/components/teachers/teacher-photo';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePeriods } from '@/hooks/use-reference';
import { api, downloadFile, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateShort, pluralize } from '@/lib/format';
import { ACADEMIC_DEGREE_LABELS, ACADEMIC_TITLE_LABELS, EDUCATION_LEVEL_LABELS, LESSON_TYPE_LABELS, TEACHER_EDUCATION_LABELS } from '@/lib/labels';
import { useApi, useApiMutation } from '@/lib/query';
import type { HourControlRow, Teacher, TeacherAssignment } from '@/lib/types';
import { TeacherDialog } from './TeachersPage';

interface Workload {
  teacher: { id: string; fullName: string; maxWeeklyLessons: number; maxDailyLessons: number };
  planned: { total: number; byType: Record<string, number>; handedOverHours?: number; previousHours?: number };
  scheduled: { total: number; byType: Record<string, number> };
  conducted: { total: number; byType: Record<string, number>; substitutedHours: number };
  remaining: number;
  currentWeek: { from: string; to: string; lessons: number; limit: number; overload: boolean };
  weeks: Array<{ week: string; lessons: number; overload: boolean }>;
  overloadWeeks: number;
  rows: HourControlRow[];
}

export default function TeacherDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const teacher = useApi<Teacher>(['teacher', id], `/teachers/${id}`);
  const workload = useApi<Workload>(['teacher-workload', id], `/teachers/${id}/workload`);
  const periods = usePeriods();
  const [edit, setEdit] = useState(false);
  const [handover, setHandover] = useState<HandoverTarget | null>(null);
  const [tab, setTab] = useState('disciplines');
  const remove = useApiMutation(() => api.delete(`/teachers/${id}`), {
    success: 'Преподаватель удалён',
    invalidate: [['teachers']],
    onSuccess: () => navigate('/teachers'),
  });
  if (teacher.isLoading) return <LoadingState rows={8} />;
  if (teacher.error)
    return <ErrorState error={teacher.error} onRetry={() => teacher.refetch()} back={{ to: '/teachers', label: 'К преподавателям' }} />;
  const t = teacher.data!;
  const w = workload.data;
  const period = (periods.data ?? []).find((p) => p.status !== 'ARCHIVED');

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link to="/teachers">
          <ArrowLeft /> Преподаватели
        </Link>
      </Button>
      <TeacherHeader
        teacher={t}
        canEdit={canEdit}
        actions={
          <>
            {period && (
              <Button
                variant="outline"
                onClick={() =>
                  downloadFile(`/schedule-periods/${period.id}/export/teacher/${t.id}/pdf`, undefined, 'Расписание.pdf').catch((e) => toast.error(errorMessage(e)))
                }
              >
                <Download /> PDF расписания
              </Button>
            )}
            {canEdit && (
              <>
                <Button variant="outline" onClick={() => setEdit(true)}>
                  <Pencil /> Изменить
                </Button>
                <Confirm
                  trigger={
                    <Button variant="ghost" size="icon" aria-label="Удалить">
                      <Trash2 />
                    </Button>
                  }
                  title="Удалить преподавателя?"
                  description="Преподавателя с занятиями в расписании удалить нельзя — отметьте его как неактивного."
                  destructive
                  confirmText="Удалить"
                  onConfirm={() => remove.mutate(undefined)}
                />
              </>
            )}
          </>
        }
      />
      {!!t.lessonsOutsideEmployment && (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>Занятия вне периода работы: {t.lessonsOutsideEmployment}</AlertTitle>
          <AlertDescription>
            Преподаватель работает {t.employedFrom ? `с ${formatDate(t.employedFrom)}` : ''} {t.employedTo ? `по ${formatDate(t.employedTo)}` : ''}. Передайте нагрузку
            другому преподавателю с нужной даты (вкладка «Дисциплины» → «Передать») или пересоставьте расписание.
          </AlertDescription>
        </Alert>
      )}
      {w && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard
            title="Плановая нагрузка"
            value={`${w.planned.total} ч`}
            hint={
              [
                w.planned.handedOverHours ? `без ${w.planned.handedOverHours} ч, которые вёл другой преподаватель` : null,
                w.planned.previousHours ? `в т. ч. ${w.planned.previousHours} ч по переданным дисциплинам` : null,
              ]
                .filter(Boolean)
                .join('; ') || undefined
            }
          />
          <StatCard title="В расписании" value={`${w.scheduled.total} ч`} tone="info" />
          <StatCard
            title="Проведено"
            value={`${w.conducted.total} ч`}
            hint={w.conducted.substitutedHours ? `в т. ч. замены: ${w.conducted.substitutedHours} ч` : undefined}
            tone="success"
          />
          <StatCard title="Осталось" value={`${w.remaining} ч`} />
          <StatCard
            title="Пар на этой неделе"
            value={`${w.currentWeek.lessons} / ${w.currentWeek.limit}`}
            hint={`Недель с перегрузкой: ${w.overloadWeeks}`}
            tone={w.currentWeek.overload || w.overloadWeeks ? 'danger' : 'success'}
          />
        </div>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="disciplines">Дисциплины</TabsTrigger>
          <TabsTrigger value="schedule">Расписание</TabsTrigger>
          <TabsTrigger value="restrictions">Ограничения</TabsTrigger>
          <TabsTrigger value="workload">Нагрузка</TabsTrigger>
        </TabsList>
        <TabsContent value="disciplines">
          <DisciplinesTab teacher={t} rows={w?.rows ?? []} canEdit={canEdit} onHandover={setHandover} />
        </TabsContent>
        <TabsContent value="schedule">
          <EntityWeekSchedule filter={{ teacherId: t.id }} mode="teacher" />
        </TabsContent>
        <TabsContent value="restrictions">
          <RestrictionsTab teacher={t} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="workload" className="space-y-4">
          {!w ? <LoadingState rows={5} /> : <WorkloadTab workload={w} />}
        </TabsContent>
      </Tabs>
      <TeacherDialog open={edit} onOpenChange={setEdit} teacher={t} />
      <HandoverDialog target={handover} onOpenChange={(o) => !o && setHandover(null)} />
    </div>
  );
}

function TeacherHeader({ teacher: t, canEdit, actions }: { teacher: Teacher; canEdit: boolean; actions: React.ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  const state = employmentState(t);
  const upload = useApiMutation((file: File) => api.upload(`/teachers/${t.id}/photo`, file), {
    success: 'Фотография загружена',
    invalidate: [['teacher'], ['teachers']],
  });
  const removePhoto = useApiMutation(() => api.delete(`/teachers/${t.id}/photo`), {
    success: 'Фотография удалена',
    invalidate: [['teacher'], ['teachers']],
  });
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="relative self-start">
          <TeacherPhoto teacher={t} className="size-24 text-2xl" />
          {canEdit && (
            <>
              <input
                ref={input}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) upload.mutate(file);
                  e.target.value = '';
                }}
              />
              <Button
                variant="secondary"
                size="icon-sm"
                className="absolute -right-1 -bottom-1 rounded-full shadow"
                aria-label="Загрузить фотографию"
                title="Загрузить фотографию (JPEG, PNG, WebP до 3 МБ)"
                onClick={() => input.current?.click()}
                disabled={upload.isPending}
              >
                {upload.isPending ? <Spinner /> : <Camera />}
              </Button>
              {t.photoUpdatedAt && (
                <Button
                  variant="secondary"
                  size="icon-sm"
                  className="absolute -top-1 -right-1 rounded-full shadow"
                  aria-label="Удалить фотографию"
                  title="Удалить фотографию"
                  onClick={() => removePhoto.mutate(undefined)}
                >
                  <X />
                </Button>
              )}
            </>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{t.fullName}</h1>
            <Badge variant={state.variant}>{state.label}</Badge>
          </div>
          <div className="text-muted-foreground text-sm">
            {qualificationLine(t)}
            {t.department && ` · ${t.department}`}
          </div>
          {t.educationLevel && <div className="text-sm">Образование: {TEACHER_EDUCATION_LABELS[t.educationLevel]?.toLowerCase()}</div>}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Может вести:</span>
            <LevelBadges teacher={t} compact />
          </div>
          <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {t.email && (
              <a href={`mailto:${t.email}`} className="hover:text-foreground inline-flex items-center gap-1">
                <Mail className="size-3.5" /> {t.email}
              </a>
            )}
            {t.phone && (
              <span className="inline-flex items-center gap-1">
                <Phone className="size-3.5" /> {t.phone}
              </span>
            )}
            {t.user && <span>Учётная запись: {t.user.email}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">{actions}</div>
      </CardContent>
    </Card>
  );
}

function DisciplinesTab({
  teacher,
  rows,
  canEdit,
  onHandover,
}: {
  teacher: Teacher;
  rows: HourControlRow[];
  canEdit: boolean;
  onHandover: (target: HandoverTarget) => void;
}) {
  const assignments = teacher.assignments ?? [];
  if (!assignments.length) {
    return (
      <EmptyState
        title="Дисциплины не назначены"
        description={
          <>
            Назначьте преподавателя на дисциплины групп в разделе{' '}
            <Link to="/workload" className="underline">
              «Нагрузка»
            </Link>
            .
          </>
        }
      />
    );
  }
  // Одна и та же дисциплина в разных учебных планах (СПО и ВО) — одной карточкой
  const byItem = new Map<string, TeacherAssignment[]>();
  for (const a of assignments) {
    const key = a.semesterItem.curriculumItem.name.trim().toLowerCase();
    byItem.set(key, [...(byItem.get(key) ?? []), a]);
  }
  const items = [...byItem.values()]
    .map((list) => list.sort((a, b) => a.group.code.localeCompare(b.group.code)))
    .sort((a, b) => a[0]!.semesterItem.curriculumItem.name.localeCompare(b[0]!.semesterItem.curriculumItem.name));
  const groupsCount = new Set(assignments.map((a) => a.group.code)).size;
  const rowOf = (a: TeacherAssignment) =>
    rows.find(
      (r) =>
        r.groupCode === a.group.code &&
        r.semesterItemId === a.semesterCurriculumItemId &&
        (a.subgroupNumber === null || r.subgroupNumber === a.subgroupNumber),
    );
  const hours = (r: HourControlRow | undefined, a: TeacherAssignment, k: 'planned' | 'scheduled' | 'conducted') => {
    if (!r) return 0;
    if (a.lessonType) return r.byType[a.lessonType]?.[k] ?? 0;
    return Object.values(r.byType).reduce((s, h) => s + (h?.[k] ?? 0), 0);
  };
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        {items.length} {pluralize(items.length, 'дисциплина', 'дисциплины', 'дисциплин')}, {groupsCount} {pluralize(groupsCount, 'группа', 'группы', 'групп')}. Если преподаватель уходит или его меняют с определённой даты — «Передать»:
        прошедшие занятия останутся за ним, будущие перейдут к новому.
      </p>
      {items.map((list) => {
        const ci = list[0]!.semesterItem.curriculumItem;
        const planned = list.reduce((sum, a) => sum + hours(rowOf(a), a, 'planned'), 0);
        return (
          <Card key={ci.id} className="gap-2 py-4">
            <CardHeader className="flex flex-row items-baseline justify-between gap-2 px-4">
              <CardTitle className="text-base">{ci.name}</CardTitle>
              <span className="text-muted-foreground shrink-0 text-sm">
                {list.length} {pluralize(list.length, 'группа', 'группы', 'групп')} · {planned} ч
              </span>
            </CardHeader>
            <CardContent className="px-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Группа</TableHead>
                    <TableHead>Индекс</TableHead>
                    <TableHead>Уровень</TableHead>
                    <TableHead>Семестр</TableHead>
                    <TableHead>Занятия</TableHead>
                    <TableHead className="text-right">План, ч</TableHead>
                    <TableHead className="text-right">В расп.</TableHead>
                    <TableHead className="text-right">Проведено</TableHead>
                    <TableHead>Статус</TableHead>
                    {canEdit && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((a) => {
                    const r = rowOf(a);
                    const level = a.group.program?.specialty.educationLevel ?? null;
                    return (
                      <TableRow key={a.id}>
                        <TableCell>
                          <Link to={`/groups/${a.group.id}`} className="font-medium hover:underline">
                            {a.group.code}
                          </Link>
                          {a.subgroupNumber ? ` п/г ${a.subgroupNumber}` : ''}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">{a.semesterItem.curriculumItem.code}</TableCell>
                        <TableCell>{level ? <Badge variant="muted">{EDUCATION_LEVEL_LABELS[level]}</Badge> : '—'}</TableCell>
                        <TableCell>{a.semesterItem.semester.number}</TableCell>
                        <TableCell className="text-xs">{a.lessonType ? LESSON_TYPE_LABELS[a.lessonType] : 'все виды'}</TableCell>
                        <TableCell className="text-right tabular-nums">{hours(r, a, 'planned')}</TableCell>
                        <TableCell className="text-right tabular-nums">{hours(r, a, 'scheduled')}</TableCell>
                        <TableCell className="text-right tabular-nums">{hours(r, a, 'conducted')}</TableCell>
                        <TableCell>{r ? <HourStatusBadge status={r.status} /> : '—'}</TableCell>
                        {canEdit && (
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                onHandover({
                                  assignmentId: a.id,
                                  title: `${a.semesterItem.curriculumItem.code} ${ci.name}`,
                                  groupCode: a.group.code,
                                  level,
                                  currentTeacherId: teacher.id,
                                })
                              }
                            >
                              <ArrowRightLeft /> Передать
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function RestrictionsTab({ teacher: t, canEdit }: { teacher: Teacher; canEdit: boolean }) {
  const state = employmentState(t);
  const levelsReason = t.teachableLevels.length
    ? 'Уровни заданы вручную.'
    : t.academicDegree !== 'NONE' || t.academicTitle !== 'NONE'
      ? `Есть ${t.academicDegree !== 'NONE' ? `учёная степень (${ACADEMIC_DEGREE_LABELS[t.academicDegree]?.toLowerCase()})` : `учёное звание (${ACADEMIC_TITLE_LABELS[t.academicTitle]?.toLowerCase()})`} — может вести у всех уровней.`
      : t.educationLevel
        ? `По образованию: ${TEACHER_EDUCATION_LABELS[t.educationLevel]?.toLowerCase()}. Бакалавр ведёт только СПО, магистр — СПО и бакалавриат, специалист — также специалитет.`
        : 'Образование не указано — ограничений по уровню нет.';
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>У кого может вести занятия</CardTitle>
          <CardDescription>{levelsReason}</CardDescription>
        </CardHeader>
        <CardContent>
          <LevelBadges teacher={t} />
          <p className="text-muted-foreground mt-2 text-xs">Назначить преподавателя к группе другого уровня нельзя, генератор и проверка расписания это учитывают.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Период работы</CardTitle>
          <CardDescription>
            {t.employedFrom || t.employedTo
              ? `Работает ${t.employedFrom ? `с ${formatDate(t.employedFrom)}` : ''} ${t.employedTo ? `по ${formatDate(t.employedTo)}` : ''}. Вне этого периода занятия не ставятся.`
              : 'Без ограничений. Если преподаватель выходит в середине семестра или увольняется — укажите даты в «Изменить».'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <Badge variant={state.variant}>{state.label}</Badge>
          <div>
            Не больше <b>{t.maxDailyLessons}</b> пар в день и <b>{t.maxWeeklyLessons}</b> в неделю; предпочтительно с {t.preferredStartLesson} по {t.preferredEndLesson} пару.
          </div>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Когда может и не может: правила</CardTitle>
          <CardDescription>Дни недели и пары или время, чётные и нечётные недели, недели месяца («последняя суббота»), онлайн-занятия и период действия.</CardDescription>
        </CardHeader>
        <CardContent>
          <AvailabilityRules teacherId={t.id} editable={canEdit} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Отпуск, курсы, больничный</CardTitle>
          <CardDescription>Даты, в которые преподаватель отсутствует.</CardDescription>
        </CardHeader>
        <CardContent>
          <TeacherAbsences teacherId={t.id} editable={canEdit} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Сетка: дни недели × пары</CardTitle>
          <CardDescription>Постоянные недоступные и желательные пары. Недоступные — жёсткое ограничение генератора.</CardDescription>
        </CardHeader>
        <CardContent>
          <AvailabilityEditor path={`/teachers/${t.id}/availability`} editable={canEdit} invalidateKey={['teacher', t.id]} />
        </CardContent>
      </Card>
    </div>
  );
}

function WorkloadTab({ workload: w }: { workload: Workload }) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Пары по неделям</CardTitle>
          <CardDescription>Красная линия — недельный лимит ({w.teacher.maxWeeklyLessons} пар)</CardDescription>
        </CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer>
            <BarChart data={w.weeks.map((x) => ({ ...x, label: formatDateShort(x.week) }))}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} width={30} />
              <Tooltip formatter={(v) => [v, 'Пар']} />
              <ReferenceLine y={w.teacher.maxWeeklyLessons} stroke="#ef4444" strokeDasharray="4 4" />
              <Bar dataKey="lessons" fill="var(--primary)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>По видам занятий</CardTitle>
          {(w.planned.handedOverHours || w.planned.previousHours) && (
            <CardDescription>
              План учитывает смену преподавателя в семестре:
              {w.planned.handedOverHours ? ` ${w.planned.handedOverHours} ч провёл (ведёт) другой преподаватель;` : ''}
              {w.planned.previousHours ? ` ${w.planned.previousHours} ч — по дисциплинам, переданным другому.` : ''}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Вид</TableHead>
                <TableHead className="text-right">План</TableHead>
                <TableHead className="text-right">В расписании</TableHead>
                <TableHead className="text-right">Проведено</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.keys({ ...w.planned.byType, ...w.scheduled.byType, ...w.conducted.byType }).map((type) => (
                <TableRow key={type}>
                  <TableCell>{LESSON_TYPE_LABELS[type]}</TableCell>
                  <TableCell className="text-right tabular-nums">{w.planned.byType[type] ?? 0}</TableCell>
                  <TableCell className="text-right tabular-nums">{w.scheduled.byType[type] ?? 0}</TableCell>
                  <TableCell className="text-right tabular-nums">{w.conducted.byType[type] ?? 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
