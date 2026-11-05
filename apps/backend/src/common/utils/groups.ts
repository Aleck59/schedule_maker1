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

/**
 * Максимум пар группы в день: число пар в её режиме «с–по», если он задан в ограничениях группы,
 * иначе — общее значение (параметр запуска генерации или сохранённое по умолчанию)
 */
export function groupDailyLimit(
  g: { firstLessonNumber: number | null; lastLessonNumber: number | null },
  lessonsPerDay: number,
  fallback: number,
): number {
  const allowed = groupLessonNumbers(g, lessonsPerDay);
  return allowed && allowed.length > 0 ? allowed.length : fallback;
}
