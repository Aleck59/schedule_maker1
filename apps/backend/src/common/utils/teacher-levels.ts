import { AcademicDegree, AcademicTitle, EducationLevel, TeacherEducation } from '@prisma/client';
import { DateStr, formatDateRu, toDateStr } from './dates';
import { EDUCATION_LEVEL_LABELS } from './labels';

const ALL_LEVELS: EducationLevel[] = [
  EducationLevel.SPO,
  EducationLevel.BACHELOR,
  EducationLevel.SPECIALIST,
  EducationLevel.MASTER,
  EducationLevel.POSTGRADUATE,
];

/**
 * У каких уровней образования преподаватель может вести занятия (по умолчанию):
 * бакалавр — только СПО; магистр — СПО и бакалавриат; специалист — СПО, бакалавриат и специалитет;
 * кадры высшей квалификации — также магистратура; учёная степень или звание — все уровни.
 */
export const LEVELS_BY_EDUCATION: Record<TeacherEducation, EducationLevel[]> = {
  SPO: [EducationLevel.SPO],
  BACHELOR: [EducationLevel.SPO],
  MASTER: [EducationLevel.SPO, EducationLevel.BACHELOR],
  SPECIALIST: [EducationLevel.SPO, EducationLevel.BACHELOR, EducationLevel.SPECIALIST],
  HIGHEST: [EducationLevel.SPO, EducationLevel.BACHELOR, EducationLevel.SPECIALIST, EducationLevel.MASTER],
};

export const TEACHER_EDUCATION_LABELS: Record<TeacherEducation, string> = {
  SPO: 'среднее профессиональное',
  BACHELOR: 'высшее — бакалавриат',
  SPECIALIST: 'высшее — специалитет',
  MASTER: 'высшее — магистратура',
  HIGHEST: 'высшая квалификация (аспирантура)',
};

export interface TeacherQualification {
  educationLevel: TeacherEducation | null;
  academicDegree: AcademicDegree;
  academicTitle: AcademicTitle;
  teachableLevels: EducationLevel[];
}

/** Уровни образования групп, у которых преподаватель может вести занятия */
export function allowedLevels(t: TeacherQualification): EducationLevel[] {
  if (t.teachableLevels.length) return ALL_LEVELS.filter((l) => t.teachableLevels.includes(l));
  if (t.academicDegree !== AcademicDegree.NONE || t.academicTitle !== AcademicTitle.NONE) return ALL_LEVELS;
  // Образование не указано — ограничений нет
  if (!t.educationLevel) return ALL_LEVELS;
  return LEVELS_BY_EDUCATION[t.educationLevel];
}

/** Пояснение, почему преподаватель не может вести занятия у группы этого уровня; null — может */
export function levelRestriction(
  t: TeacherQualification & { fullName: string },
  level: EducationLevel,
): string | null {
  const allowed = allowedLevels(t);
  if (allowed.includes(level)) return null;
  const reason = t.teachableLevels.length
    ? 'по настройке преподавателя'
    : `образование: ${TEACHER_EDUCATION_LABELS[t.educationLevel!]}`;
  return (
    `${t.fullName} не может вести занятия уровня «${EDUCATION_LEVEL_LABELS[level]}» (${reason}). ` +
    `Допустимо: ${allowed.map((l) => EDUCATION_LEVEL_LABELS[l]).join(', ')}`
  );
}

export interface TeacherEmployment {
  fullName: string;
  employedFrom: Date | null;
  employedTo: Date | null;
}

/** Работает ли преподаватель в эту дату (по датам начала и окончания работы) */
export function isEmployedOn(
  t: Pick<TeacherEmployment, 'employedFrom' | 'employedTo'>,
  date: DateStr,
): boolean {
  if (t.employedFrom && date < toDateStr(t.employedFrom)) return false;
  if (t.employedTo && date > toDateStr(t.employedTo)) return false;
  return true;
}

/** Пояснение, почему преподавателю нельзя ставить занятие в эту дату; null — можно */
export function employmentRestriction(t: TeacherEmployment, date: DateStr): string | null {
  if (t.employedFrom && date < toDateStr(t.employedFrom))
    return `${t.fullName} начинает работать с ${formatDateRu(t.employedFrom)}`;
  if (t.employedTo && date > toDateStr(t.employedTo))
    return `${t.fullName} работает только по ${formatDateRu(t.employedTo)}`;
  return null;
}

/** Текстовое описание периода работы: «с 01.11.2026», «по 31.12.2026», «01.11.2026–31.12.2026» */
export function employmentText(t: Pick<TeacherEmployment, 'employedFrom' | 'employedTo'>): string | null {
  if (t.employedFrom && t.employedTo) return `${formatDateRu(t.employedFrom)}–${formatDateRu(t.employedTo)}`;
  if (t.employedFrom) return `с ${formatDateRu(t.employedFrom)}`;
  if (t.employedTo) return `по ${formatDateRu(t.employedTo)}`;
  return null;
}
