import { ClassroomType, LessonType } from '@prisma/client';

/** Типы аудиторий по умолчанию для вида занятия */
export function defaultRoomTypes(lessonType: LessonType): ClassroomType[] {
  switch (lessonType) {
    case LessonType.LECTURE:
      return [ClassroomType.LECTURE, ClassroomType.GENERAL];
    case LessonType.PRACTICAL:
      return [ClassroomType.GENERAL, ClassroomType.LECTURE];
    case LessonType.LABORATORY:
      return [ClassroomType.LABORATORY, ClassroomType.COMPUTER_LAB];
    case LessonType.CONSULTATION:
      return [ClassroomType.GENERAL, ClassroomType.LECTURE];
    case LessonType.PRACTICE:
      return [ClassroomType.WORKSHOP, ClassroomType.COMPUTER_LAB, ClassroomType.LABORATORY];
    default:
      return [ClassroomType.GENERAL, ClassroomType.LECTURE];
  }
}

export interface RoomTypeSource {
  lectureRoomTypes: ClassroomType[];
  practicalRoomTypes: ClassroomType[];
  laboratoryRoomTypes: ClassroomType[];
  consultationRoomTypes: ClassroomType[];
  practiceRoomTypes: ClassroomType[];
}

/** Допустимые типы аудиторий: назначение → строка плана → значения по умолчанию */
export function effectiveRoomTypes(
  lessonType: LessonType,
  item: RoomTypeSource | null | undefined,
  assignmentOverride?: ClassroomType[] | null,
): ClassroomType[] {
  if (assignmentOverride && assignmentOverride.length > 0) return assignmentOverride;
  if (item) {
    const fromItem =
      lessonType === LessonType.LECTURE
        ? item.lectureRoomTypes
        : lessonType === LessonType.PRACTICAL
          ? item.practicalRoomTypes
          : lessonType === LessonType.LABORATORY
            ? item.laboratoryRoomTypes
            : lessonType === LessonType.CONSULTATION
              ? item.consultationRoomTypes
              : lessonType === LessonType.PRACTICE
                ? item.practiceRoomTypes
                : [];
    if (fromItem && fromItem.length > 0) return fromItem;
  }
  return defaultRoomTypes(lessonType);
}

/**
 * Тип аудитории — предпочтение, а не жёсткая привязка.
 * Если подходящих по типу кабинетов нет или они заняты, занятие можно провести
 * в любом другом учебном кабинете нужной вместимости (кроме онлайн-аудитории и
 * спортзала — спортзал только для занятий, которым он нужен).
 */
export function isFallbackRoomType(type: ClassroomType, preferred: ClassroomType[]): boolean {
  if (preferred.includes(type)) return false;
  return type !== ClassroomType.ONLINE && type !== ClassroomType.SPORTS_HALL;
}

export interface RankableRoom {
  id: string;
  code: string;
  classroomType: ClassroomType;
  capacity: number;
}

/**
 * Аудитории в порядке предпочтения: сначала нужного типа (в порядке типов),
 * затем остальные учебные кабинеты. `matching` — сколько первых аудиторий
 * подходят по типу.
 */
export function rankRooms<R extends RankableRoom>(
  rooms: R[],
  types: ClassroomType[],
  size: number,
  preferredId: string | null = null,
): { rooms: R[]; matching: number } {
  const fits = (r: R) => r.classroomType === ClassroomType.ONLINE || r.capacity >= size;
  const byPref = (a: R, b: R) => {
    if (a.id === preferredId) return -1;
    if (b.id === preferredId) return 1;
    return (
      types.indexOf(a.classroomType) - types.indexOf(b.classroomType) ||
      a.capacity - b.capacity ||
      a.code.localeCompare(b.code)
    );
  };
  const matching = rooms.filter((r) => types.includes(r.classroomType) && fits(r)).sort(byPref);
  const fallback = rooms
    .filter((r) => isFallbackRoomType(r.classroomType, types) && fits(r))
    .sort((a, b) => a.capacity - b.capacity || a.code.localeCompare(b.code));
  return { rooms: [...matching, ...fallback], matching: matching.length };
}
