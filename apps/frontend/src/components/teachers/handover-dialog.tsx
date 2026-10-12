import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Field } from '@/components/common/field';
import { SimpleSelect } from '@/components/common/simple-select';
import { Spinner } from '@/components/common/states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useTeachers } from '@/hooks/use-reference';
import { api } from '@/lib/api';
import { formatDate, today } from '@/lib/format';
import { allowedLevelsOf, EDUCATION_LEVEL_LABELS } from '@/lib/labels';
import { useApiMutation } from '@/lib/query';
import type { EducationLevel } from '@/lib/types';

export interface HandoverTarget {
  assignmentId: string;
  title: string;
  groupCode: string;
  level: EducationLevel | null;
  currentTeacherId: string | null;
}

interface HandoverResult {
  teacher: { id: string; fullName: string };
  fromDate: string;
  moved: number;
  kept: number;
  conflicts: Array<{ lessonId: string; date: string; lessonNumber: number; group: string; message: string }>;
}

/**
 * Передача нагрузки с даты: новый преподаватель вышел в середине семестра или прежний уволился.
 * Занятия до даты (и проведённые) остаются за прежним — часы в нагрузке делятся между ними.
 */
export function HandoverDialog({ target, onOpenChange }: { target: HandoverTarget | null; onOpenChange: (open: boolean) => void }) {
  const teachers = useTeachers(!!target);
  const [teacherId, setTeacherId] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState(today());
  const [result, setResult] = useState<HandoverResult | null>(null);
  const candidates = (teachers.data ?? []).filter(
    (t) => t.isActive && t.id !== target?.currentTeacherId && (!target?.level || (t.allowedLevels ?? allowedLevelsOf(t)).includes(target.level)),
  );
  const chosen = candidates.find((t) => t.id === teacherId);
  const startsLater = chosen?.employedFrom && chosen.employedFrom.slice(0, 10) > fromDate ? chosen.employedFrom.slice(0, 10) : null;
  const save = useApiMutation(() => api.post<HandoverResult>(`/assignments/${target!.assignmentId}/handover`, { teacherId, fromDate }), {
    success: (r) => `Передано занятий: ${r.moved}. За прежним преподавателем остаётся: ${r.kept}`,
    invalidate: [['teacher'], ['teachers'], ['teacher-workload'], ['lessons'], ['assignments']],
    onSuccess: (r) => {
      if (r.conflicts.length) setResult(r);
      else close(false);
    },
  });
  const close = (open: boolean) => {
    if (!open) {
      setTeacherId(null);
      setFromDate(today());
      setResult(null);
    }
    onOpenChange(open);
  };
  return (
    <Dialog open={!!target} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Передать нагрузку с даты</DialogTitle>
          <DialogDescription>
            {target?.groupCode} · {target?.title}. Занятия с выбранной даты перейдут к новому преподавателю, более ранние и проведённые останутся за прежним; плановые часы
            разделятся между ними.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <Alert variant="warning">
            <AlertTriangle />
            <AlertTitle>
              Передано {result.moved}, но {result.conflicts.length} — с конфликтами
            </AlertTitle>
            <AlertDescription>
              <ul className="mt-1 max-h-48 list-disc space-y-0.5 overflow-y-auto pl-4">
                {result.conflicts.map((c) => (
                  <li key={c.lessonId}>
                    {formatDate(c.date)}, {c.lessonNumber} пара: {c.message}
                  </li>
                ))}
              </ul>
              <p className="mt-2">
                Исправьте их в разделе{' '}
                <Link to="/schedule" className="underline">
                  «Расписание»
                </Link>{' '}
                кнопкой «Проверить» (автоисправление переносит занятия) или пересоставьте расписание группы с {formatDate(result.fromDate)}.
              </p>
            </AlertDescription>
          </Alert>
        ) : (
          <div className="grid gap-3">
            <Field
              label="Новый преподаватель"
              hint={target?.level ? `Только те, кто может вести у групп уровня «${EDUCATION_LEVEL_LABELS[target.level]}»` : undefined}
            >
              <SimpleSelect
                value={teacherId}
                onChange={setTeacherId}
                options={candidates.map((t) => ({ value: t.id, label: `${t.fullName}${t.employedFrom ? ` (с ${formatDate(t.employedFrom)})` : ''}` }))}
                placeholder={teachers.isLoading ? 'Загрузка…' : 'Выберите преподавателя'}
              />
            </Field>
            <Field label="С какой даты" error={startsLater ? `Преподаватель начинает работать с ${formatDate(startsLater)}` : undefined}>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </Field>
            {startsLater && (
              <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setFromDate(startsLater)}>
                Передать с {formatDate(startsLater)}
              </Button>
            )}
          </div>
        )}
        <DialogFooter>
          {result ? (
            <Button onClick={() => close(false)}>Готово</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => close(false)}>
                Отмена
              </Button>
              <Button disabled={!teacherId || !fromDate || !!startsLater || save.isPending} onClick={() => save.mutate(undefined)}>
                {save.isPending && <Spinner />} Передать
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
