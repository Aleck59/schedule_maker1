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
 *  - желаемый темп (weeklyRate, пар в неделю) может «опережать» равномерный график.
 */
export function cumulativeTargetByDays(
  required: number,
  daysUpTo: number,
  totalDays: number,
  weeksUpTo: number,
  weeklyRate: number | null,
): number {
  if (totalDays <= 0 || daysUpTo >= totalDays) return required;
  const even = (required * daysUpTo) / totalDays;
  const byRate = weeklyRate ? weeklyRate * weeksUpTo : 0;
  return Math.min(required, Math.round(Math.max(even, byRate) + 1e-9));
}
