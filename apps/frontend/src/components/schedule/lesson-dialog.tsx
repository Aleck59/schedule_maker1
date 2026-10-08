import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowRightLeft,
  Ban,
  CheckCircle2,
  Copy,
  History,
  Pencil,
  RotateCcw,
  Trash2,
  UserRoundCog,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Confirm } from '@/components/common/confirm';
import { Field } from '@/components/common/field';
import { SimpleSelect } from '@/components/common/simple-select';
import { LoadingState, Spinner } from '@/components/common/states';
import { LessonStatusBadge } from '@/components/common/status-badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useClassrooms, useSettings, useTeachers } from '@/hooks/use-reference';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime, today, weekdayName } from '@/lib/format';
import {
  CANCELLATION_REASON_LABELS,
  CLASSROOM_TYPE_LABELS,
  LESSON_STATUS_LABELS,
  LESSON_TYPE_LABELS,
} from '@/lib/labels';
import { useApi, useApiMutation } from '@/lib/query';
import type { FreeSlot, Lesson, ValidationIssue } from '@/lib/types';
import { issuesFromError, IssuesList } from './issues-list';

type Panel = 'none' | 'mark' | 'move' | 'cancel' | 'substitute' | 'edit' | 'copy' | 'history';

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 py-1 text-sm">
      <div className="text-muted-foreground">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Блок конфликтов с возможностью сохранить несмотря на них */
function ConflictBlock({
  issues,
  canForce,
  onForce,
  pending,
}: {
  issues: ValidationIssue[] | null;
  canForce: boolean;
  onForce: () => void;
  pending: boolean;
}) {
  if (!issues) return null;
  const errors = issues.filter((i) => i.severity === 'ERROR');
  return (
    <Alert variant={errors.length ? 'destructive' : 'warning'}>
      <AlertTitle>{errors.length ? 'Обнаружены конфликты' : 'Предупреждения'}</AlertTitle>
      <AlertDescription>
        <IssuesList issues={issues} />
        {canForce && errors.length > 0 && (
          <Button size="sm" variant="destructive" className="mt-2" onClick={onForce} disabled={pending}>
            Сохранить несмотря на конфликты
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

function lessonOptions(count: number) {
  return Array.from({ length: count }, (_, i) => ({ value: String(i + 1), label: `${i + 1} пара` }));
}

export function LessonDialog({
  lessonId,
  open,
  onOpenChange,
  onChanged,
}: {
  lessonId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}) {
  const { user, canEdit } = useAuth();
  const [panel, setPanel] = useState<Panel>('none');
  const lessonQuery = useApi<Lesson>(['lesson', lessonId], lessonId ? `/schedule-lessons/${lessonId}` : null, undefined, {
    enabled: open && !!lessonId,
  });
  const lesson = lessonQuery.data;
  useEffect(() => {
    if (open) setPanel('none');
  }, [open, lessonId]);

  const refresh = () => {
    void lessonQuery.refetch();
    onChanged?.();
  };
  const isOwn =
    !!lesson &&
    user?.role === 'TEACHER' &&
    (lesson.teacher?.id === user.teacherId || lesson.substitution?.originalTeacher?.id === user.teacherId);
  const canAct = canEdit || isOwn;
  const active = lesson && (lesson.status === 'PLANNED' || lesson.status === 'REPLACED');
  const canMark = !!lesson && canAct && active && lesson.date <= today() && lesson.schedulePeriod.status !== 'ARCHIVED';

  const actions: Array<{ key: Panel; label: string; icon: ReactNode; show: boolean }> = lesson
    ? [
        { key: 'mark', label: 'Отметить проведение', icon: <CheckCircle2 />, show: !!canMark },
        { key: 'move', label: 'Перенести', icon: <ArrowRightLeft />, show: !!(canAct && active && !lesson.conducted) },
        { key: 'substitute', label: 'Замена', icon: <UserRoundCog />, show: !!(canAct && active) },
        { key: 'cancel', label: 'Отменить', icon: <Ban />, show: !!(canAct && active && lesson.conducted?.status !== 'CONDUCTED') },
        { key: 'edit', label: 'Изменить', icon: <Pencil />, show: canEdit },
        { key: 'copy', label: 'Копировать', icon: <Copy />, show: canEdit },
        { key: 'history', label: 'История', icon: <History />, show: true },
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{lesson ? lesson.semesterItem.curriculumItem.name : 'Занятие'}</DialogTitle>
        </DialogHeader>
        {lessonQuery.isLoading || !lesson ? (
          <LoadingState rows={5} />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <LessonStatusBadge status={lesson.status} />
              <Badge variant="outline">{LESSON_TYPE_LABELS[lesson.lessonType]}</Badge>
              {lesson.academicHours === 1 && <Badge variant="warning">Неполная пара (1 ч)</Badge>}
              {lesson.isLocked && <Badge variant="secondary">Закреплено</Badge>}
              {lesson.isManual && <Badge variant="muted">Изменено вручную</Badge>}
            </div>
            <div className="rounded-lg border px-3 py-1">
              <InfoRow label="Дата и время">
                {weekdayName(lesson.weekday)}, {formatDate(lesson.date)} · {lesson.lessonNumber} пара ({lesson.startTime}–
                {lesson.endTime})
              </InfoRow>
              <InfoRow label="Группа">
                {lesson.studentGroup.code}
                {lesson.subgroupNumber ? `, подгруппа ${lesson.subgroupNumber}` : ', вся группа'}
              </InfoRow>
              <InfoRow label="Дисциплина">
                {lesson.semesterItem.curriculumItem.code} {lesson.semesterItem.curriculumItem.name}
              </InfoRow>
              <InfoRow label="Преподаватель">
                {lesson.teacher?.fullName ?? <span className="text-destructive">не назначен</span>}
                {lesson.substitution && (
                  <div className="text-xs text-amber-700 dark:text-amber-400">
                    Замена: вместо {lesson.substitution.originalTeacher?.fullName ?? '—'}
                    {lesson.substitution.reason ? ` (${lesson.substitution.reason})` : ''}
                  </div>
                )}
              </InfoRow>
              <InfoRow label="Аудитория">
                {lesson.classroom ? (
                  <>
                    {lesson.classroom.code} — {lesson.classroom.name}{' '}
                    <span className="text-muted-foreground text-xs">
                      ({CLASSROOM_TYPE_LABELS[lesson.classroom.classroomType]}, {lesson.classroom.capacity} мест)
                    </span>
                  </>
                ) : (
                  <span className="text-destructive">не назначена</span>
                )}
              </InfoRow>
              <InfoRow label="Часы">{lesson.academicHours} ак. ч.</InfoRow>
              {lesson.topic && <InfoRow label="Тема">{lesson.topic}</InfoRow>}
              {lesson.notes && <InfoRow label="Примечание">{lesson.notes}</InfoRow>}
              {lesson.originalLesson && (
                <InfoRow label="Исходное занятие">
                  {formatDate(lesson.originalLesson.date)}, {lesson.originalLesson.lessonNumber} пара (
                  {LESSON_STATUS_LABELS[lesson.originalLesson.status]})
                </InfoRow>
              )}
              {lesson.derivedLessons.length > 0 && (
                <InfoRow label="Перенесено на">
                  {lesson.derivedLessons.map((d) => `${formatDate(d.date)}, ${d.lessonNumber} пара`).join('; ')}
                </InfoRow>
              )}
              {lesson.conducted && (
                <InfoRow label="Отметка">
                  {lesson.conducted.status === 'CONDUCTED'
                    ? `Проведено: ${lesson.conducted.actualHours} ак. ч.${
                        lesson.conducted.actualTeacher ? `, ${lesson.conducted.actualTeacher.fullName}` : ''
                      }`
                    : lesson.conducted.status === 'CANCELLED'
                      ? `Не состоялось: ${CANCELLATION_REASON_LABELS[lesson.conducted.cancellationReason ?? 'OTHER']}`
                      : lesson.conducted.status === 'POSTPONED'
                        ? 'Перенесено'
                        : 'Заменено другим занятием'}
                  {lesson.conducted.notes && <div className="text-muted-foreground text-xs">{lesson.conducted.notes}</div>}
                </InfoRow>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {actions
                .filter((a) => a.show)
                .map((a) => (
                  <Button
                    key={a.key}
                    size="sm"
                    variant={panel === a.key ? 'default' : 'outline'}
                    onClick={() => setPanel(panel === a.key ? 'none' : a.key)}
                  >
                    {a.icon} {a.label}
                  </Button>
                ))}
              {lesson.conducted && canAct && lesson.status !== 'MOVED' && <UnmarkButton lesson={lesson} onDone={refresh} />}
              {canEdit && lesson.conducted?.status !== 'CONDUCTED' && (
                <DeleteButton
                  lesson={lesson}
                  onDone={() => {
                    onOpenChange(false);
                    onChanged?.();
                  }}
                />
              )}
            </div>

            {panel !== 'none' && <Separator />}
            {panel === 'mark' && <MarkPanel lesson={lesson} onDone={refresh} />}
            {panel === 'move' && <MovePanel lesson={lesson} canForce={canEdit} onDone={refresh} />}
            {panel === 'cancel' && <CancelPanel lesson={lesson} onDone={refresh} />}
            {panel === 'substitute' && <SubstitutePanel lesson={lesson} canForce={canEdit} onDone={refresh} />}
            {panel === 'edit' && <EditPanel lesson={lesson} onDone={refresh} />}
            {panel === 'copy' && <CopyPanel lesson={lesson} onDone={() => onChanged?.()} />}
            {panel === 'history' && <HistoryPanel lessonId={lesson.id} />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function UnmarkButton({ lesson, onDone }: { lesson: Lesson; onDone: () => void }) {
  const m = useApiMutation(() => api.post(`/schedule-lessons/${lesson.id}/unmark`), {
    success: 'Отметка снята',
    invalidate: [['lessons'], ['hour-control']],
    onSuccess: onDone,
  });
  return (
    <Confirm
      trigger={
        <Button size="sm" variant="ghost">
          <RotateCcw /> Снять отметку
        </Button>
      }
      title="Снять отметку о проведении?"
      description="Часы будут возвращены в остаток по дисциплине."
      onConfirm={() => m.mutate(undefined)}
    />
  );
}

function DeleteButton({ lesson, onDone }: { lesson: Lesson; onDone: () => void }) {
  const m = useApiMutation(() => api.delete(`/schedule-lessons/${lesson.id}`), {
    success: 'Занятие удалено',
    invalidate: [['lessons'], ['hour-control']],
    onSuccess: onDone,
  });
  return (
    <Confirm
      trigger={
        <Button size="sm" variant="ghost" className="text-destructive">
          <Trash2 /> Удалить
        </Button>
      }
      title="Удалить занятие?"
      description="Занятие будет удалено из расписания. Для опубликованного расписания студенты получат уведомление."
      destructive
      confirmText="Удалить"
      onConfirm={() => m.mutate(undefined)}
    />
  );
}

function MarkPanel({ lesson, onDone }: { lesson: Lesson; onDone: () => void }) {
  const teachers = useTeachers();
  const [outcome, setOutcome] = useState<'full' | 'partial' | 'substitute' | 'not_held'>('full');
  const [hours, setHours] = useState(Math.max(1, lesson.academicHours - 1));
  const [teacherId, setTeacherId] = useState<string | null>(null);
  const [reason, setReason] = useState<string>('TEACHER_ABSENT');
  const [topic, setTopic] = useState(lesson.topic ?? '');
  const [notes, setNotes] = useState('');
  const m = useApiMutation(
    () => {
      const body: Record<string, unknown> =
        outcome === 'not_held'
          ? { status: 'CANCELLED', cancellationReason: reason, notes }
          : {
              status: 'CONDUCTED',
              actualHours: outcome === 'partial' ? hours : undefined,
              actualTeacherId: outcome === 'substitute' ? teacherId : undefined,
              topic: topic || undefined,
              notes: notes || undefined,
            };
      return api.post(`/schedule-lessons/${lesson.id}/mark-conducted`, body);
    },
    {
      success: outcome === 'not_held' ? 'Занятие отмечено как несостоявшееся, создана задача отработки' : 'Проведение отмечено',
      invalidate: [['lessons'], ['hour-control'], ['dashboard'], ['makeup']],
      onSuccess: onDone,
    },
  );
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {(
          [
            ['full', 'Проведено полностью'],
            ['partial', 'Проведено частично'],
            ['substitute', 'Проведено заменяющим'],
            ['not_held', 'Не состоялось'],
          ] as const
        ).map(([key, text]) => (
          <label
            key={key}
            className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${outcome === key ? 'border-primary bg-primary/5' : ''}`}
          >
            <input type="radio" checked={outcome === key} onChange={() => setOutcome(key)} />
            {text}
          </label>
        ))}
      </div>
      {outcome === 'partial' && (
        <Field label="Фактически проведено, ак. часов">
          <Input type="number" min={1} max={lesson.academicHours - 1} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
        </Field>
      )}
      {outcome === 'substitute' && (
        <Field label="Заменяющий преподаватель">
          <SimpleSelect
            value={teacherId}
            onChange={setTeacherId}
            options={(teachers.data ?? []).filter((t) => t.id !== lesson.teacher?.id).map((t) => ({ value: t.id, label: t.fullName }))}
          />
        </Field>
      )}
      {outcome === 'not_held' ? (
        <Field label="Причина">
          <SimpleSelect
            value={reason}
            onChange={(v) => setReason(v ?? 'OTHER')}
            options={Object.entries(CANCELLATION_REASON_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </Field>
      ) : (
        <Field label="Тема занятия">
          <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Необязательно" />
        </Field>
      )}
      <Field label="Примечание">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </Field>
      <div>
        <Button onClick={() => m.mutate(undefined)} disabled={m.isPending || (outcome === 'substitute' && !teacherId)}>
          {m.isPending && <Spinner />} Сохранить отметку
        </Button>
      </div>
    </div>
  );
}

function MovePanel({ lesson, canForce, onDone }: { lesson: Lesson; canForce: boolean; onDone: () => void }) {
  const settings = useSettings();
  const classrooms = useClassrooms(canForce);
  const [date, setDate] = useState(lesson.date);
  const [lessonNumber, setLessonNumber] = useState(String(lesson.lessonNumber));
  const [classroomId, setClassroomId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null);
  const [slots, setSlots] = useState<FreeSlot[] | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const m = useApiMutation(
    (force: boolean) =>
      api.post<{ mode: string }>(`/schedule-lessons/${lesson.id}/move`, {
        date,
        lessonNumber: Number(lessonNumber),
        classroomId: classroomId ?? undefined,
        reason: reason || undefined,
        force,
      }),
    {
      success: (r) => (r.mode === 'history' ? 'Занятие перенесено (история сохранена)' : 'Занятие перенесено'),
      invalidate: [['lessons'], ['hour-control']],
      onSuccess: () => {
        setIssues(null);
        onDone();
      },
      onError: (e) => {
        const found = issuesFromError(e);
        setIssues(found);
        return !!found;
      },
    },
  );
  const findSlots = async () => {
    setLoadingSlots(true);
    try {
      setSlots(await api.get<FreeSlot[]>(`/schedule-lessons/${lesson.id}/free-slots`, { from: today() > lesson.date ? today() : lesson.date, limit: 8 }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoadingSlots(false);
    }
  };
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Новая дата">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Пара">
          <SimpleSelect value={lessonNumber} onChange={(v) => setLessonNumber(v ?? '1')} options={lessonOptions(settings.data?.settings.lessonsPerDay ?? 6)} />
        </Field>
        {canForce && (
          <Field label="Аудитория">
            <SimpleSelect
              value={classroomId}
              onChange={setClassroomId}
              allowEmpty
              emptyLabel="Та же"
              options={(classrooms.data ?? []).map((c) => ({ value: c.id, label: `${c.code} (${c.capacity})` }))}
            />
          </Field>
        )}
      </div>
      <Field label="Причина переноса">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Необязательно" />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => m.mutate(false)} disabled={m.isPending}>
          {m.isPending && <Spinner />} Перенести
        </Button>
        <Button variant="outline" onClick={findSlots} disabled={loadingSlots}>
          {loadingSlots ? <Spinner /> : <Wand2 />} Подобрать свободный слот
        </Button>
      </div>
      {slots && (
        <div className="grid gap-1.5">
          {slots.length === 0 && <div className="text-muted-foreground text-sm">Свободных слотов не найдено</div>}
          {slots.map((s) => (
            <button
              key={`${s.date}-${s.lessonNumber}`}
              type="button"
              className="hover:bg-accent flex items-center justify-between rounded-md border px-3 py-1.5 text-left text-sm cursor-pointer"
              onClick={() => {
                setDate(s.date);
                setLessonNumber(String(s.lessonNumber));
                setClassroomId(s.classroomId);
              }}
            >
              <span>
                {weekdayName(s.weekday, true)} {formatDate(s.date)}, {s.lessonNumber} пара ({s.startTime}) · ауд. {s.classroomCode ?? '—'}
              </span>
              <span className="text-muted-foreground text-xs">{s.note}</span>
            </button>
          ))}
        </div>
      )}
      <ConflictBlock issues={issues} canForce={canForce} pending={m.isPending} onForce={() => m.mutate(true)} />
    </div>
  );
}

function CancelPanel({ lesson, onDone }: { lesson: Lesson; onDone: () => void }) {
  const [reason, setReason] = useState('TEACHER_ABSENT');
  const [notes, setNotes] = useState('');
  const [makeup, setMakeup] = useState(true);
  const [suggested, setSuggested] = useState<FreeSlot[] | null>(null);
  const m = useApiMutation(
    () =>
      api.post<{ suggestedSlots: FreeSlot[] }>(`/schedule-lessons/${lesson.id}/cancel`, {
        reason,
        notes: notes || undefined,
        createMakeupTask: makeup,
      }),
    {
      success: makeup ? 'Занятие отменено. Создана задача «требуется отработка»' : 'Занятие отменено',
      invalidate: [['lessons'], ['hour-control'], ['makeup'], ['dashboard']],
      onSuccess: (r) => {
        setSuggested(r.suggestedSlots ?? []);
        onDone();
      },
    },
  );
  return (
    <div className="grid gap-3">
      <Field label="Причина отмены">
        <SimpleSelect
          value={reason}
          onChange={(v) => setReason(v ?? 'OTHER')}
          options={Object.entries(CANCELLATION_REASON_LABELS).map(([value, label]) => ({ value, label }))}
        />
      </Field>
      <Field label="Комментарий">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={makeup} onCheckedChange={(v) => setMakeup(!!v)} /> Создать задачу «требуется отработка»
      </label>
      <p className="text-muted-foreground text-xs">Часы отменённого занятия не списываются и остаются в остатке по дисциплине.</p>
      <div>
        <Button variant="destructive" onClick={() => m.mutate(undefined)} disabled={m.isPending}>
          {m.isPending && <Spinner />} Отменить занятие
        </Button>
      </div>
      {suggested && suggested.length > 0 && (
        <Alert variant="info">
          <AlertTitle>Свободные слоты для отработки</AlertTitle>
          <AlertDescription>
            <ul className="text-sm">
              {suggested.map((s) => (
                <li key={`${s.date}-${s.lessonNumber}`}>
                  {weekdayName(s.weekday, true)} {formatDate(s.date)}, {s.lessonNumber} пара, ауд. {s.classroomCode ?? '—'}
                </li>
              ))}
            </ul>
            <span className="text-xs">Поставить отработку можно в разделе «Отработки».</span>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function SubstitutePanel({ lesson, canForce, onDone }: { lesson: Lesson; canForce: boolean; onDone: () => void }) {
  const teachers = useTeachers();
  const [teacherId, setTeacherId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null);
  const m = useApiMutation(
    (force: boolean) =>
      api.post(`/schedule-lessons/${lesson.id}/substitute`, { substituteTeacherId: teacherId, reason: reason || undefined, force }),
    {
      success: 'Замена оформлена',
      invalidate: [['lessons'], ['hour-control']],
      onSuccess: () => {
        setIssues(null);
        onDone();
      },
      onError: (e) => {
        const found = issuesFromError(e);
        setIssues(found);
        return !!found;
      },
    },
  );
  return (
    <div className="grid gap-3">
      <Field label="Заменяющий преподаватель">
        <SimpleSelect
          value={teacherId}
          onChange={setTeacherId}
          options={(teachers.data ?? [])
            .filter((t) => t.isActive && t.id !== lesson.teacher?.id)
            .map((t) => ({ value: t.id, label: `${t.fullName}${t.department ? ` — ${t.department}` : ''}` }))}
        />
      </Field>
      <Field label="Причина">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Болезнь, командировка…" />
      </Field>
      <div>
        <Button onClick={() => m.mutate(false)} disabled={!teacherId || m.isPending}>
          {m.isPending && <Spinner />} Оформить замену
        </Button>
      </div>
      <ConflictBlock issues={issues} canForce={canForce} pending={m.isPending} onForce={() => m.mutate(true)} />
    </div>
  );
}

function EditPanel({ lesson, onDone }: { lesson: Lesson; onDone: () => void }) {
  const teachers = useTeachers();
  const classrooms = useClassrooms();
  const [teacherId, setTeacherId] = useState<string | null>(lesson.teacher?.id ?? null);
  const [classroomId, setClassroomId] = useState<string | null>(lesson.classroom?.id ?? null);
  const [hours, setHours] = useState(lesson.academicHours);
  const [topic, setTopic] = useState(lesson.topic ?? '');
  const [notes, setNotes] = useState(lesson.notes ?? '');
  const [isLocked, setIsLocked] = useState(lesson.isLocked);
  const [allowExcess, setAllowExcess] = useState(lesson.allowHoursExcess);
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null);
  const m = useApiMutation(
    (force: boolean) =>
      api.patch(`/schedule-lessons/${lesson.id}`, {
        teacherId: teacherId !== (lesson.teacher?.id ?? null) ? teacherId : undefined,
        classroomId: classroomId !== (lesson.classroom?.id ?? null) ? classroomId : undefined,
        academicHours: hours !== lesson.academicHours ? hours : undefined,
        topic,
        notes,
        isLocked,
        allowHoursExcess: allowExcess,
        force,
      }),
    {
      success: 'Изменения сохранены',
      invalidate: [['lessons'], ['hour-control']],
      onSuccess: () => {
        setIssues(null);
        onDone();
      },
      onError: (e) => {
        const found = issuesFromError(e);
        setIssues(found);
        return !!found;
      },
    },
  );
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Преподаватель">
          <SimpleSelect
            value={teacherId}
            onChange={setTeacherId}
            allowEmpty
            options={(teachers.data ?? []).map((t) => ({ value: t.id, label: t.fullName }))}
          />
        </Field>
        <Field label="Аудитория">
          <SimpleSelect
            value={classroomId}
            onChange={setClassroomId}
            allowEmpty
            options={(classrooms.data ?? []).map((c) => ({
              value: c.id,
              label: `${c.code} — ${CLASSROOM_TYPE_LABELS[c.classroomType]}, ${c.capacity} мест`,
            }))}
          />
        </Field>
        <Field label="Академических часов">
          <SimpleSelect
            value={String(hours)}
            onChange={(v) => setHours(Number(v))}
            options={[
              { value: '1', label: '1 ч (неполная пара)' },
              { value: '2', label: '2 ч (пара)' },
            ]}
          />
        </Field>
        <Field label="Тема">
          <Input value={topic} onChange={(e) => setTopic(e.target.value)} />
        </Field>
      </div>
      <Field label="Примечание">
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-5">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={isLocked} onCheckedChange={setIsLocked} /> Закрепить (не менять при генерации)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={allowExcess} onCheckedChange={setAllowExcess} /> Разрешить превышение плана
        </label>
      </div>
      <div>
        <Button onClick={() => m.mutate(false)} disabled={m.isPending}>
          {m.isPending && <Spinner />} Сохранить
        </Button>
      </div>
      <ConflictBlock issues={issues} canForce pending={m.isPending} onForce={() => m.mutate(true)} />
    </div>
  );
}

function CopyPanel({ lesson, onDone }: { lesson: Lesson; onDone: () => void }) {
  const settings = useSettings();
  const [date, setDate] = useState(lesson.date);
  const [lessonNumber, setLessonNumber] = useState(String(lesson.lessonNumber === 1 ? 2 : lesson.lessonNumber - 1));
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null);
  const m = useApiMutation(
    (force: boolean) => api.post(`/schedule-lessons/${lesson.id}/copy`, { date, lessonNumber: Number(lessonNumber), force }),
    {
      success: 'Создана копия занятия',
      invalidate: [['lessons'], ['hour-control']],
      onSuccess: () => {
        setIssues(null);
        onDone();
      },
      onError: (e) => {
        const found = issuesFromError(e);
        setIssues(found);
        return !!found;
      },
    },
  );
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Дата">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Пара">
          <SimpleSelect value={lessonNumber} onChange={(v) => setLessonNumber(v ?? '1')} options={lessonOptions(settings.data?.settings.lessonsPerDay ?? 6)} />
        </Field>
      </div>
      <div>
        <Button onClick={() => m.mutate(false)} disabled={m.isPending}>
          {m.isPending && <Spinner />} Копировать
        </Button>
      </div>
      <ConflictBlock issues={issues} canForce pending={m.isPending} onForce={() => m.mutate(true)} />
    </div>
  );
}

interface HistoryResponse {
  chain: Lesson[];
  substitutions: Array<{
    id: string;
    createdAt: string;
    reason: string | null;
    originalTeacher: { fullName: string } | null;
    substituteTeacher: { fullName: string };
    approvedBy: { fullName: string } | null;
  }>;
  audit: Array<{ id: string; action: string; user: string | null; createdAt: string }>;
}

const ACTION_LABELS: Record<string, string> = {
  CREATE: 'Создано',
  UPDATE: 'Изменено',
  MOVE: 'Перенос',
  CANCEL: 'Отмена',
  SUBSTITUTE: 'Замена преподавателя',
  MARK_CONDUCTED: 'Отмечено проведение',
  MARK_REPLACED: 'Заменено другим занятием',
  UNMARK: 'Отметка снята',
  DELETE: 'Удалено',
};

function HistoryPanel({ lessonId }: { lessonId: string }) {
  const history = useApi<HistoryResponse>(['lesson-history', lessonId], `/schedule-lessons/${lessonId}/history`);
  if (history.isLoading) return <LoadingState rows={3} />;
  const data = history.data;
  if (!data) return null;
  return (
    <div className="grid gap-4 text-sm">
      {data.chain.length > 1 && (
        <div>
          <Label className="mb-1.5">Цепочка переносов</Label>
          <ol className="space-y-1">
            {data.chain.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <LessonStatusBadge status={c.status} />
                {formatDate(c.date)}, {c.lessonNumber} пара{c.id === lessonId && ' (текущее)'}
              </li>
            ))}
          </ol>
        </div>
      )}
      {data.substitutions.length > 0 && (
        <div>
          <Label className="mb-1.5">Замены</Label>
          {data.substitutions.map((s) => (
            <div key={s.id}>
              {formatDateTime(s.createdAt)}: {s.originalTeacher?.fullName ?? '—'} → {s.substituteTeacher.fullName}
              {s.reason ? ` (${s.reason})` : ''}
            </div>
          ))}
        </div>
      )}
      <div>
        <Label className="mb-1.5">Журнал изменений</Label>
        {data.audit.length === 0 && <div className="text-muted-foreground">Изменений нет — занятие создано генератором</div>}
        <ul className="space-y-0.5">
          {data.audit.map((a) => (
            <li key={a.id}>
              {formatDateTime(a.createdAt)} · {ACTION_LABELS[a.action] ?? a.action} · {a.user ?? 'система'}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
