import { SlotBook } from './assessment-slots';

describe('SlotBook', () => {
  it('не даёт преподавателю принимать две группы в одну пару', () => {
    const book = new SlotBook();
    book.take({ teacherKeys: ['t1'], groupId: 'g1' }, '2028-04-03', 1);
    expect(book.teacherFree(['t1'], '2028-04-03', 1)).toBe(false);
    expect(book.teacherFree(['t1'], '2028-04-03', 2)).toBe(true);
    expect(book.teacherFree(['t2'], '2028-04-03', 1)).toBe(true);
    expect(book.groupFree('g1', '2028-04-03', 1)).toBe(false);
  });

  it('одноимённые мероприятия не совпадают, даже если преподаватель не назначен', () => {
    const book = new SlotBook();
    book.take({ teacherKeys: ['t1', 'd:Математика'], groupId: 'g1' }, '2028-04-03', 1);
    expect(book.teacherFree(['d:Математика'], '2028-04-03', 1)).toBe(false);
    expect(book.teacherFree(['t2', 'd:Физика'], '2028-04-03', 1)).toBe(true);
  });

  it('занимает аудиторию', () => {
    const book = new SlotBook();
    book.take({ teacherKeys: ['t1'], classroomId: 'r1', groupId: 'g1' }, '2028-04-03', 2);
    expect(book.roomFree('r1', '2028-04-03', 2)).toBe(false);
    expect(book.roomFree('r1', '2028-04-03', 3)).toBe(true);
  });

  it('зачёт можно поставить на последнее занятие той же дисциплины, но не на чужое', () => {
    const book = new SlotBook();
    book.takeLesson({ teacherKey: 't1', classroomId: 'r1', groupId: 'g1', itemId: 'i1' }, '2028-04-03', 2);
    const own = { groupId: 'g1', itemId: 'i1' };
    expect(book.teacherFree(['t1'], '2028-04-03', 2, own)).toBe(true);
    expect(book.groupFree('g1', '2028-04-03', 2, own)).toBe(true);
    expect(book.teacherFree(['t1'], '2028-04-03', 2, { groupId: 'g2', itemId: 'i1' })).toBe(false);
    expect(book.groupFree('g1', '2028-04-03', 2, { groupId: 'g1', itemId: 'i2' })).toBe(false);
    expect(book.groupFree('g1', '2028-04-03', 2, { groupId: 'g1', itemId: 'i2' }, true)).toBe(true);
  });

  it('мероприятие поверх занятия занимает слот целиком', () => {
    const book = new SlotBook();
    const own = { groupId: 'g1', itemId: 'i1' };
    book.takeLesson({ teacherKey: 't1', classroomId: null, groupId: 'g1', itemId: 'i1' }, '2028-04-03', 2);
    book.take({ teacherKeys: ['t1'], groupId: 'g1' }, '2028-04-03', 2);
    expect(book.teacherFree(['t1'], '2028-04-03', 2, own)).toBe(false);
    expect(book.groupFree('g1', '2028-04-03', 2, own, true)).toBe(false);
  });
});
