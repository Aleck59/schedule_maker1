import { useEffect, useMemo, useState } from 'react';
import { Field } from '@/components/common/field';
import { SimpleSelect } from '@/components/common/simple-select';
import { Spinner } from '@/components/common/states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useClassrooms, useGroups, useSettings, useTeachers } from '@/hooks/use-reference';
import { api } from '@/lib/api';
import { CLASSROOM_TYPE_LABELS, LESSON_TYPE_LABELS } from '@/lib/labels';
import { useApi, useApiMutation } from '@/lib/query';
import type { Assignment, SchedulePeriod, SemesterItem, ValidationIssue } from '@/lib/types';
import { issuesFromError, IssuesList } from './issues-list';

/** Создание дополнительного занятия с мгновенной проверкой конфликтов */
export function CreateLessonDialog({
  open,
  onOpenChange,
  period,
  initial,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  period: SchedulePeriod | undefined;
  initial?: { date?: string; lessonNumber?: number; groupId?: string; teacherId?: string; classroomId?: string };
  onCreated?: () => void;
}) {
  const settings = useSettings();
  const groups = useGroups();
  const teachers = useTeachers();
  const classrooms = useClassrooms();
  const items = useApi<SemesterItem[]>(['semester-items', period?.semesterId], period ? `/semesters/${period.semesterId}/items` : null);
  const [date, setDate] = useState('');
  const [lessonNumber, setLessonNumber] = useState('1');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [subgroup, setSubgroup] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [lessonType, setLessonType] = useState<string>('LECTURE');
  const [teacherId, setTeacherId] = useState<string | null>(null);
  const [classroomId, setClassroomId] = useState<string | null>(null);
  const [hours, setHours] = useState('2');
  const [topic, setTopic] = useState('');
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setDate(initial?.date ?? period?.startDate ?? '');
    setLessonNumber(String(initial?.lessonNumber ?? 1));
    setGroupId(initial?.groupId ?? null);
    setTeacherId(initial?.teacherId ?? null);
    setClassroomId(initial?.classroomId ?? null);
    setSubgroup(null);
    setItemId(null);
    setIssues(null);
    setTopic('');
  }, [open, initial, period]);

  const programGroups = useMemo(
    () => (groups.data ?? []).filter((g) => !period?.semester.program || g.educationalProgramId === period.semester.program.id),
    [groups.data, period],
  );
  const group = programGroups.find((g) => g.id === groupId);
  const assignments = useApi<Assignment[]>(['assignments', groupId, itemId], groupId && itemId ? '/assignments' : null, {
    groupId: groupId ?? undefined,
    semesterItemId: itemId ?? undefined,
  });
  const selectedItem = items.data?.find((i) => i.id === itemId);
  const typeOptions = useMemo(() => {
    if (!selectedItem) return Object.entries(LESSON_TYPE_LABELS).map(([value, label]) => ({ value, label }));
    const map: Array<[string, number]> = [
      ['LECTURE', selectedItem.lectureHours],
      ['PRACTICAL', selectedItem.practicalHours],
      ['LABORATORY', selectedItem.laboratoryHours],
      ['CONSULTATION', selectedItem.consultationHours],
      ['PRACTICE', selectedItem.practiceHours],
    ];
    return [...map.filter(([, h]) => h > 0).map(([t, h]) => ({ value: t, label: `${LESSON_TYPE_LABELS[t]} (${h} ч по плану)` })), { value: 'OTHER', label: 'Другое' }];
  }, [selectedItem]);

  // Подстановка преподавателя из нагрузки
  useEffect(() => {
    const a = assignments.data?.find(
      (x) => (x.lessonType === lessonType || x.lessonType === null) && (x.subgroupNumber ?? null) === (subgroup ? Number(subgroup) : null),
    );
    if (a?.teacher && !teacherId) setTeacherId(a.teacher.id);
  }, [assignments.data, lessonType, subgroup, teacherId]);

  const body = (force: boolean) => ({
    schedulePeriodId: period?.id,
    date,
    lessonNumber: Number(lessonNumber),
    studentGroupId: groupId,
    subgroupNumber: subgroup ? Number(subgroup) : null,
    semesterCurriculumItemId: itemId,
    lessonType,
    teacherId,
    classroomId,
    academicHours: Number(hours),
    topic: topic || undefined,
    force,
  });

  const check = useApiMutation(
    () =>
      api.post<{ ok: boolean; issues: ValidationIssue[] }>('/schedule-lessons/check', {
        ...body(false),
        schedulePeriodId: period?.id,
      }),
    { onSuccess: (r) => setIssues(r.issues) },
  );
  const create = useApiMutation((force: boolean) => api.post('/schedule-lessons', body(force)), {
    success: 'Занятие добавлено',
    invalidate: [['lessons'], ['hour-control']],
    onSuccess: () => {
      onOpenChange(false);
      onCreated?.();
    },
    onError: (e) => {
      const found = issuesFromError(e);
      setIssues(found);
      return !!found;
    },
  });
  const ready = !!(period && date && groupId && itemId && lessonType);
  const errors = issues?.filter((i) => i.severity === 'ERROR') ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Дополнительное занятие</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Дата" required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} min={period?.startDate} max={period?.endDate} />
          </Field>
          <Field label="Пара" required>
            <SimpleSelect
              value={lessonNumber}
              onChange={(v) => setLessonNumber(v ?? '1')}
              options={Array.from({ length: settings.data?.settings.lessonsPerDay ?? 6 }, (_, i) => ({
                value: String(i + 1),
                label: `${i + 1} пара ${settings.data?.lessonTimes[i] ? `(${settings.data.lessonTimes[i].startTime})` : ''}`,
              }))}
            />
          </Field>
          <Field label="Группа" required>
            <SimpleSelect value={groupId} onChange={setGroupId} options={programGroups.map((g) => ({ value: g.id, label: g.code }))} />
          </Field>
          <Field label="Подгруппа">
            <SimpleSelect
              value={subgroup}
              onChange={setSubgroup}
              allowEmpty
              emptyLabel="Вся группа"
              options={(group?.subgroups ?? []).map((s) => ({ value: String(s.number), label: s.name }))}
            />
          </Field>
          <Field label="Дисциплина" required className="sm:col-span-2">
            <SimpleSelect
              value={itemId}
              onChange={setItemId}
              options={(items.data ?? [])
                .filter((i) => i.curriculumItem?.itemType !== 'MODULE')
                .map((i) => ({ value: i.id, label: `${i.curriculumItem?.code} ${i.curriculumItem?.name}` }))}
            />
          </Field>
          <Field label="Вид занятия" required>
            <SimpleSelect value={lessonType} onChange={(v) => setLessonType(v ?? 'LECTURE')} options={typeOptions} />
          </Field>
          <Field label="Академических часов">
            <SimpleSelect
              value={hours}
              onChange={(v) => setHours(v ?? '2')}
              options={[
                { value: '2', label: '2 ч (пара)' },
                { value: '1', label: '1 ч (неполная пара)' },
              ]}
            />
          </Field>
          <Field label="Преподаватель">
            <SimpleSelect
              value={teacherId}
              onChange={setTeacherId}
              allowEmpty
              options={(teachers.data ?? []).filter((t) => t.isActive).map((t) => ({ value: t.id, label: t.fullName }))}
            />
          </Field>
          <Field label="Аудитория">
            <SimpleSelect
              value={classroomId}
              onChange={setClassroomId}
              allowEmpty
              options={(classrooms.data ?? [])
                .filter((c) => c.isActive)
                .map((c) => ({ value: c.id, label: `${c.code} — ${CLASSROOM_TYPE_LABELS[c.classroomType]}, ${c.capacity}` }))}
            />
          </Field>
          <Field label="Тема" className="sm:col-span-2">
            <Input value={topic} onChange={(e) => setTopic(e.target.value)} />
          </Field>
        </div>
        {issues && issues.length > 0 && (
          <Alert variant={errors.length ? 'destructive' : 'warning'}>
            <AlertTitle>{errors.length ? 'Конфликты' : 'Предупреждения'}</AlertTitle>
            <AlertDescription>
              <IssuesList issues={issues} />
            </AlertDescription>
          </Alert>
        )}
        {issues && issues.length === 0 && (
          <Alert variant="success">
            <AlertDescription>Конфликтов не обнаружено</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => check.mutate(undefined)} disabled={!ready || check.isPending}>
            {check.isPending && <Spinner />} Проверить
          </Button>
          {errors.length > 0 ? (
            <Button variant="destructive" onClick={() => create.mutate(true)} disabled={!ready || create.isPending}>
              Создать несмотря на конфликты
            </Button>
          ) : (
            <Button onClick={() => create.mutate(false)} disabled={!ready || create.isPending}>
              {create.isPending && <Spinner />} Создать занятие
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
