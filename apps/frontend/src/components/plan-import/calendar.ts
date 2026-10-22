import type { DraftPeriod, DraftSemester, RecognizedCalendar } from './types';

/** Условные обозначения календарного учебного графика (печатная форма «Планы») */
export const CODE_TYPES: Record<string, string> = {
  Э: 'EXAM_SESSION',
  К: 'VACATION',
  У: 'EDUCATIONAL_PRACTICE',
  П: 'INDUSTRIAL_PRACTICE',
  Пд: 'PRE_DIPLOMA_PRACTICE',
  Д: 'DIPLOMA_PREPARATION',
  Г: 'FINAL_ATTESTATION',
  '*': 'HOLIDAY',
};

export const CODE_LABELS: Record<string, string> = {
  '': 'Теоретическое обучение',
  Э: 'Промежуточная аттестация',
  К: 'Каникулы',
  У: 'Учебная практика',
  П: 'Производственная практика',
  Пд: 'Преддипломная практика',
  Д: 'Подготовка к ГИА',
  Г: 'ГИА',
  '*': 'Праздничный день',
  '=': 'Обучение не ведётся',
  '?': 'Не распознано',
};

const DAY_MS = 86_400_000;

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // 0 — понедельник
}

function diffDays(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY_MS);
}

/** Дни учебного года (1 сентября – 31 августа) с кодами графика, Пн–Сб */
export function calendarDays(cal: RecognizedCalendar): Array<[string, string]> {
  const start = `${cal.startYear}-09-01`;
  const end = `${cal.startYear + 1}-08-31`;
  const days: Array<[string, string]> = [];
  for (const week of cal.weeks) {
    week.days.forEach((code, i) => {
      const day = addDays(week.monday, i);
      if (day >= start && day <= end) days.push([day, code]);
    });
  }
  return days;
}

/** Непрерывные периоды одного кода (воскресенье не разрывает период) */
export function runs(days: Array<[string, string]>): Array<{ code: string; start: string; end: string; days: number }> {
  const result: Array<{ code: string; start: string; end: string; days: number }> = [];
  for (const [day, code] of days) {
    const last = result.at(-1);
    if (last && last.code === code && diffDays(last.end, day) <= 2) {
      last.end = day;
      last.days++;
    } else {
      result.push({ code, start: day, end: day, days: 1 });
    }
  }
  return result;
}

/** Конец первого семестра: окончание зимних каникул (или сессии), иначе 31 января */
export function firstSemesterEnd(days: Array<[string, string]>): string {
  const all = runs(days);
  for (const code of ['К', 'Э']) {
    const run = all.find((r) => r.code === code && ['12', '01', '02'].includes(r.start.slice(5, 7)));
    if (run) return addDays(run.end, (6 - weekday(run.end)) % 7);
  }
  return `${Number(days[0][0].slice(0, 4)) + 1}-01-31`;
}

function lastStudyDay(days: Array<[string, string]>): string {
  for (let i = days.length - 1; i >= 0; i--) if (days[i][1] !== '=') return days[i][0];
  return days.at(-1)![0];
}

const WEEK_KIND: Record<string, keyof Pick<DraftSemester, 'theoryWeeks' | 'examWeeks' | 'vacationWeeks' | 'practiceWeeks'>> = {
  '': 'theoryWeeks',
  Э: 'examWeeks',
  К: 'vacationWeeks',
  У: 'practiceWeeks',
  П: 'practiceWeeks',
  Пд: 'practiceWeeks',
};

/** Семестры и периоды графика по распознанной (или исправленной) сетке недель */
export function deriveFromCalendar(
  calendar: RecognizedCalendar[],
  semesterNumbers: number[],
): { semesters: DraftSemester[]; periods: DraftPeriod[] } {
  const semesters: DraftSemester[] = [];
  const periods: DraftPeriod[] = [];
  for (const cal of calendar) {
    const days = calendarDays(cal);
    if (!days.length) continue;
    const split = firstSemesterEnd(days);
    const ranges: Array<[string, string]> = [
      [days[0][0], split],
      [addDays(split, 1), lastStudyDay(days)],
    ];
    ranges.forEach(([start, end], k) => {
      const number = 2 * cal.course - 1 + k;
      if (!semesterNumbers.includes(number)) return;
      const semester: DraftSemester = {
        number,
        course: cal.course,
        startDate: start,
        endDate: end,
        theoryWeeks: 0,
        examWeeks: 0,
        vacationWeeks: 0,
        practiceWeeks: 0,
      };
      for (const [day, code] of days) {
        const key = WEEK_KIND[code];
        if (key && day >= start && day <= end) semester[key] += 1 / 6;
      }
      for (const key of ['theoryWeeks', 'examWeeks', 'vacationWeeks', 'practiceWeeks'] as const) {
        semester[key] = Math.round(semester[key] * 100) / 100;
      }
      semesters.push(semester);
    });
    for (const run of runs(days)) {
      const type = CODE_TYPES[run.code];
      if (type) periods.push({ course: cal.course, type, startDate: run.start, endDate: run.end });
    }
  }
  return { semesters: semesters.sort((a, b) => a.number - b.number), periods };
}
