import type { Group, Lesson } from '@/lib/types';

/** Ячейка сводной сетки: одна группа или несколько соседних групп с одинаковой парой */
export interface FullWeekSegment {
  /** Группы, которые занимает ячейка (по порядку столбцов) */
  groupIds: string[];
  /** Занятия первой группы ячейки (у объединённой ячейки — общие для всех её групп) */
  lessons: Lesson[];
  /** Все занятия ячейки по всем её группам */
  allLessons: Lesson[];
}

/**
 * Ключ «одинаковой пары»: пара потока — по streamKey; без потока одинаковыми считаются
 * занятия одной дисциплины у одного преподавателя в одной аудитории одного вида.
 */
export function lessonKey(l: Lesson): string | null {
  if (l.streamKey) return `s:${l.streamKey}`;
  if (!l.teacherId) return null;
  return [
    'p',
    l.teacherId,
    l.semesterItem.curriculumItem.name.trim().toLowerCase(),
    l.lessonType,
    l.classroomId ?? '',
    l.subgroupNumber ?? '',
  ].join('|');
}

function cellSignature(lessons: Lesson[]): string | null {
  if (!lessons.length) return null;
  const keys: string[] = [];
  for (const l of lessons) {
    const k = lessonKey(l);
    if (!k) return null;
    keys.push(k);
  }
  return keys.sort().join('#');
}

/** Отменённые и перенесённые «следы» в сводной сетке не показываем — только действующие пары */
export function visibleInFullWeek(l: Lesson): boolean {
  return l.status !== 'MOVED';
}

/** Порядок столбцов: специальность → форма обучения → курс → шифр группы (потоки оказываются рядом) */
export function sortGroupsForFullWeek(groups: Group[]): Group[] {
  return [...groups].sort(
    (a, b) =>
      (a.program?.specialty?.code ?? '').localeCompare(b.program?.specialty?.code ?? '') ||
      (a.program?.studyForm ?? '').localeCompare(b.program?.studyForm ?? '') ||
      a.courseNumber - b.courseNumber ||
      a.code.localeCompare(b.code, 'ru', { numeric: true }),
  );
}

/** Занятия по ячейкам «дата#пара#группа» */
export function indexLessons(lessons: Lesson[]): Map<string, Lesson[]> {
  const map = new Map<string, Lesson[]>();
  for (const l of lessons) {
    if (!visibleInFullWeek(l)) continue;
    const key = `${l.date}#${l.lessonNumber}#${l.studentGroupId}`;
    const list = map.get(key) ?? [];
    list.push(l);
    map.set(key, list);
  }
  for (const list of map.values()) list.sort((a, b) => (a.subgroupNumber ?? 0) - (b.subgroupNumber ?? 0));
  return map;
}

/**
 * Строка сетки (одна пара одного дня): соседние группы с одинаковыми парами
 * сливаются в одну растянутую ячейку.
 */
export function buildRowSegments(
  groupIds: string[],
  date: string,
  lessonNumber: number,
  index: Map<string, Lesson[]>,
): FullWeekSegment[] {
  const segments: FullWeekSegment[] = [];
  let prevSig: string | null = null;
  for (const groupId of groupIds) {
    const lessons = index.get(`${date}#${lessonNumber}#${groupId}`) ?? [];
    const sig = cellSignature(lessons);
    const last = segments[segments.length - 1];
    if (last && sig && sig === prevSig) {
      last.groupIds.push(groupId);
      last.allLessons.push(...lessons);
    } else {
      segments.push({ groupIds: [groupId], lessons, allLessons: [...lessons] });
    }
    prevSig = sig;
  }
  return segments;
}
