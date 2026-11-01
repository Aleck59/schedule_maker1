import { describe, expect, it } from 'vitest';
import type { UnplacedItem } from '@/lib/types';
import { byTeacher, combinedPatch, groupUnplaced, quickFixes, type RerunSettings } from './unplaced';

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

describe('быстрые исправления', () => {
  const settings: RerunSettings = {
    timeLimitSeconds: 60,
    lessonsPerDay: 6,
    maxGroupLessonsPerDay: 4,
    maxSameDisciplinePerDay: 2,
    maxSameDisciplinePerWeek: 6,
    avoidWindows: true,
    allowLateLessons: false,
    respectTeacherPreferences: true,
    maximizePlacement: false,
  };

  it('нехватка времени — перезапуск с ослабленными настройками, все сразу одной кнопкой', () => {
    const fixes = quickFixes('NOT_ENOUGH_TIME', settings);
    expect(fixes.map((f) => f.patch)).toEqual([
      { maximizePlacement: true },
      { timeLimitSeconds: 120 },
      { avoidWindows: false },
      { maxGroupLessonsPerDay: 5 },
      { allowLateLessons: true },
    ]);
    expect(combinedPatch(fixes)).toEqual({
      maximizePlacement: true,
      timeLimitSeconds: 120,
      avoidWindows: false,
      maxGroupLessonsPerDay: 5,
      allowLateLessons: true,
    });
  });

  it('уже ослабленные настройки не предлагаются повторно', () => {
    const fixes = quickFixes('NOT_ENOUGH_TIME', {
      ...settings,
      timeLimitSeconds: 3600,
      avoidWindows: false,
      allowLateLessons: true,
      maxGroupLessonsPerDay: 6,
      maximizePlacement: true,
    });
    expect(fixes).toEqual([]);
  });

  it('нет преподавателя — переход к нагрузке, без перезапуска', () => {
    const fixes = quickFixes('NO_TEACHER', settings);
    expect(fixes).toEqual([expect.objectContaining({ to: '/workload' })]);
    expect(combinedPatch(fixes)).toBeNull();
  });
});
