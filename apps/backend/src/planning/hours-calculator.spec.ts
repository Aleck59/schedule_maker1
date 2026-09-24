import { ConductedStatus, CurriculumItemType, LessonStatus, LessonType } from '@prisma/client';
import { computeStreamHours, hourStatus, LessonForHours, matchLessonsToStreams } from './hours-calculator';
import { DemandStream } from './planning.types';

function stream(partial: Partial<DemandStream>): DemandStream {
  const base: DemandStream = {
    key: '',
    groupId: 'g1',
    groupCode: 'ИСП-24-1',
    programId: 'p1',
    subgroupNumber: null,
    size: 25,
    semesterId: 's3',
    semesterNumber: 3,
    semesterStart: '2025-09-01',
    semesterEnd: '2025-12-31',
    semesterItemId: 'i1',
    curriculumItemId: 'c1',
    itemCode: 'ЕН.01',
    itemName: 'Элементы высшей математики',
    itemType: CurriculumItemType.DISCIPLINE,
    isDifficult: true,
    controlForm: 'EXAM',
    lessonType: LessonType.LECTURE,
    assignmentId: 'a1',
    teacherId: 't1',
    teacherName: 'Иванова',
    plannedHours: 36,
    plannedLessons: 18,
    partialHours: 0,
    weeklyTarget: null,
    priority: 5,
    roomTypes: [],
    preferredClassroomId: null,
    streamKey: null,
    allowHoursExcess: false,
    ...partial,
  };
  base.key = `${base.groupId}|${base.semesterItemId}|${base.lessonType}|${base.subgroupNumber ?? 0}`;
  return base;
}

let seq = 0;
function lesson(partial: Partial<LessonForHours>): LessonForHours {
  return {
    id: `l${++seq}`,
    studentGroupId: 'g1',
    semesterCurriculumItemId: 'i1',
    lessonType: LessonType.LECTURE,
    subgroupNumber: null,
    status: LessonStatus.PLANNED,
    academicHours: 2,
    date: '2025-09-01',
    teacherId: 't1',
    allowHoursExcess: false,
    conducted: null,
    ...partial,
  };
}

describe('Контроль часов', () => {
  it('план / в расписании / проведено / остаток / дефицит', () => {
    const s = stream({});
    const lessons = [
      lesson({
        status: LessonStatus.CONDUCTED,
        conducted: { status: ConductedStatus.CONDUCTED, actualHours: 2, actualTeacherId: 't1' },
      }),
      lesson({
        status: LessonStatus.CONDUCTED,
        conducted: { status: ConductedStatus.CONDUCTED, actualHours: 1, actualTeacherId: 't1' },
      }),
      lesson({
        status: LessonStatus.CANCELLED,
        conducted: { status: ConductedStatus.CANCELLED, actualHours: 0, actualTeacherId: null },
      }),
      lesson({ status: LessonStatus.MOVED }),
      lesson({ date: '2025-10-01' }),
    ];
    const h = computeStreamHours(s, lessons, '2025-09-15');
    expect(h.planned).toBe(36);
    expect(h.scheduled).toBe(6); // 2 проведённых + 1 запланированное; отменённое и перенесённое не считаются
    expect(h.conducted).toBe(3); // частично проведённое засчитано по факту
    expect(h.remaining).toBe(33);
    expect(h.scheduleDeficit).toBe(30);
    expect(h.cancelled).toBe(2);
    expect(h.future).toBe(2);
    expect(hourStatus(h, { start: '2025-09-01', end: '2025-12-31' }, '2025-09-15').status).toBe('DEFICIT');
  });

  it('превышение плана', () => {
    const s = stream({ plannedHours: 4 });
    const lessons = [lesson({}), lesson({}), lesson({})];
    const h = computeStreamHours(s, lessons, '2025-09-01');
    expect(h.excess).toBe(2);
    expect(hourStatus(h, { start: '2025-09-01', end: '2025-12-31' }, '2025-09-01').status).toBe('EXCESS');
  });

  it('занятие всей группы засчитывается подгруппам, если вид занятий делится', () => {
    const s1 = stream({ subgroupNumber: 1, lessonType: LessonType.LABORATORY, plannedHours: 4 });
    const s2 = stream({ subgroupNumber: 2, lessonType: LessonType.LABORATORY, plannedHours: 4 });
    const lessons = [
      lesson({ lessonType: LessonType.LABORATORY, subgroupNumber: null }),
      lesson({ lessonType: LessonType.LABORATORY, subgroupNumber: 1 }),
      lesson({ lessonType: LessonType.OTHER }),
    ];
    const { matched, unmatched } = matchLessonsToStreams([s1, s2], lessons);
    expect(matched.get(s1.key)).toHaveLength(2);
    expect(matched.get(s2.key)).toHaveLength(1);
    expect(unmatched).toHaveLength(1);
  });

  it('риск: есть прошедшие занятия без отметки о проведении', () => {
    const s = stream({ plannedHours: 8 });
    const lessons = [
      lesson({ date: '2025-09-01' }),
      lesson({ date: '2025-09-02' }),
      lesson({ date: '2025-12-01' }),
      lesson({ date: '2025-12-02' }),
    ];
    const h = computeStreamHours(s, lessons, '2025-10-01');
    expect(h.unmarkedPast).toBe(4);
    expect(hourStatus(h, { start: '2025-09-01', end: '2025-12-31' }, '2025-10-01').status).toBe('RISK');
  });
});
