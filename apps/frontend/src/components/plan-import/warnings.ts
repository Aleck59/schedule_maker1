import type { WarningCell } from './types';

/** Куда ведёт замечание распознавания: шаг проверки (0 — общие сведения, 1 — график, 2 — дисциплины, 3 — итог) */
export function warningStep(text: string, cells?: WarningCell[]): number {
  if (cells?.length) return 1;
  const t = text.toLowerCase();
  if (/график|семестр|сесси|каникул|недел/.test(t)) return 1;
  if (/строк|дисциплин|видов работ|час|модул|практик/.test(t)) return 2;
  if (/специальност|квалификац|год|форм|план/.test(t)) return 0;
  return 3;
}

/** Подсветка места замечания; nonce меняется при каждом переходе, чтобы повторно прокрутить к нему */
export interface WarningFocus {
  text: string;
  step: number;
  cells: WarningCell[];
  nonce: number;
}
