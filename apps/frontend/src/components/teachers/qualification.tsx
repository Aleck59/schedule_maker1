import { GraduationCap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ACADEMIC_DEGREE_LABELS, ACADEMIC_TITLE_LABELS, allowedLevelsOf, EDUCATION_LEVEL_LABELS } from '@/lib/labels';
import { addDays, formatDate, today } from '@/lib/format';
import type { Teacher } from '@/lib/types';

/** «Доцент · кандидат наук» — должность, степень и звание одной строкой */
export function qualificationLine(t: Pick<Teacher, 'position' | 'academicDegree' | 'academicTitle'>): string {
  const parts = [t.position || 'Преподаватель'];
  if (t.academicDegree !== 'NONE') parts.push(ACADEMIC_DEGREE_LABELS[t.academicDegree]!.toLowerCase());
  const title = ACADEMIC_TITLE_LABELS[t.academicTitle]!.toLowerCase();
  if (t.academicTitle !== 'NONE' && title !== (t.position ?? '').trim().toLowerCase()) parts.push(`звание: ${title}`);
  return parts.join(' · ');
}

/** Уровни образования, у которых преподаватель может вести занятия */
export function teachesAllLevels(teacher: Teacher) {
  return (teacher.allowedLevels ?? allowedLevelsOf(teacher)).length === Object.keys(EDUCATION_LEVEL_LABELS).length;
}

export function LevelBadges({ teacher, compact }: { teacher: Teacher; compact?: boolean }) {
  const levels = teacher.allowedLevels ?? allowedLevelsOf(teacher);
  const all = levels.length === Object.keys(EDUCATION_LEVEL_LABELS).length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {!compact && <GraduationCap className="text-muted-foreground size-3.5" aria-hidden />}
      {all ? (
        <Badge variant="success">все уровни</Badge>
      ) : (
        levels.map((l) => (
          <Badge key={l} variant="info">
            {EDUCATION_LEVEL_LABELS[l]}
          </Badge>
        ))
      )}
    </div>
  );
}

/** Состояние «работает ли сейчас»: ещё не вышел, уволен, неактивен */
export function employmentState(t: Pick<Teacher, 'isActive' | 'employedFrom' | 'employedTo'>): {
  label: string;
  variant: 'success' | 'warning' | 'muted' | 'destructive';
} {
  const now = today();
  if (!t.isActive) return { label: 'Не активен', variant: 'muted' };
  if (t.employedFrom && t.employedFrom.slice(0, 10) > now) return { label: `Выходит с ${formatDate(t.employedFrom)}`, variant: 'warning' };
  if (t.employedTo && t.employedTo.slice(0, 10) < now) return { label: `Работа завершена ${formatDate(t.employedTo)}`, variant: 'muted' };
  if (t.employedTo) return { label: `Работает до ${formatDate(t.employedTo)}`, variant: 'warning' };
  if (t.employedFrom && t.employedFrom.slice(0, 10) > addDays(now, -60)) return { label: `Работает с ${formatDate(t.employedFrom)}`, variant: 'success' };
  return { label: 'Работает', variant: 'success' };
}
