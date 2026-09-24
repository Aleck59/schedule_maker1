import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { addDaysStr, eachDay, formatDateRu, isoWeekday, weekStart, weekdayName } from '../common/utils/dates';
import {
  CONTROL_FORM_LABELS,
  LESSON_STATUS_LABELS,
  LESSON_TYPE_LABELS,
  LESSON_TYPE_SHORT,
} from '../common/utils/labels';
import { HourControlRow } from '../hour-control/hour-control.service';
import { ReportTable } from '../reports/reports.service';
import { PdfLesson } from './pdf.service';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
const STATUS_FILL: Record<string, string> = {
  NORMAL: 'FFDCFCE7',
  RISK: 'FFFEF3C7',
  DEFICIT: 'FFFEE2E2',
  EXCESS: 'FFE0E7FF',
};
const STATUS_LABEL: Record<string, string> = {
  NORMAL: 'Норма',
  RISK: 'Риск',
  DEFICIT: 'Дефицит',
  EXCESS: 'Превышение',
};
const thin: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFB0B8C4' } },
  left: { style: 'thin', color: { argb: 'FFB0B8C4' } },
  bottom: { style: 'thin', color: { argb: 'FFB0B8C4' } },
  right: { style: 'thin', color: { argb: 'FFB0B8C4' } },
};

function safeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[\\/?*[\]:]/g, '-').slice(0, 28) || 'Лист';
  let candidate = base;
  let i = 2;
  while (used.has(candidate)) candidate = `${base.slice(0, 25)} (${i++})`;
  used.add(candidate);
  base = candidate;
  return base;
}

/** Выгрузка в Excel */
@Injectable()
export class ExcelService {
  private async toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private newWorkbook() {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Расписание СПО';
    wb.created = new Date();
    return wb;
  }

  async reportTable(table: ReportTable): Promise<Buffer> {
    const wb = this.newWorkbook();
    const ws = wb.addWorksheet('Отчёт', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.getCell('A1').value = table.title;
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.getCell('A2').value = table.subtitle ?? '';
    ws.getCell('A3').value = (table.summary ?? []).map((s) => `${s.label}: ${s.value}`).join('   ·   ');
    const header = ws.getRow(4);
    table.columns.forEach((c, i) => {
      const cell = header.getCell(i + 1);
      cell.value = c.header;
      cell.font = { bold: true };
      cell.fill = HEADER_FILL;
      cell.border = thin;
      cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
      ws.getColumn(i + 1).width = c.width ?? 14;
    });
    header.height = 32;
    table.rows.forEach((r, idx) => {
      const row = ws.getRow(5 + idx);
      table.columns.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        const v = r[c.key];
        if (c.type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
          cell.value = formatDateRu(v);
        } else {
          cell.value = v ?? '';
        }
        cell.border = thin;
        cell.alignment = { wrapText: true, vertical: 'top' };
        if (c.key === 'status' && typeof v === 'string') {
          const code = Object.entries(STATUS_LABEL).find(([, label]) => label === v)?.[0];
          if (code) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATUS_FILL[code] } };
        }
      });
    });
    ws.autoFilter = {
      from: { row: 4, column: 1 },
      to: { row: 4 + table.rows.length, column: table.columns.length },
    };
    return this.toBuffer(wb);
  }

  /** Контроль часов: по видам занятий план / в расписании / проведено / остаток */
  async hourControl(title: string, rows: HourControlRow[]): Promise<Buffer> {
    const wb = this.newWorkbook();
    const ws = wb.addWorksheet('Выполнение часов', { views: [{ state: 'frozen', xSplit: 3, ySplit: 4 }] });
    ws.getCell('A1').value = title;
    ws.getCell('A1').font = { bold: true, size: 14 };
    const groups = [
      { key: 'LECTURE', label: 'Лекции' },
      { key: 'PRACTICAL', label: 'Практические' },
      { key: 'LABORATORY', label: 'Лабораторные' },
      { key: 'CONSULTATION', label: 'Консультации' },
      { key: 'PRACTICE', label: 'Практика' },
      { key: 'TOTAL', label: 'Всего часов' },
    ];
    const fields = [
      { key: 'planned', label: 'План' },
      { key: 'scheduled', label: 'В расп.' },
      { key: 'conducted', label: 'Пров.' },
      { key: 'remaining', label: 'Остаток' },
    ];
    // Двухуровневая шапка
    ws.getCell(3, 1).value = 'Группа';
    ws.getCell(3, 2).value = 'Сем.';
    ws.getCell(3, 3).value = 'Дисциплина';
    ws.mergeCells(3, 1, 4, 1);
    ws.mergeCells(3, 2, 4, 2);
    ws.mergeCells(3, 3, 4, 3);
    let col = 4;
    for (const g of groups) {
      ws.getCell(3, col).value = g.label;
      ws.mergeCells(3, col, 3, col + fields.length - 1);
      fields.forEach((f, i) => (ws.getCell(4, col + i).value = f.label));
      col += fields.length;
    }
    const tail = ['Дефицит', 'Превышение', 'Прогноз, %', 'Форма контроля', 'Статус'];
    tail.forEach((t, i) => {
      ws.getCell(3, col + i).value = t;
      ws.mergeCells(3, col + i, 4, col + i);
    });
    const lastCol = col + tail.length - 1;
    for (let r = 3; r <= 4; r++) {
      for (let c = 1; c <= lastCol; c++) {
        const cell = ws.getCell(r, c);
        cell.font = { bold: true };
        cell.fill = HEADER_FILL;
        cell.border = thin;
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      }
    }
    ws.getColumn(1).width = 16;
    ws.getColumn(2).width = 6;
    ws.getColumn(3).width = 44;
    for (let c = 4; c <= lastCol; c++) ws.getColumn(c).width = 8;
    ws.getColumn(lastCol - 1).width = 20;
    ws.getColumn(lastCol).width = 12;

    rows.forEach((row, idx) => {
      const r = 5 + idx;
      ws.getCell(r, 1).value = `${row.groupCode}${row.subgroupNumber ? ` (п/г ${row.subgroupNumber})` : ''}`;
      ws.getCell(r, 2).value = row.semesterNumber;
      ws.getCell(r, 3).value = `${row.itemCode} ${row.itemName}`;
      let c = 4;
      for (const g of groups) {
        const h = g.key === 'TOTAL' ? row.total : row.byType[g.key as keyof typeof row.byType];
        for (const f of fields) {
          ws.getCell(r, c).value = h ? (h as unknown as Record<string, number>)[f.key] : null;
          c++;
        }
      }
      ws.getCell(r, c++).value = row.total.scheduleDeficit;
      ws.getCell(r, c++).value = row.total.excess;
      ws.getCell(r, c++).value = row.forecastPercent;
      ws.getCell(r, c++).value = CONTROL_FORM_LABELS[row.controlForm] ?? row.controlForm;
      const status = ws.getCell(r, c);
      status.value = STATUS_LABEL[row.status];
      status.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATUS_FILL[row.status] } };
      for (let cc = 1; cc <= lastCol; cc++) ws.getCell(r, cc).border = thin;
    });
    // Итоговая строка
    const totalRow = 5 + rows.length;
    ws.getCell(totalRow, 3).value = 'Итого';
    ws.getCell(totalRow, 3).font = { bold: true };
    const lastTypeCol = 4 + groups.length * fields.length - 1;
    for (let c = 4; c <= lastTypeCol + 2; c++) {
      const letter = ws.getColumn(c).letter;
      ws.getCell(totalRow, c).value = rows.length
        ? { formula: `SUM(${letter}5:${letter}${totalRow - 1})` }
        : 0;
      ws.getCell(totalRow, c).font = { bold: true };
    }
    return this.toBuffer(wb);
  }

  /** Расписание: общий список занятий + недельные сетки по группам */
  async schedule(params: {
    title: string;
    lessons: PdfLesson[];
    lessonTimes: Array<{ lessonNumber: number; startTime: string; endTime: string }>;
    workingDays: number[];
    from: string;
    to: string;
  }): Promise<Buffer> {
    const wb = this.newWorkbook();
    const used = new Set<string>();
    const list = wb.addWorksheet(safeSheetName('Все занятия', used), {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    list.columns = [
      { header: 'Дата', key: 'date', width: 12 },
      { header: 'День', key: 'weekday', width: 6 },
      { header: 'Пара', key: 'lesson', width: 6 },
      { header: 'Время', key: 'time', width: 12 },
      { header: 'Группа', key: 'group', width: 14 },
      { header: 'Подгруппа', key: 'subgroup', width: 10 },
      { header: 'Дисциплина', key: 'discipline', width: 44 },
      { header: 'Вид занятия', key: 'type', width: 20 },
      { header: 'Преподаватель', key: 'teacher', width: 30 },
      { header: 'Аудитория', key: 'room', width: 10 },
      { header: 'Ак. часов', key: 'hours', width: 9 },
      { header: 'Статус', key: 'status', width: 14 },
    ];
    list.getRow(1).font = { bold: true };
    list.getRow(1).fill = HEADER_FILL;
    for (const l of params.lessons) {
      list.addRow({
        date: formatDateRu(l.date),
        weekday: weekdayName(isoWeekday(l.date), true),
        lesson: l.lessonNumber,
        time: `${l.startTime}–${l.endTime}`,
        group: l.studentGroup.code,
        subgroup: l.subgroupNumber ?? '',
        discipline: `${l.semesterItem.curriculumItem.code} ${l.semesterItem.curriculumItem.name}`,
        type: LESSON_TYPE_LABELS[l.lessonType],
        teacher: l.teacher?.fullName ?? '',
        room: l.classroom?.code ?? '',
        hours: l.academicHours,
        status: LESSON_STATUS_LABELS[l.status],
      });
    }
    list.autoFilter = { from: 'A1', to: 'L1' };

    const groups = Array.from(new Set(params.lessons.map((l) => l.studentGroup.code))).sort();
    const maxLesson = Math.max(params.lessonTimes.length, ...params.lessons.map((l) => l.lessonNumber), 1);
    for (const code of groups) {
      const ws = wb.addWorksheet(safeSheetName(code, used));
      const lessons = params.lessons.filter((l) => l.studentGroup.code === code && l.status !== 'MOVED');
      ws.getCell('A1').value = `${params.title} — ${code}`;
      ws.getCell('A1').font = { bold: true, size: 13 };
      ws.getColumn(1).width = 12;
      let row = 3;
      let cursor = weekStart(params.from);
      while (cursor <= params.to) {
        const days = eachDay(cursor, addDaysStr(cursor, 6)).filter((d) =>
          params.workingDays.includes(isoWeekday(d)),
        );
        const weekLessons = lessons.filter((l) => days.includes(l.date));
        if (weekLessons.length > 0) {
          ws.getCell(row, 1).value = `Неделя ${formatDateRu(cursor)}`;
          ws.getCell(row, 1).font = { bold: true };
          row++;
          ws.getCell(row, 1).value = 'Пара';
          days.forEach((d, i) => {
            const cell = ws.getCell(row, i + 2);
            cell.value = `${weekdayName(isoWeekday(d), true)} ${formatDateRu(d)}`;
            ws.getColumn(i + 2).width = 30;
          });
          for (let c = 1; c <= days.length + 1; c++) {
            ws.getCell(row, c).font = { bold: true };
            ws.getCell(row, c).fill = HEADER_FILL;
            ws.getCell(row, c).border = thin;
          }
          row++;
          for (let n = 1; n <= maxLesson; n++) {
            const t = params.lessonTimes.find((x) => x.lessonNumber === n);
            ws.getCell(row, 1).value = `${n} (${t?.startTime ?? ''})`;
            ws.getCell(row, 1).border = thin;
            days.forEach((d, i) => {
              const cellLessons = weekLessons.filter((l) => l.date === d && l.lessonNumber === n);
              const cell = ws.getCell(row, i + 2);
              cell.value = cellLessons
                .map(
                  (l) =>
                    `${l.semesterItem.curriculumItem.name} (${LESSON_TYPE_SHORT[l.lessonType]}${
                      l.subgroupNumber ? `, п/г ${l.subgroupNumber}` : ''
                    })\n${l.teacher?.fullName ?? ''}, ауд. ${l.classroom?.code ?? '—'}${
                      l.status === 'CANCELLED' ? '\nОТМЕНЕНО' : l.status === 'REPLACED' ? '\nЗАМЕНА' : ''
                    }`,
                )
                .join('\n—\n');
              cell.alignment = { wrapText: true, vertical: 'top' };
              cell.border = thin;
              if (cellLessons.some((l) => l.status === 'CANCELLED')) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
              }
            });
            ws.getRow(row).height = 48;
            row++;
          }
          row++;
        }
        cursor = addDaysStr(cursor, 7);
      }
    }
    return this.toBuffer(wb);
  }
}
