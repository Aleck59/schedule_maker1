import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { Field } from '@/components/common/field';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState, LoadingState, Spinner } from '@/components/common/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSettings } from '@/hooks/use-reference';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { WEEKDAYS } from '@/lib/labels';
import { useApi, useApiMutation } from '@/lib/query';
import type { LessonTime, Settings } from '@/lib/types';

const NUMERIC: Array<[keyof Settings, string, string?]> = [
  ['academicHourMinutes', 'Длительность академического часа, мин'],
  ['academicHoursPerLesson', 'Академических часов в паре'],
  ['lessonDurationMinutes', 'Длительность пары, мин'],
  ['lessonsPerDay', 'Пар в день (сетка звонков)'],
  ['maxGroupLessonsPerDay', 'Макс. пар у группы в день'],
  ['maxSameDisciplinePerDay', 'Макс. пар одной дисциплины в день'],
  ['maxSameDisciplinePerWeek', 'Макс. пар одной дисциплины в неделю'],
  ['lateLessonNumber', 'Поздняя пара начинается с №', 'Пары с этим номером и позже считаются поздними'],
  ['maxGroupWindowsPerWeek', 'Допустимо окон у группы в неделю'],
  ['maxTeacherWindowsPerWeek', 'Допустимо окон у преподавателя в неделю'],
  ['maxExamsPerWeek', 'Макс. экзаменов у группы в неделю'],
  ['maxBuildingChangesPerDay', 'Макс. переходов между корпусами в день'],
  ['consultationWeeksBeforeEnd', 'Консультации за N недель до конца семестра'],
  ['solverTimeLimitSeconds', 'Лимит времени решателя, с'],
];

const WEIGHTS: Record<string, string> = {
  groupWindows: 'Окна у групп',
  teacherWindows: 'Окна у преподавателей',
  lateLessons: 'Поздние пары',
  teacherPreference: 'Пожелания преподавателей',
  groupDailyOverload: 'Перегрузка группы в день',
  difficultLate: 'Сложные дисциплины на поздних парах',
  disciplineWeekly: 'Превышение пар дисциплины в неделю',
  sameDayDiscipline: 'Повтор дисциплины в один день',
  buildingChanges: 'Переходы между корпусами',
  evenDistribution: 'Равномерность по неделям',
};

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  user: { id: string; fullName: string; email: string } | null;
}

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const settings = useSettings();
  if (settings.isLoading) return <LoadingState rows={8} />;
  if (settings.error) return <ErrorState error={settings.error} onRetry={() => settings.refetch()} />;
  const data = settings.data!;
  return (
    <div className="space-y-5">
      <PageHeader title="Настройки" description="Параметры колледжа, сетка звонков, правила составления расписания и журнал изменений" />
      {!isAdmin && (
        <Alert variant="info">
          <AlertDescription>Изменять настройки может только администратор. Диспетчеру доступен просмотр и журнал изменений.</AlertDescription>
        </Alert>
      )}
      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">Правила расписания</TabsTrigger>
          <TabsTrigger value="bells">Звонки</TabsTrigger>
          <TabsTrigger value="org">Организация</TabsTrigger>
          <TabsTrigger value="audit">Журнал изменений</TabsTrigger>
        </TabsList>
        <TabsContent value="rules">
          <RulesForm settings={data.settings} editable={isAdmin} />
        </TabsContent>
        <TabsContent value="bells">
          <BellsForm times={data.lessonTimes} editable={isAdmin} />
        </TabsContent>
        <TabsContent value="org">
          <OrgForm org={data.organization} editable={isAdmin} />
        </TabsContent>
        <TabsContent value="audit">
          <AuditLog />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RulesForm({ settings, editable }: { settings: Settings; editable: boolean }) {
  const [draft, setDraft] = useState<Settings>(settings);
  useEffect(() => setDraft(settings), [settings]);
  const save = useApiMutation(
    () => {
      const { weights, ...rest } = draft;
      return api.patch('/settings', { ...rest, solverWeightsJson: weights });
    },
    { success: 'Настройки сохранены', invalidate: [['settings']] },
  );
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Жёсткие и мягкие ограничения</CardTitle>
          <CardDescription>1 пара = {draft.academicHoursPerLesson} академических часа</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {NUMERIC.map(([k, label, hint]) => (
              <Field key={k} label={label} hint={hint}>
                <Input
                  type="number"
                  value={String(draft[k] ?? '')}
                  disabled={!editable}
                  onChange={(e) => setDraft({ ...draft, [k]: Number(e.target.value) })}
                />
              </Field>
            ))}
          </div>
          <Field label="Учебные дни недели">
            <div className="flex flex-wrap gap-3">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <label key={d} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={draft.workingDays.includes(d)}
                    disabled={!editable}
                    onCheckedChange={(c) =>
                      setDraft({ ...draft, workingDays: c ? [...draft.workingDays, d].sort() : draft.workingDays.filter((x) => x !== d) })
                    }
                  />
                  {WEEKDAYS[d]}
                </label>
              ))}
            </div>
          </Field>
          <label className="flex items-center justify-between gap-3 text-sm">
            Предупреждать о неполных парах (нечётное число часов)
            <Switch checked={draft.warnOnPartialLessons} disabled={!editable} onCheckedChange={(v) => setDraft({ ...draft, warnOnPartialLessons: v })} />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            Ставить консультации в расписание по умолчанию
            <Switch checked={draft.scheduleConsultations} disabled={!editable} onCheckedChange={(v) => setDraft({ ...draft, scheduleConsultations: v })} />
          </label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Веса мягких ограничений</CardTitle>
          <CardDescription>Чем больше вес, тем сильнее генератор избегает нарушения</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {Object.entries(WEIGHTS).map(([k, label]) => (
            <div key={k} className="grid grid-cols-[1fr_120px] items-center gap-3">
              <span className="text-sm">{label}</span>
              <Input
                type="number"
                min={0}
                value={draft.weights[k] ?? 0}
                disabled={!editable}
                onChange={(e) => setDraft({ ...draft, weights: { ...draft.weights, [k]: Number(e.target.value) } })}
              />
            </div>
          ))}
        </CardContent>
      </Card>
      {editable && (
        <div className="xl:col-span-2">
          <Button onClick={() => save.mutate(undefined)} disabled={save.isPending}>
            {save.isPending ? <Spinner /> : <Save />} Сохранить настройки
          </Button>
        </div>
      )}
    </div>
  );
}

function BellsForm({ times, editable }: { times: LessonTime[]; editable: boolean }) {
  const [rows, setRows] = useState(times);
  useEffect(() => setRows(times), [times]);
  const save = useApiMutation(() => api.put('/settings/lesson-times', { items: rows }), {
    success: 'Расписание звонков сохранено',
    invalidate: [['settings']],
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Расписание звонков</CardTitle>
        <CardDescription>Время начала и окончания каждой пары. Изменение не затрагивает время уже созданных занятий.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Table className="max-w-xl">
          <TableHeader>
            <TableRow>
              <TableHead>Пара</TableHead>
              <TableHead>Начало</TableHead>
              <TableHead>Окончание</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={r.lessonNumber}>
                <TableCell className="font-medium">{r.lessonNumber}</TableCell>
                <TableCell>
                  <Input type="time" value={r.startTime} disabled={!editable} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, startTime: e.target.value } : x)))} />
                </TableCell>
                <TableCell>
                  <Input type="time" value={r.endTime} disabled={!editable} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, endTime: e.target.value } : x)))} />
                </TableCell>
                <TableCell>
                  {editable && i === rows.length - 1 && rows.length > 1 && (
                    <Button variant="ghost" size="icon-sm" onClick={() => setRows(rows.slice(0, -1))} aria-label="Удалить пару">
                      <Trash2 />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {editable && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={rows.length >= 10}
              onClick={() => setRows([...rows, { lessonNumber: rows.length + 1, startTime: '18:00', endTime: '19:30' }])}
            >
              <Plus /> Пара
            </Button>
            <Button onClick={() => save.mutate(undefined)} disabled={save.isPending}>
              {save.isPending ? <Spinner /> : <Save />} Сохранить
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OrgForm({ org, editable }: { org: { name: string; shortName: string | null; address: string | null; timezone: string }; editable: boolean }) {
  const [draft, setDraft] = useState({ name: org.name, shortName: org.shortName ?? '', address: org.address ?? '', timezone: org.timezone });
  const save = useApiMutation(() => api.patch('/settings/organization', draft), {
    success: 'Сведения об организации сохранены',
    invalidate: [['settings']],
  });
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Образовательная организация</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Field label="Полное наименование">
          <Input value={draft.name} disabled={!editable} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </Field>
        <Field label="Краткое наименование">
          <Input value={draft.shortName} disabled={!editable} onChange={(e) => setDraft({ ...draft, shortName: e.target.value })} />
        </Field>
        <Field label="Адрес">
          <Input value={draft.address} disabled={!editable} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
        </Field>
        <Field label="Часовой пояс" hint="Например, Europe/Moscow">
          <Input value={draft.timezone} disabled={!editable} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} />
        </Field>
        {editable && (
          <div>
            <Button onClick={() => save.mutate(undefined)} disabled={save.isPending}>
              {save.isPending ? <Spinner /> : <Save />} Сохранить
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const ACTION_LABELS: Record<string, string> = {
  CREATE: 'Создание',
  UPDATE: 'Изменение',
  DELETE: 'Удаление',
  MOVE: 'Перенос',
  CANCEL: 'Отмена',
  SUBSTITUTE: 'Замена',
  MARK_CONDUCTED: 'Отметка проведения',
  PUBLISH: 'Публикация',
  UNPUBLISH: 'Снятие с публикации',
  APPLY_GENERATION: 'Применение генерации',
  GENERATE: 'Генерация',
  IMPORT: 'Импорт',
  LOGIN: 'Вход',
  UPSERT: 'Сохранение',
  UNMARK: 'Сброс отметки проведения',
  SET_WEEK_TYPE: 'Тип недели графика',
  MARK_REPLACED: 'Отметка замены',
  CLEAR: 'Очистка периода',
  AUTO_PLACE: 'Автораспределение аттестации',
};

function AuditLog() {
  const [page, setPage] = useState(0);
  const [entityType, setEntityType] = useState('');
  const take = 50;
  const data = useApi<{ items: AuditEntry[]; total: number }>(['audit', page, entityType], '/audit-logs', {
    take,
    skip: page * take,
    entityType: entityType || undefined,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Журнал изменений</CardTitle>
        <CardDescription>Кто, когда и что изменил в расписании и справочниках</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          className="max-w-xs"
          placeholder="Тип объекта (ScheduleLesson, Teacher…)"
          value={entityType}
          onChange={(e) => {
            setEntityType(e.target.value);
            setPage(0);
          }}
        />
        {data.isLoading ? (
          <LoadingState rows={6} />
        ) : data.error ? (
          <ErrorState error={data.error} />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Время</TableHead>
                  <TableHead>Пользователь</TableHead>
                  <TableHead>Действие</TableHead>
                  <TableHead>Объект</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data!.items.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="whitespace-nowrap">{formatDateTime(a.createdAt)}</TableCell>
                    <TableCell>{a.user?.fullName ?? 'Система'}</TableCell>
                    <TableCell>{ACTION_LABELS[a.action] ?? a.action}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {a.entityType}
                      {a.entityId ? ` · ${a.entityId.slice(0, 8)}` : ''}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="text-muted-foreground flex items-center justify-between text-sm">
              <span>Всего записей: {data.data!.total}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  Назад
                </Button>
                <Button size="sm" variant="outline" disabled={(page + 1) * take >= data.data!.total} onClick={() => setPage(page + 1)}>
                  Вперёд
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
