/** Допустимые пары группы по её режиму занятий; undefined — без ограничений */
export function groupLessonNumbers(
  g: { firstLessonNumber: number | null; lastLessonNumber: number | null },
  lessonsPerDay: number,
): number[] | undefined {
  if (!g.firstLessonNumber && !g.lastLessonNumber) return undefined;
  const first = g.firstLessonNumber ?? 1;
  const last = Math.min(g.lastLessonNumber ?? lessonsPerDay, lessonsPerDay);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
}
