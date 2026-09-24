import { Lock, Repeat2, UserRoundCog } from 'lucide-react';
import { shortName } from '@/lib/format';
import { LESSON_STATUS_LABELS, LESSON_TYPE_SHORT } from '@/lib/labels';
import type { Lesson } from '@/lib/types';
import { cn } from '@/lib/utils';

export type GridMode = 'group' | 'teacher' | 'classroom' | 'day';

const TYPE_BORDER: Record<string, string> = {
  LECTURE: 'border-l-blue-500',
  PRACTICAL: 'border-l-emerald-500',
  LABORATORY: 'border-l-violet-500',
  CONSULTATION: 'border-l-amber-500',
  PRACTICE: 'border-l-orange-500',
  OTHER: 'border-l-slate-400',
};

const STATUS_BG: Record<string, string> = {
  PLANNED: 'bg-card',
  CONDUCTED: 'bg-emerald-50 dark:bg-emerald-950/30',
  CANCELLED: 'bg-red-50 dark:bg-red-950/30 opacity-80',
  MOVED: 'bg-muted opacity-60',
  REPLACED: 'bg-amber-50 dark:bg-amber-950/30',
};

export function LessonCard({
  lesson,
  mode,
  onClick,
  selected,
  onSelect,
  className,
  dragHandleProps,
}: {
  lesson: Lesson;
  mode: GridMode;
  onClick?: () => void;
  selected?: boolean;
  onSelect?: () => void;
  className?: string;
  dragHandleProps?: Record<string, unknown>;
}) {
  const inactive = lesson.status === 'CANCELLED' || lesson.status === 'MOVED';
  const partial = lesson.academicHours === 1;
  const second =
    mode === 'group' || mode === 'day'
      ? shortName(lesson.teacher?.fullName)
      : `${lesson.studentGroup.code}${lesson.subgroupNumber ? ` · п/г ${lesson.subgroupNumber}` : ''}`;
  const room = mode === 'classroom' ? shortName(lesson.teacher?.fullName) : (lesson.classroom?.code ?? 'без ауд.');
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
      className={cn(
        'group relative w-full min-w-0 cursor-pointer rounded-md border border-l-[3px] px-1.5 py-1 text-left text-[11px] leading-tight shadow-xs transition hover:shadow-md',
        TYPE_BORDER[lesson.lessonType],
        STATUS_BG[lesson.status],
        selected && 'ring-primary ring-2',
        className,
      )}
      title={`${lesson.semesterItem.curriculumItem.name} — ${LESSON_STATUS_LABELS[lesson.status]}`}
      {...dragHandleProps}
    >
      {onSelect && (
        <input
          type="checkbox"
          checked={!!selected}
          onChange={onSelect}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-1 right-1 size-3 cursor-pointer"
          aria-label="Выбрать занятие"
        />
      )}
      <div className={cn('line-clamp-2 pr-3 font-semibold', inactive && 'line-through')}>
        {lesson.semesterItem.curriculumItem.name}
      </div>
      <div className="text-muted-foreground mt-0.5 flex items-center gap-1">
        <span className="font-medium">{LESSON_TYPE_SHORT[lesson.lessonType]}</span>
        {lesson.subgroupNumber && (mode === 'group' || mode === 'day') && <span>· п/г {lesson.subgroupNumber}</span>}
        {partial && <span className="rounded bg-amber-200 px-1 text-[10px] text-amber-900">1 ч</span>}
        {lesson.isLocked && <Lock className="size-3" />}
        {lesson.originalLessonId && <Repeat2 className="size-3" aria-label="Перенос/отработка" />}
        {lesson.substitution && <UserRoundCog className="size-3 text-amber-600" aria-label="Замена" />}
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-1">
        <span className={cn('truncate', inactive && 'line-through')}>{second}</span>
        <span className="text-muted-foreground shrink-0 font-medium">{room}</span>
      </div>
      {lesson.status !== 'PLANNED' && (
        <div
          className={cn(
            'mt-0.5 text-[10px] font-semibold',
            lesson.status === 'CONDUCTED' && 'text-emerald-700 dark:text-emerald-400',
            lesson.status === 'CANCELLED' && 'text-red-700 dark:text-red-400',
            lesson.status === 'REPLACED' && 'text-amber-700 dark:text-amber-400',
            lesson.status === 'MOVED' && 'text-muted-foreground',
          )}
        >
          {LESSON_STATUS_LABELS[lesson.status]}
          {lesson.conducted?.status === 'CONDUCTED' && lesson.conducted.actualHours < lesson.academicHours && ' частично'}
        </div>
      )}
    </div>
  );
}

export function LessonTypeLegend() {
  const items = [
    ['LECTURE', 'Лекция', 'bg-blue-500'],
    ['PRACTICAL', 'Практическое', 'bg-emerald-500'],
    ['LABORATORY', 'Лабораторное', 'bg-violet-500'],
    ['CONSULTATION', 'Консультация', 'bg-amber-500'],
    ['PRACTICE', 'Практика', 'bg-orange-500'],
  ];
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
      {items.map(([key, text, color]) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          <span className={cn('size-2.5 rounded-sm', color)} />
          {text}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm border bg-emerald-100" /> Проведено
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm border bg-red-100" /> Отменено
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm border bg-amber-100" /> Замена
      </span>
    </div>
  );
}
