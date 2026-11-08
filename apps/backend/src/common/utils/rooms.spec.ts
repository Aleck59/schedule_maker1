import { ClassroomType } from '@prisma/client';
import { rankRooms, roomsForDiscipline, roomTags, tagMatches } from './rooms';

const room = (id: string, classroomType: ClassroomType, capacity = 30) => ({
  id,
  code: id,
  classroomType,
  capacity,
});

describe('rankRooms: тип аудитории — предпочтение', () => {
  const rooms = [
    room('101', ClassroomType.GENERAL),
    room('102', ClassroomType.GENERAL),
    room('pc', ClassroomType.COMPUTER_LAB),
    room('gym', ClassroomType.SPORTS_HALL, 100),
    room('web', ClassroomType.ONLINE, 0),
    room('small', ClassroomType.GENERAL, 10),
  ];

  it('компьютерный класс первым, затем обычные кабинеты как запасные', () => {
    const r = rankRooms(rooms, [ClassroomType.COMPUTER_LAB], 25);
    expect(r.rooms.map((x) => x.id)).toEqual(['pc', '101', '102']);
    expect(r.matching).toBe(1);
  });

  it('обычные занятия могут пойти и в компьютерный класс, но после учебных', () => {
    const r = rankRooms(rooms, [ClassroomType.GENERAL, ClassroomType.LECTURE], 25);
    expect(r.rooms.map((x) => x.id)).toEqual(['101', '102', 'pc']);
    expect(r.matching).toBe(2);
  });

  it('спортзал и онлайн не становятся запасными', () => {
    const r = rankRooms(rooms, [ClassroomType.SPORTS_HALL], 25);
    expect(r.rooms.map((x) => x.id)).toEqual(['gym', '101', '102', 'pc']);
  });
});

describe('rankRooms: предпочтительная аудитория и метки', () => {
  const rooms = [
    room('101', ClassroomType.GENERAL),
    room('102', ClassroomType.GENERAL),
    room('pc', ClassroomType.COMPUTER_LAB),
    room('gym', ClassroomType.SPORTS_HALL, 100),
  ];

  it('предпочтительная аудитория первой, даже другого типа', () => {
    const r = rankRooms(rooms, [ClassroomType.GENERAL], 25, 'gym');
    expect(r.rooms.map((x) => x.id)).toEqual(['gym', '101', '102', 'pc']);
    expect(r.matching).toBe(3);
  });

  it('аудитории по меткам — сразу после предпочтительной и считаются подходящими', () => {
    const r = rankRooms(rooms, [ClassroomType.GENERAL], 25, null, new Set(['pc']));
    expect(r.rooms.map((x) => x.id)).toEqual(['pc', '101', '102']);
    expect(r.matching).toBe(3);
  });
});

describe('метки аудиторий', () => {
  it('слова сравниваются без окончаний', () => {
    expect(tagMatches('право', 'Гражданское право')).toBe(true);
    expect(tagMatches('право', 'Правовое обеспечение профессиональной деятельности')).toBe(true);
    expect(tagMatches('Иностранный язык', 'Иностранный язык в профессиональной деятельности')).toBe(true);
    expect(tagMatches('англ', 'Иностранный язык (английский)')).toBe(true);
    expect(tagMatches('физра', 'Физическая культура')).toBe(true);
    expect(tagMatches('право', 'Математика')).toBe(false);
    expect(tagMatches('Иностранный язык', 'Русский язык')).toBe(false);
  });

  it('код сравнивается с началом кода дисциплины', () => {
    expect(tagMatches('ОП.01', 'Что угодно', 'ОП.01')).toBe(true);
    expect(tagMatches('МДК.02', 'Что угодно', 'МДК.02.01')).toBe(true);
    expect(tagMatches('ОП.01', 'Что угодно', 'ОП.02')).toBe(false);
  });

  it('спортзал без меток — для физической культуры', () => {
    expect(roomTags({ classroomType: ClassroomType.SPORTS_HALL, tags: [] })).toEqual(['физическая культура']);
    const list = [
      { id: 'gym', classroomType: ClassroomType.SPORTS_HALL, tags: [] },
      { id: 'eng', classroomType: ClassroomType.GENERAL, tags: ['Иностранный язык'] },
    ];
    expect(roomsForDiscipline(list, 'Физическая культура').map((r) => r.id)).toEqual(['gym']);
    expect(roomsForDiscipline(list, 'Иностранный язык').map((r) => r.id)).toEqual(['eng']);
  });
});
