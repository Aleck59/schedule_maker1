import { EducationLevel } from '@prisma/client';

const LEVEL_BY_CODE: Record<string, EducationLevel> = {
  '01': EducationLevel.SPO,
  '02': EducationLevel.SPO,
  '03': EducationLevel.BACHELOR,
  '04': EducationLevel.MASTER,
  '05': EducationLevel.SPECIALIST,
  '06': EducationLevel.POSTGRADUATE,
  '07': EducationLevel.POSTGRADUATE,
  '08': EducationLevel.POSTGRADUATE,
};

/**
 * Уровень образования по коду специальности (направления подготовки) из перечней Минобрнауки:
 * второй сегмент кода — 02 (СПО), 03 (бакалавриат), 04 (магистратура), 05 (специалитет).
 */
export function educationLevelByCode(code: string | null | undefined): EducationLevel {
  const m = /^\d{2}\.(\d{2})\.\d{2}$/.exec((code ?? '').trim());
  return (m && LEVEL_BY_CODE[m[1]]) || EducationLevel.SPO;
}

export function isHigherEducation(level: EducationLevel): boolean {
  return level !== EducationLevel.SPO;
}
