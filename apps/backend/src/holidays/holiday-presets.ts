/**
 * Справочник праздников по умолчанию: нерабочие праздничные дни (ст. 112 ТК РФ)
 * и переносы выходных по постановлениям Правительства РФ.
 */

export interface HolidayPreset {
  month: number;
  day: number;
  title: string;
  /** Выходной, совпавший с праздником, переносится на следующий рабочий день */
  transferable: boolean;
}

export interface TransferPreset {
  fromDate: string;
  toDate: string;
  basis: string;
}

const NEW_YEAR = 'Новогодние каникулы';

/** Постоянные праздники: повторяются каждый год */
export const FEDERAL_HOLIDAYS: HolidayPreset[] = [
  { month: 1, day: 1, title: NEW_YEAR, transferable: false },
  { month: 1, day: 2, title: NEW_YEAR, transferable: false },
  { month: 1, day: 3, title: NEW_YEAR, transferable: false },
  { month: 1, day: 4, title: NEW_YEAR, transferable: false },
  { month: 1, day: 5, title: NEW_YEAR, transferable: false },
  { month: 1, day: 6, title: NEW_YEAR, transferable: false },
  { month: 1, day: 7, title: 'Рождество Христово', transferable: false },
  { month: 1, day: 8, title: NEW_YEAR, transferable: false },
  { month: 2, day: 23, title: 'День защитника Отечества', transferable: true },
  { month: 3, day: 8, title: 'Международный женский день', transferable: true },
  { month: 5, day: 1, title: 'Праздник Весны и Труда', transferable: true },
  { month: 5, day: 9, title: 'День Победы', transferable: true },
  { month: 6, day: 12, title: 'День России', transferable: true },
  { month: 11, day: 4, title: 'День народного единства', transferable: true },
];

const DECREE_2025 = 'Постановление Правительства РФ от 04.10.2024 № 1335';
const DECREE_2026 = 'Постановление Правительства РФ от 24.09.2025 № 1466';
const DECREE_2027 = 'Постановление Правительства РФ от 17.09.2026 № 1187';

/** Переносы выходных дней по постановлениям Правительства РФ */
export const DECREE_TRANSFERS: TransferPreset[] = [
  { fromDate: '2025-01-04', toDate: '2025-05-02', basis: DECREE_2025 },
  { fromDate: '2025-01-05', toDate: '2025-12-31', basis: DECREE_2025 },
  { fromDate: '2025-02-23', toDate: '2025-05-08', basis: DECREE_2025 },
  { fromDate: '2025-03-08', toDate: '2025-06-13', basis: DECREE_2025 },
  { fromDate: '2025-11-01', toDate: '2025-11-03', basis: DECREE_2025 },
  { fromDate: '2026-01-03', toDate: '2026-01-09', basis: DECREE_2026 },
  { fromDate: '2026-01-04', toDate: '2026-12-31', basis: DECREE_2026 },
  { fromDate: '2027-01-02', toDate: '2027-11-05', basis: DECREE_2027 },
  { fromDate: '2027-01-03', toDate: '2027-12-31', basis: DECREE_2027 },
  { fromDate: '2027-02-20', toDate: '2027-02-22', basis: DECREE_2027 },
];
