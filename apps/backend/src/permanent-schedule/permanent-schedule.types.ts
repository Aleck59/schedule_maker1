import { WeekParity } from '@prisma/client';

/** Пара, не вошедшая в типовую неделю (полностью или частично) */
export interface PermanentUnplaced {
  groupCodes: string[];
  subgroupNumber: number | null;
  itemCode: string;
  itemName: string;
  lessonType: string;
  teacherName: string | null;
  /** Поставлено пар в неделю (0,5 — через неделю) */
  lessonsPerWeek: number;
  /** Не хватило пар в неделю; null — дисциплина не вошла в сетку совсем */
  missingPerWeek: number | null;
  reason: string;
}

/** Итоги формирования постоянного расписания */
export interface PermanentResultJson {
  stats: {
    /** Нужно пар в типовой неделе (пара через неделю считается одной) */
    requiredWeekly: number;
    placedWeekly: number;
    groups: number;
    teachers: number;
    unplaced: number;
    /** Пар по числителю/знаменателю */
    biweekly: number;
    /** Пар без аудитории (аудиторий не хватило) */
    withoutRoom: number;
    /** Учебных недель в семестре (для расчёта темпа) */
    weeks: number;
    durationMs: number;
  };
  semesters: Array<{ id: string; number: number }>;
  range: { from: string; to: string };
  groupLoad: Array<{ groupId: string; groupCode: string; lessonsPerWeek: number }>;
  unplaced: PermanentUnplaced[];
  warnings: string[];
  log: string[];
}

/** Пары в один слот пересекаются, если хотя бы одна каждую неделю или у них одна чётность */
export function parityOverlaps(a: WeekParity, b: WeekParity): boolean {
  return a === WeekParity.ANY || b === WeekParity.ANY || a === b;
}
