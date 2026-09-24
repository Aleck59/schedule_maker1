import { useState } from 'react';
import { Download, List, Table2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { EntityWeekSchedule } from '@/components/schedule/entity-week-schedule';
import { LessonDialog } from '@/components/schedule/lesson-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { usePeriods } from '@/hooks/use-reference';
import { downloadFile, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { addDays, formatDate, formatDateLong, isoWeekday, today, weekStart, weekdayName } from '@/lib/format';
import { LESSON_STATUS_LABELS, LESSON_TYPE_LABELS } from '@/lib/labels';
import { useApi } from '@/lib/query';
import type { Lesson } from '@/lib/types';
import { cn } from '@/lib/utils';

export default function MySchedulePage() {
  const { user } = useAuth();
  const periods = usePeriods();
  const [view, setView] = useState<'grid' | 'list'>(() => (typeof window !== 'undefined' && window.innerWidth < 768 ? 'list' : 'grid'));
  const isTeacher = user?.role === 'TEACHER';
  const filter = isTeacher ? { teacherId: user?.teacherId ?? undefined } : { groupId: user?.studentGroupId ?? undefined };
  const entityId = isTeacher ? user?.teacherId : user?.studentGroupId;
  const now = today();
  const period = (periods.data ?? []).find((p) => p.startDate <= now && p.endDate >= now) ?? periods.data?.[0];

  if (!entityId) {
    return (
      <EmptyState
        title="Учётная запись не связана с расписанием"
        description={isTeacher ? 'Обратитесь к администратору, чтобы связать учётную запись с преподавателем' : 'Обратитесь к администратору, чтобы указать вашу группу'}
      />
    );
  }

  const exportPdf = () => {
    if (!period) return;
    const url = isTeacher
      ? `/schedule-periods/${period.id}/export/teacher/${entityId}/pdf`
      : `/schedule-periods/${period.id}/export/group/${entityId}/pdf`;
    downloadFile(url, undefined, 'Расписание.pdf').catch((e) => toast.error(errorMessage(e)));
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Моё расписание"
        description={isTeacher ? user?.teacher?.fullName : `Группа ${user?.studentGroup?.code ?? ''}`}
        actions={
          <>
            <div className="flex rounded-md border p-0.5">
              <Button size="sm" variant={view === 'grid' ? 'secondary' : 'ghost'} onClick={() => setView('grid')}>
                <Table2 /> Сетка
              </Button>
              <Button size="sm" variant={view === 'list' ? 'secondary' : 'ghost'} onClick={() => setView('list')}>
                <List /> Список
              </Button>
            </div>
            {period && (
              <Button variant="outline" onClick={exportPdf}>
                <Download /> PDF
              </Button>
            )}
          </>
        }
      />
      {periods.data && periods.data.length === 0 && (
        <EmptyState title="Расписание ещё не опубликовано" description="Как только диспетчер опубликует расписание, оно появится здесь" />
      )}
      {view === 'grid' ? <EntityWeekSchedule filter={filter} mode={isTeacher ? 'teacher' : 'group'} /> : <DayList filter={filter} isTeacher={isTeacher} />}
    </div>
  );
}

function DayList({ filter, isTeacher }: { filter: { teacherId?: string; groupId?: string }; isTeacher: boolean }) {
  const from = today();
  const to = addDays(weekStart(from), 13);
  const lessons = useApi<Lesson[]>(['lessons', 'my-list', filter, from], '/schedule-lessons', { ...filter, from, to });
  const [lessonId, setLessonId] = useState<string | null>(null);
  if (lessons.isLoading) return <LoadingState rows={6} />;
  if (lessons.error) return <ErrorState error={lessons.error} onRetry={() => lessons.refetch()} />;
  const byDay = new Map<string, Lesson[]>();
  for (const l of lessons.data ?? []) byDay.set(l.date, [...(byDay.get(l.date) ?? []), l]);
  const days = [...byDay.keys()].sort();
  return (
    <div className="space-y-3">
      {days.length === 0 && <EmptyState title="Занятий в ближайшие две недели нет" />}
      {days.map((d) => (
        <Card key={d} className={cn('gap-2 py-3', d === today() && 'border-primary')}>
          <CardHeader className="px-4">
            <CardTitle className="text-base">
              {weekdayName(isoWeekday(d))}, {formatDateLong(d)} {d === today() && <Badge className="ml-2">Сегодня</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 px-4">
            {byDay
              .get(d)!
              .sort((a, b) => a.lessonNumber - b.lessonNumber)
              .map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setLessonId(l.id)}
                  className={cn('hover:bg-muted/50 flex w-full items-start gap-3 rounded-md border p-2 text-left', l.status === 'CANCELLED' && 'opacity-60')}
                >
                  <div className="w-16 shrink-0 text-xs">
                    <div className="font-semibold">{l.lessonNumber} пара</div>
                    <div className="text-muted-foreground">
                      {l.startTime}–{l.endTime}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={cn('text-sm font-medium', l.status === 'CANCELLED' && 'line-through')}>{l.semesterItem.curriculumItem.name}</div>
                    <div className="text-muted-foreground text-xs">
                      {LESSON_TYPE_LABELS[l.lessonType]}
                      {l.subgroupNumber ? ` · подгруппа ${l.subgroupNumber}` : ''} · ауд. {l.classroom?.code ?? '—'} ·{' '}
                      {isTeacher ? l.studentGroup.code : (l.teacher?.fullName ?? 'преподаватель не назначен')}
                      {l.academicHours === 1 && ' · 1 ак. ч (неполная пара)'}
                    </div>
                    {l.originalLesson && (
                      <div className="text-xs text-amber-600">
                        Перенесено с {formatDate(l.originalLesson.date)}, {l.originalLesson.lessonNumber} пара
                      </div>
                    )}
                  </div>
                  {l.status !== 'PLANNED' && (
                    <Badge variant={l.status === 'CONDUCTED' ? 'success' : l.status === 'CANCELLED' ? 'destructive' : 'warning'}>
                      {LESSON_STATUS_LABELS[l.status]}
                    </Badge>
                  )}
                </button>
              ))}
          </CardContent>
        </Card>
      ))}
      <LessonDialog lessonId={lessonId} open={!!lessonId} onOpenChange={(o) => !o && setLessonId(null)} onChanged={() => void lessons.refetch()} />
    </div>
  );
}
