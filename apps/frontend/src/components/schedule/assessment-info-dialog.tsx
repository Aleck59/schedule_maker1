import { CalendarCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth';
import { formatDate, weekdayName, isoWeekday } from '@/lib/format';
import { ASSESSMENT_MARK, CONTROL_FORM_LABELS } from '@/lib/labels';
import { useApi } from '@/lib/query';

interface AssessmentDetails {
  id: string;
  date: string;
  lessonNumber: number | null;
  controlForm: string;
  notes: string | null;
  time: { startTime: string; endTime: string } | null;
  group: { id: string; code: string; educationalProgramId: string };
  semesterItem: { semesterId: string; curriculumItem: { code: string; name: string } };
  teacher: { id: string; fullName: string } | null;
  classroom: { id: string; code: string; name: string } | null;
}

const EXAMS = ['EXAM', 'QUALIFICATION_EXAM'];

/** Карточка экзамена или зачёта, показанного в сетке расписания */
export function AssessmentInfoDialog({ assessmentId, open, onOpenChange }: { assessmentId: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { canEdit } = useAuth();
  const q = useApi<AssessmentDetails>(['assessment', assessmentId], assessmentId ? `/assessment-events/${assessmentId}` : null, undefined, {
    enabled: open && !!assessmentId,
  });
  const a = q.data;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarCheck className="size-5 text-rose-500" />
            {a ? (ASSESSMENT_MARK[a.controlForm] ?? CONTROL_FORM_LABELS[a.controlForm]) : 'Контрольное мероприятие'}
          </DialogTitle>
          <DialogDescription>Назначено в календарном графике, раздел «Экзамены и зачёты». В часы занятий не входит.</DialogDescription>
        </DialogHeader>
        {q.isLoading || !a ? (
          <LoadingState rows={3} />
        ) : (
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-base font-semibold">{a.semesterItem.curriculumItem.name}</div>
              <div className="text-muted-foreground">{a.semesterItem.curriculumItem.code}</div>
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-y-1.5">
              <span className="text-muted-foreground">Форма</span>
              <span>
                <Badge variant={EXAMS.includes(a.controlForm) ? 'destructive' : 'secondary'}>{CONTROL_FORM_LABELS[a.controlForm]}</Badge>
              </span>
              <span className="text-muted-foreground">Дата</span>
              <span>
                {weekdayName(isoWeekday(a.date))}, {formatDate(a.date)}
              </span>
              <span className="text-muted-foreground">Пара</span>
              <span>
                {a.lessonNumber ?? '—'}
                {a.time ? ` (${a.time.startTime}–${a.time.endTime})` : ''}
              </span>
              <span className="text-muted-foreground">Группа</span>
              <span>{a.group.code}</span>
              <span className="text-muted-foreground">Преподаватель</span>
              <span>{a.teacher?.fullName ?? 'не назначен'}</span>
              <span className="text-muted-foreground">Аудитория</span>
              <span>{a.classroom ? `${a.classroom.code} — ${a.classroom.name}` : 'не назначена'}</span>
              {a.notes && (
                <>
                  <span className="text-muted-foreground">Примечание</span>
                  <span>{a.notes}</span>
                </>
              )}
            </div>
            {canEdit && (
              <Button variant="outline" asChild className="w-full">
                <Link to={`/calendar?tab=assessments&program=${a.group.educationalProgramId}&semester=${a.semesterItem.semesterId}`}>
                  Открыть в редакторе экзаменов
                </Link>
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
