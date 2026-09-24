import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { useSettings } from '@/hooks/use-reference';
import { addDays, formatDate, today, weekStart } from '@/lib/format';
import { useApi } from '@/lib/query';
import type { Lesson } from '@/lib/types';
import { LessonTypeLegend, type GridMode } from './lesson-card';
import { LessonDialog } from './lesson-dialog';
import { ScheduleGrid, weekColumns } from './week-grid';

/** Недельное расписание группы, преподавателя или аудитории (просмотр) */
export function EntityWeekSchedule({
  filter,
  mode,
  initialWeek,
}: {
  filter: { groupId?: string; teacherId?: string; classroomId?: string; periodId?: string };
  mode: GridMode;
  initialWeek?: string;
}) {
  const qc = useQueryClient();
  const settings = useSettings();
  const [week, setWeek] = useState(initialWeek ?? weekStart(today()));
  const [lessonId, setLessonId] = useState<string | null>(null);
  const lessons = useApi<Lesson[]>(['lessons', 'entity', filter, week], '/schedule-lessons', { ...filter, from: week, to: addDays(week, 6) });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => setWeek(addDays(week, -7))} aria-label="Предыдущая неделя">
          <ChevronLeft />
        </Button>
        <span className="min-w-52 text-center text-sm font-medium">
          {formatDate(week)} — {formatDate(addDays(week, 6))}
        </span>
        <Button variant="outline" size="icon" onClick={() => setWeek(addDays(week, 7))} aria-label="Следующая неделя">
          <ChevronRight />
        </Button>
        <Button variant="ghost" onClick={() => setWeek(weekStart(today()))}>
          Текущая неделя
        </Button>
        <span className="text-muted-foreground ml-auto text-xs">Занятий: {lessons.data?.length ?? 0}</span>
      </div>
      {lessons.isLoading ? (
        <LoadingState rows={6} />
      ) : lessons.error ? (
        <ErrorState error={lessons.error} onRetry={() => lessons.refetch()} />
      ) : (
        <ScheduleGrid
          columns={weekColumns(week, settings.data?.settings.workingDays ?? [1, 2, 3, 4, 5, 6])}
          lessonTimes={settings.data?.lessonTimes ?? []}
          lessonsPerDay={settings.data?.settings.lessonsPerDay ?? 6}
          lessons={lessons.data ?? []}
          mode={mode}
          editable={false}
          onLessonClick={(l) => setLessonId(l.id)}
        />
      )}
      <LessonTypeLegend />
      <LessonDialog
        lessonId={lessonId}
        open={!!lessonId}
        onOpenChange={(o) => !o && setLessonId(null)}
        onChanged={() => void qc.invalidateQueries({ queryKey: ['lessons'] })}
      />
    </div>
  );
}
