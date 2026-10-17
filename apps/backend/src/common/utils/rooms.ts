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
