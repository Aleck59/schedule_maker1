import { groupDailyLimit } from './groups';

describe('groupDailyLimit', () => {
  it('берёт число пар из режима группы «с–по»', () => {
    expect(groupDailyLimit({ firstLessonNumber: 1, lastLessonNumber: 3 }, 7, 5)).toBe(3);
    expect(groupDailyLimit({ firstLessonNumber: 4, lastLessonNumber: null }, 7, 5)).toBe(4);
  });

  it('без ограничения группы — общее значение', () => {
    expect(groupDailyLimit({ firstLessonNumber: null, lastLessonNumber: null }, 7, 5)).toBe(5);
  });
});
