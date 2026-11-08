import { addDaysStr, diffDays, DateStr } from './dates';

/**
 * Учебный год организации: начало года и типовые границы семестров в формате «ММ-ДД».
 * Используется там, где у плана своих дат нет: типовая структура нового плана, год при импорте,
 * отсчёт недель (числитель/знаменатель) в правилах доступности.
 */
export interface AcademicCalendarSettings {
  academicYearStart: string;
  firstSemesterEnd: string;
  secondSemesterStart: string;
  secondSemesterEnd: string;
}

export const DEFAULT_ACADEMIC_CALENDAR: AcademicCalendarSettings = {
  academicYearStart: '09-01',
  firstSemesterEnd: '12-31',
  secondSemesterStart: '01-12',
  secondSemesterEnd: '06-30',
};

const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

/** «ММ-ДД» существует в любом году (29 февраля не допускается) */
export function isValidMonthDay(value: string): boolean {
  if (!MONTH_DAY.test(value) || value === '02-29') return false;
  const [m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(2023, m - 1, d)).getUTCMonth() === m - 1;
}

/** Год, в котором начался учебный год, содержащий дату */
export function academicYearOf(
  date: DateStr,
  yearStart = DEFAULT_ACADEMIC_CALENDAR.academicYearStart,
): number {
  const y = Number(date.slice(0, 4));
  return date.slice(5, 10) >= yearStart ? y : y - 1;
}

/** Дата «ММ-ДД» внутри учебного года, начавшегося в году y */
export function dateInAcademicYear(
  y: number,
  monthDay: string,
  yearStart = DEFAULT_ACADEMIC_CALENDAR.academicYearStart,
): DateStr {
  return `${monthDay >= yearStart ? y : y + 1}-${monthDay}`;
}

/** Границы учебного года, начавшегося в году y */
export function academicYearRange(
  y: number,
  yearStart = DEFAULT_ACADEMIC_CALENDAR.academicYearStart,
): { start: DateStr; end: DateStr } {
  return { start: `${y}-${yearStart}`, end: addDaysStr(`${y + 1}-${yearStart}`, -1) };
}

/** Первый учебный день не раньше даты: пропускаются выходные и праздники */
export function nextWorkingDay(date: DateStr, isDayOff: (d: DateStr) => boolean): DateStr {
  let d = date;
  for (let i = 0; i < 31 && isDayOff(d); i++) d = addDaysStr(d, 1);
  return d;
}

export interface SemesterTemplate {
  start: DateStr;
  end: DateStr;
  theoreticalWeeks: number;
  examWeeks: number;
  vacationWeeks: number;
}

/**
 * Типовые семестры учебного года по настройкам: начало семестра переносится на ближайший учебный день.
 * Недели теории — полные недели семестра без недель аттестации.
 */
export function semesterTemplates(
  y: number,
  cal: AcademicCalendarSettings,
  isDayOff: (d: DateStr) => boolean = () => false,
): [SemesterTemplate, SemesterTemplate] {
  const start = cal.academicYearStart;
  const year = academicYearRange(y, start);
  const make = (from: DateStr, to: DateStr, examWeeks: number, vacationWeeks: number): SemesterTemplate => {
    const s = nextWorkingDay(from, isDayOff);
    const e = to < s ? s : to;
    const weeks = Math.floor((diffDays(e, s) + 1) / 7);
    return { start: s, end: e, theoreticalWeeks: Math.max(1, weeks - examWeeks), examWeeks, vacationWeeks };
  };
  const firstEnd = dateInAcademicYear(y, cal.firstSemesterEnd, start);
  const secondStart = dateInAcademicYear(y, cal.secondSemesterStart, start);
  const secondEnd = dateInAcademicYear(y, cal.secondSemesterEnd, start);
  // Летние каникулы — от конца второго семестра до конца учебного года
  const summer = Math.max(0, Math.round((diffDays(year.end, secondEnd) + 1) / 7));
  const winter = Math.max(0, Math.round((diffDays(secondStart, firstEnd) - 1) / 7));
  return [make(year.start, firstEnd, 1, winter), make(secondStart, secondEnd, 2, summer)];
}
