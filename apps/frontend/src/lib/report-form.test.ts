import { describe, expect, it } from 'vitest';
import {
  applyBorders,
  emptyForm,
  expandRange,
  formFromSource,
  mergeRange,
  parseTsv,
  pasteValues,
  setValue,
  shiftCols,
  shiftRows,
  toTsv,
} from './report-form';

describe('редактор форм отчётов', () => {
  it('вставка строки сдвигает ячейки, объединения и строку данных', () => {
    let f = emptyForm(5, 3);
    f = setValue(f, 3, 0, 'итог');
    f = mergeRange(f, { r1: 1, c1: 0, r2: 2, c2: 1 });
    f.repeatRow = 4;
    const g = shiftRows(f, 2, 1);
    expect(g.rowCount).toBe(6);
    expect(g.cells['4:0'].v).toBe('итог');
    expect(g.merges).toEqual([{ r: 1, c: 0, rs: 3, cs: 2 }]); // вставка внутри объединения расширяет его
    expect(g.repeatRow).toBe(5);
  });

  it('удаление строк сжимает объединения и снимает строку данных', () => {
    let f = emptyForm(6, 3);
    f = mergeRange(f, { r1: 1, c1: 0, r2: 3, c2: 0 });
    f.repeatRow = 2;
    const g = shiftRows(f, 2, -2);
    expect(g.rowCount).toBe(4);
    expect(g.merges).toEqual([]); // осталась одна ячейка — объединение исчезло
    expect(g.repeatRow).toBeNull();
  });

  it('удаление столбца убирает его ширину и ячейки', () => {
    let f = emptyForm(2, 3);
    f.colWidths = [10, 20, 30];
    f = setValue(f, 0, 2, 'C');
    const g = shiftCols(f, 1, -1);
    expect(g.colWidths).toEqual([10, 30]);
    expect(g.cells['0:1'].v).toBe('C');
  });

  it('объединение оставляет значение левой верхней ячейки, выделение расширяется до объединений', () => {
    let f = emptyForm(3, 3);
    f = setValue(f, 0, 0, 'A');
    f = setValue(f, 0, 1, 'B');
    f = mergeRange(f, { r1: 0, c1: 0, r2: 0, c2: 1 });
    expect(f.cells['0:1']).toBeUndefined();
    expect(expandRange({ r1: 0, c1: 1, r2: 1, c2: 1 }, f.merges)).toEqual({ r1: 0, c1: 0, r2: 1, c2: 1 });
  });

  it('внешние границы ставятся только по краю диапазона', () => {
    const f = applyBorders(emptyForm(3, 3), { r1: 0, c1: 0, r2: 1, c2: 1 }, 'outer');
    expect(f.cells['0:0'].s?.bd).toBe('tl');
    expect(f.cells['1:1'].s?.bd).toBe('rb');
  });

  it('копирование и вставка в формате Excel (TSV) с кавычками и переносами', () => {
    let f = emptyForm(2, 2);
    f = setValue(f, 0, 0, 'a\tb');
    f = setValue(f, 1, 1, 'строка 1\nстрока 2');
    const tsv = toTsv(f, { r1: 0, c1: 0, r2: 1, c2: 1 });
    expect(parseTsv(tsv)).toEqual([
      ['a\tb', ''],
      ['', 'строка 1\nстрока 2'],
    ]);
    const g = pasteValues(emptyForm(1, 1), 0, 0, parseTsv('1\t2\t3\n4\t5\t6\r\n'));
    expect(g.rowCount).toBe(2);
    expect(g.colCount).toBe(3);
    expect(g.cells['1:2'].v).toBe('6');
  });

  it('форма по отчёту: заголовки, строка данных и альбомная ориентация для широких отчётов', () => {
    const cols = Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, header: `H${i}` }));
    const f = formFromSource({ type: 'x', title: 'X', description: '', params: [], columns: cols });
    expect(f.repeatRow).toBe(5);
    expect(f.cells['4:3'].v).toBe('H3');
    expect(f.cells['5:8'].v).toBe('{{row.k8}}');
    expect(f.orientation).toBe('landscape');
    expect(f.merges[0]).toEqual({ r: 0, c: 0, rs: 1, cs: 9 });
  });
});
