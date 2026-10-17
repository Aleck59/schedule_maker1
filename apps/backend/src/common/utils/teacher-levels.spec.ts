import { AcademicDegree, AcademicTitle, EducationLevel } from '@prisma/client';
import { allowedLevels, levelRestriction } from './teacher-levels';

const base = {
  fullName: 'Иванова И. И.',
  educationLevel: null,
  academicDegree: AcademicDegree.NONE,
  academicTitle: AcademicTitle.NONE,
  teachableLevels: [] as EducationLevel[],
};

describe('допуск преподавателя к уровням образования', () => {
  it('по образованию: бакалавр — СПО, магистр — ещё бакалавриат, но не специалитет', () => {
    expect(allowedLevels({ ...base, educationLevel: 'BACHELOR' })).toEqual(['SPO']);
    expect(allowedLevels({ ...base, educationLevel: 'MASTER' })).toEqual(['SPO', 'BACHELOR']);
    expect(allowedLevels({ ...base, educationLevel: 'SPECIALIST' })).toEqual([
      'SPO',
      'BACHELOR',
      'SPECIALIST',
    ]);
    expect(levelRestriction({ ...base, educationLevel: 'MASTER' }, 'SPECIALIST')).toMatch(/не может вести/);
    expect(levelRestriction({ ...base, educationLevel: 'MASTER' }, 'BACHELOR')).toBeNull();
  });

  it('учёная степень или звание — все уровни; без образования — без ограничений; ручная настройка важнее', () => {
    expect(allowedLevels({ ...base, educationLevel: 'BACHELOR', academicDegree: 'CANDIDATE' })).toContain(
      'MASTER',
    );
    expect(allowedLevels({ ...base, academicTitle: 'DOCENT' })).toHaveLength(5);
    expect(allowedLevels(base)).toHaveLength(5);
    expect(allowedLevels({ ...base, educationLevel: 'HIGHEST', teachableLevels: ['SPO'] })).toEqual(['SPO']);
    expect(levelRestriction({ ...base, teachableLevels: ['SPO'] }, 'BACHELOR')).toMatch(/по настройке/);
  });
});
