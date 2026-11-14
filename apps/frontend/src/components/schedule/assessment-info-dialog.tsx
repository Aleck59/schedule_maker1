import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRightLeft, CalendarCheck, CalendarRange, Pencil, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Confirm } from '@/components/common/confirm';
import { Field } from '@/components/common/field';
import { SimpleSelect } from '@/components/common/simple-select';
import { LoadingState, Spinner } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { useClassrooms, useSettings, useTeachers } from '@/hooks/use-reference';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, weekdayName, isoWeekday } from '@/lib/format';
import { ASSESSMENT_MARK, CLASSROOM_TYPE_LABELS, CONTROL_FORM_LABELS } from '@/lib/labels';
import { useApi, useApiMutation } from '@/lib/query';
import { InfoRow, lessonOptions, RefLink } from './lesson-parts';

interface AssessmentDetails {
  id: string;
  date: string;
  lessonNumber: number | null;
  controlForm: string;
  notes: string | null;
  time: { startTime: string; endTime: string } | null;
  group: { id: string; code: string; educationalProgramId: string; studentCount: number };
  semesterItem: {
    semesterId: string;
    curriculumItem: { id: string; code: string; name: string; educationalProgramId: string | null };
  };
  teacher: { id: string; fullName: string } | null;
  classroom: { id: string; code: string; name: string; classroomType: string; capacity: number } | null;
}

type Panel = 'none' | 'move' | 'edit';

const EXAMS = ['EXAM', 'QUALIFICATION_EXAM'];

/**
 * Экзамен или зачёт в сетке расписания — окно как у пары: ссылки на группу, дисциплину,
 * преподавателя и аудиторию, перенос, изменение и удаление (проверки — как в редакторе экзаменов)
 */
export function AssessmentInfoDialog({
  assessmentId,
  open,
  onOpenChange,
  onChanged,
  initialPanel,
}: {
  assessmentId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onChanged?: () => void;
  initialPanel?: 'move' | 'edit';
}) {
  const { user, canEdit } = useAuth();
  const qc = useQueryClient();
  const [panel, setPanel] = useState<Panel>('none');
  const q = useApi<AssessmentDetails>(['assessment', assessmentId], assessmentId ? `/assessment-events/${assessmentId}` : null, undefined, {
    enabled: open && !!assessmentId,
  });
  const a = q.data;
  useEffect(() => {
    if (open) setPanel(initialPanel ?? 'none');
  }, [open, assessmentId, initialPanel]);

  const canOpenRefs = !!user && ['ADMIN', 'DISPATCHER', 'MANAGER'].includes(user.role);
  const ref = (path: string | null | undefined) => (canOpenRefs && path ? path : null);
  const refresh = () => {
    void q.refetch();
    void qc.invalidateQueries({ queryKey: ['assessments'] });
    void qc.invalidateQueries({ queryKey: ['assessment-board'] });
    onChanged?.();
  };
  const remove = useApiMutation(() => api.delete(`/assessment-events/${assessmentId}`), {
    success: 'Мероприятие удалено',
    invalidate: [['lessons'], ['assessments'], ['assessment-board']],
    onSuccess: () => {
      onOpenChange(false);
      onChanged?.();
    },
  });
  const mark = a ? (ASSESSMENT_MARK[a.controlForm] ?? CONTROL_FORM_LABELS[a.controlForm]) : 'Контрольное мероприятие';
  const actions: Array<{ key: Panel; label: string; icon: ReactNode }> = [
    { key: 'move', label: 'Перенести', icon: <ArrowRightLeft /> },
    { key: 'edit', label: 'Изменить', icon: <Pencil /> },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarCheck className="size-5 text-rose-500" />
            {a ? a.semesterItem.curriculumItem.name : mark}
          </DialogTitle>
          <DialogDescription>Экзамены и зачёты в часы занятий не входят. Изменения видны и в календарном графике.</DialogDescription>
        </DialogHeader>
        {q.isLoading || !a ? (
          <LoadingState rows={4} />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={EXAMS.includes(a.controlForm) ? 'destructive' : 'secondary'}>{CONTROL_FORM_LABELS[a.controlForm] ?? mark}</Badge>
              {!a.lessonNumber && <Badge variant="warning">Пара не назначена</Badge>}
            </div>
            <div className="rounded-lg border px-3 py-1">
              <InfoRow label="Дата и время">
                {weekdayName(isoWeekday(a.date))}, {formatDate(a.date)}
                {a.lessonNumber ? ` · ${a.lessonNumber} пара` : ''}
                {a.time ? ` (${a.time.startTime}–${a.time.endTime})` : ''}
              </InfoRow>
              <InfoRow label="Группа">
                <RefLink to={ref(`/groups/${a.group.id}`)}>{a.group.code}</RefLink>, вся группа
              </InfoRow>
              <InfoRow label="Дисциплина">
                <RefLink
                  to={ref(
                    a.semesterItem.curriculumItem.educationalProgramId &&
                      `/programs/${a.semesterItem.curriculumItem.educationalProgramId}?item=${a.semesterItem.curriculumItem.id}`,
                  )}
                >
                  {a.semesterItem.curriculumItem.code} {a.semesterItem.curriculumItem.name}
                </RefLink>
              </InfoRow>
              <InfoRow label="Преподаватель">
                {a.teacher ? (
                  <RefLink to={ref(`/teachers/${a.teacher.id}`)}>{a.teacher.fullName}</RefLink>
                ) : (
                  <span className="text-destructive">не назначен</span>
                )}
              </InfoRow>
              <InfoRow label="Аудитория">
                {a.classroom ? (
                  <>
                    <RefLink to={ref(`/classrooms/${a.classroom.id}`)}>
                      {a.classroom.code} — {a.classroom.name}
                    </RefLink>{' '}
                    <span className="text-muted-foreground text-xs">
                      ({CLASSROOM_TYPE_LABELS[a.classroom.classroomType] ?? a.classroom.classroomType}, {a.classroom.capacity} мест)
                    </span>
                  </>
                ) : (
                  <span className="text-destructive">не назначена</span>
                )}
              </InfoRow>
              {a.notes && <InfoRow label="Примечание">{a.notes}</InfoRow>}
            </div>

            {canEdit && (
              <div className="flex flex-wrap gap-2">
                {actions.map((x) => (
                  <Button
                    key={x.key}
                    size="sm"
                    variant={panel === x.key ? 'default' : 'outline'}
                    onClick={() => setPanel(panel === x.key ? 'none' : x.key)}
                  >
                    {x.icon} {x.label}
                  </Button>
                ))}
                <Button size="sm" variant="outline" asChild>
                  <Link to={`/calendar?tab=assessments&program=${a.group.educationalProgramId}&semester=${a.semesterItem.semesterId}`}>
                    <CalendarRange /> В редакторе экзаменов
                  </Link>
                </Button>
                <Confirm
                  trigger={
                    <Button size="sm" variant="ghost" className="text-destructive">
                      <Trash2 /> Удалить
                    </Button>
                  }
                  title={`Удалить ${mark.toLowerCase()}?`}
                  description="Мероприятие будет удалено из расписания и из раздела «Экзамены и зачёты»."
                  destructive
                  confirmText="Удалить"
                  onConfirm={() => remove.mutate(undefined)}
                />
              </div>
            )}

            {panel !== 'none' && <Separator />}
            {panel === 'move' && <MovePanel a={a} onDone={refresh} />}
            {panel === 'edit' && <EditPanel a={a} onDone={refresh} />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function useAssessmentPatch(a: AssessmentDetails, success: string, onDone: () => void) {
  return useApiMutation((body: Record<string, unknown>) => api.patch<{ warnings?: string[] }>(`/assessment-events/${a.id}`, body), {
    success,
    invalidate: [['lessons']],
    onSuccess: (r) => {
      for (const w of r.warnings ?? []) toast.warning(w);
      onDone();
    },
  });
}

function MovePanel({ a, onDone }: { a: AssessmentDetails; onDone: () => void }) {
  const settings = useSettings();
  const [date, setDate] = useState(a.date);
  const [lessonNumber, setLessonNumber] = useState(String(a.lessonNumber ?? 1));
  const m = useAssessmentPatch(a, 'Мероприятие перенесено', onDone);
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Новая дата">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Пара">
          <SimpleSelect
            value={lessonNumber}
            onChange={(v) => setLessonNumber(v ?? '1')}
            options={lessonOptions(settings.data?.settings.lessonsPerDay ?? 6)}
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => m.mutate({ date, lessonNumber: Number(lessonNumber) })} disabled={m.isPending}>
          {m.isPending && <Spinner />} Перенести
        </Button>
        <Button variant="outline" onClick={() => m.mutate({ date, lessonNumber: Number(lessonNumber), autoPair: true })} disabled={m.isPending}>
          Первая свободная пара этого дня
        </Button>
      </div>
    </div>
  );
}

function EditPanel({ a, onDone }: { a: AssessmentDetails; onDone: () => void }) {
  const teachers = useTeachers();
  const classrooms = useClassrooms();
  const [teacherId, setTeacherId] = useState<string | null>(a.teacher?.id ?? null);
  const [classroomId, setClassroomId] = useState<string | null>(a.classroom?.id ?? null);
  const [notes, setNotes] = useState(a.notes ?? '');
  const m = useAssessmentPatch(a, 'Изменения сохранены', onDone);
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
      </div>
      <Field label="Примечание">
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div>
        <Button onClick={() => m.mutate({ teacherId, classroomId, notes: notes || null })} disabled={m.isPending}>
          {m.isPending && <Spinner />} Сохранить
        </Button>
      </div>
    </div>
  );
}
