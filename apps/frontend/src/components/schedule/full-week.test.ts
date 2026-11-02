import { describe, expect, it } from 'vitest';
import type { Lesson } from '@/lib/types';
import { buildRowSegments, indexLessons } from './full-week';

let seq = 0;
function lesson(groupId: string, over: Partial<Lesson> & { name?: string } = {}): Lesson {
  const { name = 'Математика', ...rest } = over;
  return {
    id: `l${++seq}`,
    date: '2026-11-02',
    lessonNumber: 1,
    studentGroupId: groupId,
    subgroupNumber: null,
    teacherId: 't1',
    classroomId: 'c1',
    lessonType: 'LECTURE',
    status: 'PLANNED',
    streamKey: null,
    semesterItem: { curriculumItem: { name } },
    ...rest,
  } as Lesson;
}

describe('полное расписание недели', () => {
  it('соседние группы с парой потока сливаются в одну ячейку', () => {
    const index = indexLessons([
      lesson('A', { streamKey: 's1' }),
      lesson('B', { streamKey: 's1' }),
      lesson('C', { streamKey: 's2', teacherId: 't2' }),
    ]);
    const segs = buildRowSegments(['A', 'B', 'C', 'D'], '2026-11-02', 1, index);
    expect(segs.map((s) => s.groupIds)).toEqual([['A', 'B'], ['C'], ['D']]);
    expect(segs[0].lessons).toHaveLength(1);
    expect(segs[0].allLessons).toHaveLength(2);
  });

  it('одинаковая пара без потока (тот же преподаватель, дисциплина, аудитория) тоже объединяется', () => {
    const index = indexLessons([lesson('A'), lesson('B'), lesson('C', { classroomId: 'c2' })]);
    const segs = buildRowSegments(['A', 'B', 'C'], '2026-11-02', 1, index);
    expect(segs.map((s) => s.groupIds)).toEqual([['A', 'B'], ['C']]);
  });

  it('пустые ячейки и группы не по соседству не объединяются, перенесённые пары скрыты', () => {
    const index = indexLessons([
      lesson('A', { streamKey: 's1' }),
      lesson('C', { streamKey: 's1' }),
      lesson('B', { status: 'MOVED' }),
    ]);
    const segs = buildRowSegments(['A', 'B', 'C', 'D', 'E'], '2026-11-02', 1, index);
    expect(segs.map((s) => s.groupIds)).toEqual([['A'], ['B'], ['C'], ['D'], ['E']]);
    expect(segs[1].lessons).toHaveLength(0);
  });
});
