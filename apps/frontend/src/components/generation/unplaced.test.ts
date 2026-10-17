import { describe, expect, it } from 'vitest';
import type { UnplacedItem } from '@/lib/types';
import { byTeacher, groupUnplaced } from './unplaced';

const item = (id: string, code: string, teacher: string | null, lessons: number, group = 'ФИЛ-25-1з'): UnplacedItem => ({
  demandId: id,
  groupCodes: [group],
  subgroupNumber: null,
  disciplineName: id,
  itemCode: 'Б1.О.01',
  lessonType: 'LECTURE',
  teacherName: teacher,
  lessonsRequired: 4,
  lessonsUnplaced: lessons,
  hoursUnplaced: lessons * 2,
  reasons: [{ code, message: code }],
  suggestions: [`совет ${code}`],
});

describe('непоставленные занятия', () => {
  const items = [
    item('a', 'TEACHER_LIMIT', 'Дубнова', 2),
    item('b', 'TEACHER_LIMIT', 'Дубнова', 1, 'ФИЛ-24-2з'),
    item('c', 'TEACHER_LIMIT', 'Туманова', 10, 'ИСП-24-1'),
    item('d', 'NO_TEACHER', null, 3),
  ];

  it('группируются по причине, самые массовые — первыми, с подписью и советом', () => {
    const groups = groupUnplaced(items);
    expect(groups.map((g) => [g.code, g.lessons])).toEqual([
      ['TEACHER_LIMIT', 13],
      ['NO_TEACHER', 3],
    ]);
    expect(groups[0].title).toBe('Лимит нагрузки преподавателя');
    expect(groups[0].suggestion).toBe('совет TEACHER_LIMIT');
  });

  it('внутри причины — по преподавателям с числом пар и группами', () => {
    const teachers = byTeacher(groupUnplaced(items)[0].items);
    expect(teachers.map((t) => [t.name, t.lessons, t.items.length])).toEqual([
      ['Туманова', 10, 1],
      ['Дубнова', 3, 2],
    ]);
    expect(teachers[1].groups).toEqual(['ФИЛ-25-1з', 'ФИЛ-24-2з']);
    expect(byTeacher([items[3]])[0].name).toBe('Преподаватель не назначен');
  });
});
