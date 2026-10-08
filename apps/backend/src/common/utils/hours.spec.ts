import { LessonType } from '@prisma/client';
import {
  computePlannedLessons,
  hoursForType,
  hoursToLessons,
  nonScheduledHours,
  scheduledPlanHours,
} from './hours';

describe('Расчёт пар по часам', () => {
  it('36 ч лекций и 36 ч практики → 18 + 18 пар, СР и аттестация не ставятся', () => {
    const item = {
      lectureHours: 36,
      practicalHours: 36,
      laboratoryHours: 0,
      consultationHours: 0,
      practiceHours: 0,
      selfStudyHours: 18,
      assessmentHours: 4,
    };
    const planned = computePlannedLessons(item, 2);
    expect(planned.plannedLectureLessons).toBe(18);
    expect(planned.plannedPracticalLessons).toBe(18);
    expect(planned.plannedLectureLessons + planned.plannedPracticalLessons).toBe(36);
    expect(scheduledPlanHours(item)).toBe(72);
    expect(nonScheduledHours(item)).toBe(22);
  });

  it('нечётное число часов даёт неполную пару без потери часов', () => {
    expect(hoursToLessons(35, 2)).toEqual({ lessons: 18, fullLessons: 17, partialHours: 1 });
    expect(hoursToLessons(1, 2)).toEqual({ lessons: 1, fullLessons: 0, partialHours: 1 });
    expect(hoursToLessons(0, 2)).toEqual({ lessons: 0, fullLessons: 0, partialHours: 0 });
  });

  it('учитывает настройку «академических часов в паре»', () => {
    expect(hoursToLessons(36, 3)).toEqual({ lessons: 12, fullLessons: 12, partialHours: 0 });
    expect(hoursToLessons(20, 3).partialHours).toBe(2);
  });

  it('практика в колледже входит в расписание, вне колледжа — нет', () => {
    const base = {
      lectureHours: 0,
      practicalHours: 0,
      laboratoryHours: 0,
      consultationHours: 0,
      practiceHours: 72,
    };
    expect(scheduledPlanHours({ ...base, practiceAtCollege: true })).toBe(72);
    expect(scheduledPlanHours({ ...base, practiceAtCollege: false })).toBe(0);
    expect(hoursForType(base, LessonType.PRACTICE)).toBe(72);
  });

  it('консультации можно исключить из расписания', () => {
    const item = {
      lectureHours: 10,
      practicalHours: 0,
      laboratoryHours: 0,
      consultationHours: 2,
      practiceHours: 0,
    };
    expect(scheduledPlanHours({ ...item, scheduleConsultations: false })).toBe(10);
    expect(scheduledPlanHours(item)).toBe(12);
  });
});
