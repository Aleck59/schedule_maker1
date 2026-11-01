import { formToPdfDefinition } from './form-writers';
import { colName, FormError, parseFormContent, renderForm } from './report-form';
import type { ReportTable } from '../reports/reports.service';

const SOURCES = ['teacher-workload'];

const table: ReportTable = {
  type: 'teacher-workload',
  title: 'Нагрузка преподавателей',
  columns: [
    { key: 'teacher', header: 'Преподаватель' },
    { key: 'planned', header: 'План', type: 'number' },
    { key: 'percent', header: 'Выполнение', type: 'percent' },
  ],
  rows: [
    { teacher: 'Иванов И. И.', planned: 72, percent: 50 },
    { teacher: 'Петров П. П.', planned: 36.5, percent: 100 },
  ],
  summary: [{ label: 'Преподавателей', value: 2 }],
};

const base = {
  rowCount: 4,
  colCount: 3,
  colWidths: [30, 10, 10],
  cells: {
    '0:0': { v: 'Нагрузка — {{org.name}}', s: { b: true, size: 14 } },
    '1:0': { v: 'Преподаватель' },
    '2:0': { v: '{{row.#}}. {{row.teacher}}', s: { bd: 'tblr' } },
    '2:1': { v: '{{row.planned}}' },
    '2:2': { v: '{{row.percent}}' },
    '3:0': { v: 'Итого: {{summary.Преподавателей}}' },
    '3:1': { v: '{{sum.planned}}' },
    '3:2': { v: '{{нет.такого}}' },
  },
  merges: [
    { r: 0, c: 0, rs: 1, cs: 3 },
    { r: 3, c: 0, rs: 1, cs: 1 },
  ],
  repeatRow: 2,
  dataSource: 'teacher-workload',
};

describe('формы отчётов', () => {
  it('имена столбцов как в Excel', () => {
    expect([0, 25, 26, 51].map(colName)).toEqual(['A', 'Z', 'AA', 'AZ']);
  });

  it('нормализует форму и отбрасывает ячейки за пределами листа', () => {
    const f = parseFormContent({ ...base, cells: { ...base.cells, '9:9': { v: 'x' } } }, SOURCES);
    expect(f.cells['9:9']).toBeUndefined();
    expect(f.cells['2:0'].s?.bd).toBe('trbl');
    expect(f.merges).toHaveLength(1); // объединение 1×1 выброшено
    expect(f.orientation).toBe('portrait');
  });

  it('отклоняет пересекающиеся объединения, неизвестный источник и вертикальное объединение через строку данных', () => {
    expect(() =>
      parseFormContent(
        {
          ...base,
          merges: [
            { r: 0, c: 0, rs: 1, cs: 2 },
            { r: 0, c: 1, rs: 1, cs: 2 },
          ],
        },
        SOURCES,
      ),
    ).toThrow(FormError);
    expect(() => parseFormContent({ ...base, dataSource: 'drop-table' }, SOURCES)).toThrow(FormError);
    expect(() => parseFormContent({ ...base, merges: [{ r: 1, c: 0, rs: 2, cs: 1 }] }, SOURCES)).toThrow(
      /повторяющ/,
    );
  });

  it('размножает строку данных, считает итоги и сдвигает объединения ниже', () => {
    const form = parseFormContent(
      { ...base, merges: [...base.merges, { r: 3, c: 0, rs: 1, cs: 1 }, { r: 2, c: 1, rs: 1, cs: 2 }] },
      SOURCES,
    );
    const sheet = renderForm(form, { fields: { 'org.name': 'Колледж' }, table });
    expect(sheet.rows).toHaveLength(5);
    expect(sheet.rows[0][0].v).toBe('Нагрузка — Колледж');
    expect(sheet.rows[2][0].v).toBe('1. Иванов И. И.');
    expect(sheet.rows[3][0].v).toBe('2. Петров П. П.');
    expect(sheet.rows[3][1]).toMatchObject({ v: 36.5, fmt: 'number' });
    expect(sheet.rows[2][2]).toMatchObject({ v: 50, fmt: 'percent' });
    expect(sheet.rows[4][0].v).toBe('Итого: 2');
    expect(sheet.rows[4][1].v).toBe(108.5);
    expect(sheet.rows[4][2].v).toBe('{{нет.такого}}');
    expect(sheet.unknownFields).toEqual(['нет.такого']);
    // объединение строки данных повторено на каждой копии
    expect(sheet.merges).toEqual(
      expect.arrayContaining([
        { r: 0, c: 0, rs: 1, cs: 3 },
        { r: 2, c: 1, rs: 1, cs: 2 },
        { r: 3, c: 1, rs: 1, cs: 2 },
      ]),
    );
  });

  it('без данных строка данных исчезает, а нижние строки поднимаются', () => {
    const form = parseFormContent(base, SOURCES);
    const sheet = renderForm(form, { fields: {}, table: { ...table, rows: [] } });
    expect(sheet.rows).toHaveLength(3);
    expect(sheet.rows[2][1].v).toBe(0);
  });

  it('PDF: объединённые ячейки получают colSpan, а закрытые — пустые заглушки', () => {
    const form = parseFormContent(base, SOURCES);
    const def = formToPdfDefinition(renderForm(form, { fields: {}, table }), 'Тест') as {
      content: Array<{ table: { body: Array<Array<Record<string, unknown>>> } }>;
    };
    const body = def.content[0].table.body;
    expect(body[0][0].colSpan).toBe(3);
    expect(body[0][1]).toEqual({});
    expect(body[2][0].border).toEqual([true, true, true, true]);
  });
});
