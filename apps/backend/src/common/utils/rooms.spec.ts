import { ClassroomType } from '@prisma/client';
import { rankRooms } from './rooms';

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
