import { safeFilename } from './send-file';

describe('имя файла выгрузки', () => {
  it('убирает запрещённые символы', () => {
    expect(safeFilename('Расписание: 1/2 "семестр".xlsx')).toBe('Расписание_ 1_2 _семестр_.xlsx');
  });

  it('длинное название периода сокращается с сохранением расширения', () => {
    const title =
      'Расписание_09.02.12 Техническая эксплуатация и сопровождение информационных систем, на базе основного общего образования, очная форма, набор 2026: 1 семестр (2026–2027).xlsx';
    const name = safeFilename(title);
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith('….xlsx')).toBe(true);
    expect(Buffer.byteLength(name)).toBeLessThan(255);
  });
});
