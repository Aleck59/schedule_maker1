import { CalendarEventType, CurriculumItemType } from '@prisma/client';
import { CalendarContext, ContextGroup, NormalizedEvent } from './calendar-context';

const group: ContextGroup = {
  id: 'g1',
  code: 'ИСП-24-1',
  programId: 'p1',
  courseNumber: 3,
  academicYears: [
    { start: '2025-09-01', end: '2026-08-31', courseNumber: 2 },
    { start: '2026-09-01', end: '2027-08-31', courseNumber: 3 },
  ],
};

function event(partial: Partial<NormalizedEvent>): NormalizedEvent {
  return {
    id: Math.random().toString(36).slice(2),
    eventType: CalendarEventType.OTHER,
    title: 'Событие',
    start: '2025-09-01',
    end: '2025-09-01',
    blocksSchedule: true,
    programId: null,
    groupId: null,
    courseNumber: null,
    teacherId: null,
    ...partial,
  };
}

describe('Календарный контекст', () => {
  const events = [
    event({
      eventType: CalendarEventType.THEORETICAL_TRAINING,
      start: '2025-09-01',
      end: '2025-12-21',
      blocksSchedule: false,
      programId: 'p1',
    }),
    event({ eventType: CalendarEventType.HOLIDAY, start: '2025-11-04', end: '2025-11-04' }),
    event({ eventType: CalendarEventType.VACATION, start: '2025-12-31', end: '2026-01-11', programId: 'p1' }),
    event({
      eventType: CalendarEventType.EDUCATIONAL_PRACTICE,
      start: '2025-10-06',
      end: '2025-10-11',
      programId: 'p1',
    }),
    event({
      eventType: CalendarEventType.EXAM_SESSION,
      start: '2025-10-13',
      end: '2025-10-18',
      programId: 'other',
    }),
    event({ eventType: CalendarEventType.OTHER, start: '2025-10-20', end: '2025-10-25', courseNumber: 1 }),
    event({
      eventType: CalendarEventType.OTHER,
      start: '2025-10-27',
      end: '2025-10-28',
      teacherId: 't1',
      title: 'Курсы',
    }),
  ];
  const ctx = new CalendarContext(events, [1, 2, 3, 4, 5, 6], new Map([[group.id, group]]));

  it('теоретическое обучение не блокирует занятия, выходной — блокирует', () => {
    expect(ctx.isRegularAllowed('g1', '2025-09-01')).toBe(true);
    expect(ctx.isRegularAllowed('g1', '2025-09-07')).toBe(false); // воскресенье
  });

  it('праздники и каникулы блокируют обычные занятия', () => {
    expect(ctx.isRegularAllowed('g1', '2025-11-04')).toBe(false);
    expect(ctx.isRegularAllowed('g1', '2026-01-05')).toBe(false);
  });

  it('в период практики обычные занятия запрещены, а занятия практики разрешены', () => {
    expect(ctx.isRegularAllowed('g1', '2025-10-06')).toBe(false);
    expect(ctx.isPracticeAllowed('g1', '2025-10-06', CurriculumItemType.EDUCATIONAL_PRACTICE)).toBe(true);
    expect(ctx.isPracticeAllowed('g1', '2025-10-06', CurriculumItemType.INDUSTRIAL_PRACTICE)).toBe(false);
    expect(ctx.isPracticeAllowed('g1', '2025-09-02', CurriculumItemType.EDUCATIONAL_PRACTICE)).toBe(false);
  });

  it('события другой программы и другого курса не действуют на группу', () => {
    expect(ctx.isRegularAllowed('g1', '2025-10-13')).toBe(true);
    // Курс группы в 2025/26 учебном году — второй, событие для первого курса не действует
    expect(ctx.isRegularAllowed('g1', '2025-10-20')).toBe(true);
  });

  it('недоступность преподавателя не блокирует группу, но блокирует преподавателя', () => {
    expect(ctx.isRegularAllowed('g1', '2025-10-27')).toBe(true);
    expect(ctx.teacherBlocks('t1', '2025-10-27')).toHaveLength(1);
    expect(ctx.teacherBlocks('t2', '2025-10-27')).toHaveLength(0);
    // Праздник организации блокирует всех преподавателей
    expect(ctx.teacherBlocks('t2', '2025-11-04')).toHaveLength(1);
  });
});
