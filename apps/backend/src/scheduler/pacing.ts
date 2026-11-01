/**
 * Темп постановки занятий: сколько пар дисциплины должно быть поставлено
 * к концу очередной недели. Цель накопительная и пропорциональна числу
 * доступных учебных дней (короткие недели получают меньше пар). Если на неделе
 * поставить не удалось, цель следующей недели растёт — отставание компенсируется.
 */
export function effectiveRate(required: number, availableWeeks: number, weeklyRate: number | null): number {
  if (availableWeeks <= 0) return required;
  const even = required / availableWeeks;
  return Math.max(even, weeklyRate ?? 0);
}

/**
 * Накопительная цель:
 *  - равномерная часть: required × (доступных дней к концу недели / всего доступных дней);
 *  - желаемый темп (weeklyRate, пар в неделю) может «опережать» равномерный график;
 *  - phase (−0,5…0,5) сдвигает округление: у дисциплин одного преподавателя разные сдвиги,
 *    чтобы «лишняя» пара дробного темпа приходилась на разные недели, а не на одну (8, 4, 8, 4 → 6, 6, 6, 6).
 */
export function cumulativeTargetByDays(
  required: number,
  daysUpTo: number,
  totalDays: number,
  weeksUpTo: number,
  weeklyRate: number | null,
  phase = 0,
): number {
  if (totalDays <= 0 || daysUpTo >= totalDays) return required;
  const even = (required * daysUpTo) / totalDays;
  const byRate = weeklyRate ? weeklyRate * weeksUpTo : 0;
  return Math.max(0, Math.min(required, Math.round(Math.max(even, byRate) + phase + 1e-9)));
}

/** Сдвиги округления для n дисциплин одного преподавателя: равномерно в (−0,5; 0,5), у одной — 0 */
export function pacingPhases(n: number): number[] {
  return Array.from({ length: n }, (_, k) => (n <= 1 ? 0 : (k + 0.5) / n - 0.5));
}

/** Лимиты преподавателя на дату: после выхода из отсутствия с отработкой они увеличены */
export function teacherLimits(
  t: {
    maxDailyLessons: number;
    maxWeeklyLessons: number;
    relaxedFrom?: string | null;
    extraDailyLessons?: number;
    extraWeeklyLessons?: number;
  },
  date: string,
): { daily: number; weekly: number } {
  const relaxed = !!t.relaxedFrom && !date.startsWith('T') && date >= t.relaxedFrom;
  return {
    daily: t.maxDailyLessons + (relaxed ? (t.extraDailyLessons ?? 0) : 0),
    weekly: t.maxWeeklyLessons + (relaxed ? (t.extraWeeklyLessons ?? 0) : 0),
  };
}
