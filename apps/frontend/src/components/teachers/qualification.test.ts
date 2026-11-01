import { describe, expect, it } from 'vitest';
import { addDays, today } from '@/lib/format';
import { allowedLevelsOf } from '@/lib/labels';
import { employmentState, qualificationLine } from './qualification';

const base = { educationLevel: null, academicDegree: 'NONE', academicTitle: 'NONE', teachableLevels: [] as string[] };

describe('уровни, у которых преподаватель может вести занятия', () => {
  it('по образованию: бакалавр — только СПО, магистр — СПО и бакалавриат, специалист — и специалитет', () => {
    expect(allowedLevelsOf({ ...base, educationLevel: 'BACHELOR' })).toEqual(['SPO']);
    expect(allowedLevelsOf({ ...base, educationLevel: 'MASTER' })).toEqual(['SPO', 'BACHELOR']);
    expect(allowedLevelsOf({ ...base, educationLevel: 'SPECIALIST' })).toEqual(['SPO', 'BACHELOR', 'SPECIALIST']);
  });

  it('учёная степень или звание снимают ограничение; ручная настройка важнее всего', () => {
    expect(allowedLevelsOf({ ...base, educationLevel: 'BACHELOR', academicDegree: 'CANDIDATE' })).toHaveLength(5);
    expect(allowedLevelsOf({ ...base, educationLevel: 'MASTER', teachableLevels: ['MASTER', 'SPO'] })).toEqual(['SPO', 'MASTER']);
    expect(allowedLevelsOf(base)).toHaveLength(5);
  });
});

describe('карточка преподавателя', () => {
  it('строка квалификации не повторяет звание, совпадающее с должностью', () => {
    expect(qualificationLine({ position: 'Доцент', academicDegree: 'CANDIDATE', academicTitle: 'DOCENT' })).toBe('Доцент · кандидат наук');
    expect(qualificationLine({ position: null, academicDegree: 'NONE', academicTitle: 'PROFESSOR' })).toBe('Преподаватель · звание: профессор');
  });

  it('состояние работы: выходит позже, работает до даты, договор завершён', () => {
    const t = { isActive: true, employedFrom: null, employedTo: null };
    expect(employmentState(t).label).toBe('Работает');
    expect(employmentState({ ...t, employedFrom: addDays(today(), 10) }).variant).toBe('warning');
    expect(employmentState({ ...t, employedTo: addDays(today(), -1) }).label).toMatch(/^Работа завершена/);
    expect(employmentState({ ...t, isActive: false }).label).toBe('Не активен');
  });
});
