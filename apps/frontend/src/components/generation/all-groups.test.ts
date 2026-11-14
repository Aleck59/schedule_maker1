import { describe, expect, it } from 'vitest';
import { educationLevelByCode } from '@/lib/labels';
import type { AllGroupsPlanRow } from '@/lib/types';
import { filterPlan, levelCounts, levelsOf } from './all-groups';

const row = (groupCode: string, educationLevel: AllGroupsPlanRow['educationLevel']): AllGroupsPlanRow => ({
  groupId: groupCode,
  groupCode,
  programId: 'p',
  programTitle: 'План',
  specialty: '00.00.00',
  educationLevel,
  studyForm: 'FULL_TIME',
  included: true,
  semesterId: 's',
  semesterNumber: 1,
  periodId: null,
  periodTitle: 'Период',
  createPeriod: true,
  reason: null,
});

describe('расписание для всех групп', () => {
  it('сводка по уровням: магистратура видна отдельно', () => {
    const rows = [row('ЭК-26-1м', 'MASTER'), row('ИСП-25-1', 'SPO'), row('ИСП-25-2', 'SPO'), { ...row('ЮР-20-1', 'BACHELOR'), included: false }];
    expect(levelCounts(rows)).toEqual([
      { level: 'SPO', count: 2 },
      { level: 'MASTER', count: 1 },
    ]);
  });

  it('фильтр по уровню образования', () => {
    const rows = [row('ИСП-25-1', 'SPO'), row('ЮР-25-1', 'BACHELOR'), row('ЭК-26-1м', 'MASTER')];
    expect(filterPlan(rows, 'ALL').map((r) => r.groupCode)).toEqual(['ИСП-25-1', 'ЮР-25-1', 'ЭК-26-1м']);
    expect(filterPlan(rows, 'SPO').map((r) => r.groupCode)).toEqual(['ИСП-25-1']);
    expect(filterPlan(rows, 'HIGHER').map((r) => r.groupCode)).toEqual(['ЮР-25-1', 'ЭК-26-1м']);
    expect(levelsOf('ALL')).toBeUndefined();
  });

  it('уровень образования по коду специальности', () => {
    expect(educationLevelByCode('09.02.07')).toBe('SPO');
    expect(educationLevelByCode('40.03.01')).toBe('BACHELOR');
    expect(educationLevelByCode('38.04.01')).toBe('MASTER');
    expect(educationLevelByCode('31.05.01')).toBe('SPECIALIST');
    expect(educationLevelByCode('нет')).toBe('SPO');
  });
});
