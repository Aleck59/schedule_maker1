import { describe, expect, it } from 'vitest';
import type { Assignment, SemesterItem } from '@/lib/types';
import { contactHours, featuresText, hoursText, isDefaultLessons, lessonsText } from './format';

const item = (over: Partial<SemesterItem> = {}) =>
  ({
    lectureHours: 18,
    practicalHours: 36,
    laboratoryHours: 0,
    consultationHours: 2,
    practiceHours: 72,
    practiceAtCollege: false,
    ...over,
  }) as SemesterItem;

const assignment = (over: Partial<Assignment> = {}) =>
  ({ lessonType: null, subgroupNumber: null, weeklyLessonTarget: null, streamKey: null, preferredClassroom: null, classroomTypes: [], allowHoursExcess: false, ...over }) as Assignment;

describe('строки таблицы нагрузки', () => {
  it('часы по видам занятий; практика — только на базе организации', () => {
    expect(hoursText(item())).toBe('Л 18 · П 36 · Конс 2');
    expect(hoursText(item({ practiceAtCollege: true }))).toBe('Л 18 · П 36 · Конс 2 · Практ 72');
    expect(contactHours(item())).toBe(56);
    expect(contactHours(item({ practiceAtCollege: true }))).toBe(128);
  });

  it('вид занятий и подгруппа; «все виды, вся группа» — назначение по умолчанию', () => {
    expect(lessonsText(assignment())).toBe('все виды');
    expect(isDefaultLessons(assignment())).toBe(true);
    expect(lessonsText(assignment({ lessonType: 'LABORATORY', subgroupNumber: 2 }))).toBe('Лабораторное · п/г 2');
    expect(isDefaultLessons(assignment({ subgroupNumber: 1 }))).toBe(false);
  });

  it('особенности — только заданные вручную', () => {
    expect(featuresText(assignment())).toBe('');
    expect(
      featuresText(
        assignment({ weeklyLessonTarget: 2, streamKey: 'ИСП-24', preferredClassroom: { id: 'r', code: '2-15', name: 'Лаб' }, allowHoursExcess: true }),
      ),
    ).toBe('2 пары/нед · поток ИСП-24 · ауд. 2-15 · превышение разрешено');
  });
});
