import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatDate, isoWeekday } from '@/lib/format';
import { useApiMutation } from '@/lib/query';
import type { Lesson, ValidationIssue } from '@/lib/types';
import { issuesFromError, IssuesList } from './issues-list';

interface MoveVars {
  lesson: Lesson;
  date: string;
  lessonNumber: number;
  force?: boolean;
}

/**
 * Перенос занятия перетаскиванием: карточка сразу встаёт в новую ячейку (оптимистично),
 * при конфликтах — возвращается и показывается панель «Перенести всё равно».
 */
export function useLessonMove(onMoved?: () => void) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<(MoveVars & { issues: ValidationIssue[] }) | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['lessons'] });
    void qc.invalidateQueries({ queryKey: ['hour-control'] });
    void qc.invalidateQueries({ queryKey: ['validation'] });
  };

  const mutation = useApiMutation(
    (vars: MoveVars) =>
      api.post(`/schedule-lessons/${vars.lesson.id}/move`, {
        date: vars.date,
        lessonNumber: vars.lessonNumber,
        force: vars.force,
      }),
    {
      success: (r) => {
        const together = (r as { movedTogether?: string[] }).movedTogether;
        return together?.length ? `Пара потока перенесена вместе с группами: ${together.join(', ')}` : 'Занятие перенесено';
      },
      onSuccess: () => {
        setPending(null);
        refresh();
        onMoved?.();
      },
      onError: (e, vars) => {
        refresh();
        const issues = issuesFromError(e);
        if (issues) {
          setPending({ ...vars, issues });
          return true;
        }
        return false;
      },
    },
  );

  const move = (vars: MoveVars) => {
    // Ставим карточку на новое место сразу, не дожидаясь ответа сервера; пары потока переезжают вместе
    const src = vars.lesson;
    const moves = (l: Lesson) =>
      l.id === src.id || (!!src.streamKey && l.streamKey === src.streamKey && l.date === src.date && l.lessonNumber === src.lessonNumber);
    qc.setQueriesData({ queryKey: ['lessons'] }, (old: unknown) =>
      Array.isArray(old)
        ? (old as Lesson[]).map((l) => (moves(l) ? { ...l, date: vars.date, lessonNumber: vars.lessonNumber, weekday: isoWeekday(vars.date) } : l))
        : old,
    );
    mutation.mutate(vars);
  };

  const panel = pending ? (
    <Card className="border-destructive/40 animate-fade-in fixed right-4 bottom-4 z-40 w-[min(420px,calc(100vw-2rem))] shadow-xl">
      <CardHeader>
        <CardTitle className="text-base">Перенос: обнаружены конфликты</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm">
          «{pending.lesson.semesterItem.curriculumItem.name}» → {formatDate(pending.date)}, {pending.lessonNumber} пара
        </div>
        <IssuesList issues={pending.issues} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setPending(null)}>
            Отмена
          </Button>
          <Button
            variant="destructive"
            disabled={mutation.isPending}
            onClick={() => move({ lesson: pending.lesson, date: pending.date, lessonNumber: pending.lessonNumber, force: true })}
          >
            Перенести всё равно
          </Button>
        </div>
      </CardContent>
    </Card>
  ) : null;

  return { move, panel, isPending: mutation.isPending };
}
