import { Transform } from 'class-transformer';

/** Корректное преобразование строк 'true'/'false' из query-параметров в boolean */
export function ToBoolean() {
  return Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
  });
}

/** Преобразование строки со списком через запятую в массив */
export function ToArray() {
  return Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (Array.isArray(value)) return value;
    return String(value)
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  });
}
