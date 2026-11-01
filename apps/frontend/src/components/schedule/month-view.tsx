import { useMemo } from 'react';
import ruLocale from '@fullcalendar/core/locales/ru';
import dayGridPlugin from '@fullcalendar/daygrid';
import FullCalendar from '@fullcalendar/react';
import { LESSON_TYPE_SHORT } from '@/lib/labels';
import type { Lesson } from '@/lib/types';

const TYPE_COLOR: Record<string, string> = {
  LECTURE: '#3b82f6',
  PRACTICAL: '#10b981',
  LABORATORY: '#8b5cf6',
  CONSULTATION: '#f59e0b',
  PRACTICE: '#f97316',
  OTHER: '#64748b',
};

/** Месячный вид расписания (FullCalendar) */
export function MonthView({
  lessons,
  initialDate,
  onLessonClick,
  onDatesChange,
  showGroup,
}: {
  lessons: Lesson[];
  initialDate: string;
  onLessonClick: (lesson: Lesson) => void;
  onDatesChange: (from: string, to: string) => void;
  showGroup?: boolean;
}) {
  const events = useMemo(
    () =>
      lessons.map((l) => ({
        id: l.id,
        start: `${l.date}T${l.startTime}`,
        end: `${l.date}T${l.endTime}`,
        title: `${l.lessonNumber} · ${showGroup ? `${l.studentGroup.code} ` : ''}${l.semesterItem.curriculumItem.name} (${LESSON_TYPE_SHORT[l.lessonType]})`,
        backgroundColor: l.status === 'CANCELLED' ? '#ef4444' : l.status === 'MOVED' ? '#94a3b8' : TYPE_COLOR[l.lessonType],
        textColor: '#fff',
        classNames: l.status === 'CANCELLED' || l.status === 'MOVED' ? ['line-through', 'opacity-70'] : [],
        extendedProps: { lesson: l },
      })),
    [lessons, showGroup],
  );
  return (
    <div className="bg-card rounded-lg border p-3">
      <FullCalendar
        plugins={[dayGridPlugin]}
        initialView="dayGridMonth"
        initialDate={initialDate}
        locale={ruLocale}
        firstDay={1}
        height="auto"
        dayMaxEvents={4}
        displayEventTime={false}
        events={events}
        headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
        eventClick={(info) => onLessonClick(info.event.extendedProps.lesson as Lesson)}
        datesSet={(info) => {
          const to = new Date(info.end.getTime() - 86400000);
          const fmt = (d: Date) =>
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          onDatesChange(fmt(info.start), fmt(to));
        }}
      />
    </div>
  );
}
