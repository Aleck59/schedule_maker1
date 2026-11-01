import { EducationLevel } from '@prisma/client';
import { educationLevelByCode, isHigherEducation } from './education';

describe('educationLevelByCode', () => {
  it('определяет уровень по второму сегменту кода', () => {
    expect(educationLevelByCode('09.02.07')).toBe(EducationLevel.SPO);
    expect(educationLevelByCode('40.03.01')).toBe(EducationLevel.BACHELOR);
    expect(educationLevelByCode('38.04.01')).toBe(EducationLevel.MASTER);
    expect(educationLevelByCode('31.05.01')).toBe(EducationLevel.SPECIALIST);
    expect(educationLevelByCode('40.06.01')).toBe(EducationLevel.POSTGRADUATE);
  });

  it('по умолчанию — СПО', () => {
    expect(educationLevelByCode('')).toBe(EducationLevel.SPO);
    expect(educationLevelByCode('abc')).toBe(EducationLevel.SPO);
    expect(isHigherEducation(EducationLevel.SPO)).toBe(false);
    expect(isHigherEducation(EducationLevel.BACHELOR)).toBe(true);
  });
});
