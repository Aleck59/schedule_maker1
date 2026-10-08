import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import { addDaysStr, eachDay, formatDateRu, isoWeekday, weekStart, weekdayName } from '../common/utils/dates';
import { LESSON_STATUS_LABELS, LESSON_TYPE_SHORT } from '../common/utils/labels';
import { ReportTable } from '../reports/reports.service';

// pdfmake 0.3 (серверный вариант) не содержит типов
const pdfmake = require('pdfmake');

export interface PdfLesson {
  date: string;
  lessonNumber: number;
  startTime: string;
  endTime: string;
  status: string;
  lessonType: string;
  subgroupNumber: number | null;
  studentGroup: { code: string };
  semesterItem: { curriculumItem: { code: string; name: string } };
  teacher: { fullName: string } | null;
  classroom: { code: string } | null;
  academicHours: number;
}

type Content = Record<string, unknown> | string | Array<unknown>;

/** Формирование PDF (шрифт Roboto поддерживает кириллицу) */
@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);
  private initialized = false;

  private init() {
    if (this.initialized) return;
    const dir = path.join(path.dirname(require.resolve('pdfmake/package.json')), 'fonts', 'Roboto');
    pdfmake.addFonts({
      Roboto: {
        normal: path.join(dir, 'Roboto-Regular.ttf'),
        bold: path.join(dir, 'Roboto-Medium.ttf'),
        italics: path.join(dir, 'Roboto-Italic.ttf'),
        bolditalics: path.join(dir, 'Roboto-MediumItalic.ttf'),
      },
    });
    // Доступ только к локальным файлам шрифтов, внешние URL запрещены
    pdfmake.setUrlAccessPolicy(() => false);
    pdfmake.setLocalAccessPolicy((p: string) => p.startsWith(dir));
    this.initialized = true;
  }

  async render(docDefinition: Record<string, unknown>): Promise<Buffer> {
    this.init();
    const doc = pdfmake.createPdf({
      defaultStyle: { font: 'Roboto', fontSize: 8 },
      ...docDefinition,
    });
    return doc.getBuffer();
  }

  private shortName(fullName: string): string {
    const [last, first, middle] = fullName.split(' ');
    return [last, first ? `${first[0]}.` : '', middle ? `${middle[0]}.` : ''].join(' ').trim();
  }

  /**
   * Расписание в виде недельных сеток: строки — пары, столбцы — дни недели.
   * mode: group — в ячейке преподаватель; teacher/classroom — группа.
   */
  async scheduleGrid(params: {
    title: string;
    subtitle: string;
    from: string;
    to: string;
    lessons: PdfLesson[];
    lessonTimes: Array<{ lessonNumber: number; startTime: string; endTime: string }>;
    workingDays: number[];
    mode: 'group' | 'teacher' | 'classroom';
    organization: string;
  }): Promise<Buffer> {
    const content: Content[] = [
      { text: params.organization, style: 'org' },
      { text: params.title, style: 'title' },
      { text: params.subtitle, style: 'subtitle', margin: [0, 0, 0, 6] },
    ];
    const maxLesson = Math.max(params.lessonTimes.length, ...params.lessons.map((l) => l.lessonNumber), 1);
    let cursor = weekStart(params.from);
    let weeks = 0;
    while (cursor <= params.to) {
      const days = eachDay(cursor, addDaysStr(cursor, 6)).filter(
        (d) => params.workingDays.includes(isoWeekday(d)) && d >= params.from && d <= params.to,
      );
      const weekLessons = params.lessons.filter((l) => days.includes(l.date));
      if (weekLessons.length > 0 || weeks === 0) {
        const header = [
          { text: 'Пара', style: 'th' },
          ...days.map((d) => ({ text: `${weekdayName(isoWeekday(d))}\n${formatDateRu(d)}`, style: 'th' })),
        ];
        const body: unknown[][] = [header];
        for (let n = 1; n <= maxLesson; n++) {
          const time = params.lessonTimes.find((t) => t.lessonNumber === n);
          const row: unknown[] = [
            { text: `${n}\n${time ? `${time.startTime}–${time.endTime}` : ''}`, style: 'lessonNo' },
          ];
          for (const d of days) {
            const cell = weekLessons.filter((l) => l.date === d && l.lessonNumber === n);
            row.push(
              cell.length === 0
                ? ''
                : {
                    stack: cell.map((l) => this.cell(l, params.mode)),
                  },
            );
          }
          body.push(row);
        }
        content.push({
          text: `Неделя ${formatDateRu(cursor)} — ${formatDateRu(addDaysStr(cursor, 6))}`,
          style: 'week',
          margin: [0, weeks === 0 ? 0 : 8, 0, 3],
        });
        content.push({
          table: { headerRows: 1, widths: [42, ...days.map(() => '*')], body, dontBreakRows: true },
          layout: {
            fillColor: (rowIndex: number) => (rowIndex === 0 ? '#E8EEF7' : null),
            hLineColor: '#B0B8C4',
            vLineColor: '#B0B8C4',
          },
        });
        weeks++;
      }
      cursor = addDaysStr(cursor, 7);
    }
    if (params.lessons.length === 0) {
      content.push({ text: 'Занятий в выбранном периоде нет', italics: true, margin: [0, 10, 0, 0] });
    }
    return this.render({
      pageOrientation: 'landscape',
      pageSize: 'A4',
      pageMargins: [20, 24, 20, 28],
      info: { title: params.title, creator: 'Расписание СПО' },
      content,
      footer: (current: number, total: number) => ({
        text: `Сформировано ${formatDateRu(new Date().toISOString())} · стр. ${current} из ${total}`,
        alignment: 'right',
        fontSize: 7,
        color: '#6B7280',
        margin: [20, 6, 20, 0],
      }),
      styles: {
        org: { fontSize: 8, color: '#6B7280' },
        title: { fontSize: 14, bold: true },
        subtitle: { fontSize: 9, color: '#374151' },
        week: { fontSize: 9, bold: true },
        th: { bold: true, alignment: 'center', fontSize: 8 },
        lessonNo: { alignment: 'center', fontSize: 7, bold: true },
      },
    });
  }

  private cell(l: PdfLesson, mode: 'group' | 'teacher' | 'classroom') {
    const cancelled = l.status === 'CANCELLED' || l.status === 'MOVED';
    const decoration = cancelled ? 'lineThrough' : undefined;
    const who =
      mode === 'group'
        ? l.teacher
          ? this.shortName(l.teacher.fullName)
          : '—'
        : `${l.studentGroup.code}${l.subgroupNumber ? ` п/г ${l.subgroupNumber}` : ''}`;
    const extra =
      mode === 'classroom'
        ? l.teacher
          ? this.shortName(l.teacher.fullName)
          : ''
        : `ауд. ${l.classroom?.code ?? '—'}`;
    const lines: unknown[] = [
      { text: l.semesterItem.curriculumItem.name, bold: true, decoration, fontSize: 7.5 },
      {
        text: `${LESSON_TYPE_SHORT[l.lessonType] ?? ''}${mode === 'group' && l.subgroupNumber ? ` · п/г ${l.subgroupNumber}` : ''}${
          l.academicHours === 1 ? ' · 1 ч' : ''
        }`,
        fontSize: 7,
        color: '#4B5563',
      },
      { text: `${who} · ${extra}`, fontSize: 7, decoration },
    ];
    if (l.status !== 'PLANNED' && l.status !== 'CONDUCTED') {
      lines.push({ text: LESSON_STATUS_LABELS[l.status], fontSize: 6.5, color: '#B91C1C', bold: true });
    }
    return { stack: lines, margin: [0, 1, 0, 2] };
  }

  /** Универсальный PDF отчёта-таблицы */
  async reportTable(table: ReportTable, organization: string): Promise<Buffer> {
    const body: unknown[][] = [
      table.columns.map((c) => ({ text: c.header, bold: true, fontSize: 7, alignment: 'center' })),
      ...table.rows.map((r) =>
        table.columns.map((c) => {
          const v = r[c.key];
          const text =
            v === null || v === undefined
              ? ''
              : c.type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)
                ? formatDateRu(v)
                : c.type === 'percent'
                  ? `${v}%`
                  : String(v);
          return {
            text,
            fontSize: 7,
            alignment: c.type === 'number' || c.type === 'percent' ? 'right' : 'left',
          };
        }),
      ),
    ];
    const totalWidth = table.columns.reduce((a, c) => a + (c.width ?? 12), 0);
    const content: Content[] = [
      { text: organization, fontSize: 8, color: '#6B7280' },
      { text: table.title, fontSize: 14, bold: true },
    ];
    if (table.subtitle) content.push({ text: table.subtitle, fontSize: 9, margin: [0, 0, 0, 4] });
    if (table.summary?.length) {
      content.push({
        text: table.summary.map((s) => `${s.label}: ${s.value}`).join('   ·   '),
        fontSize: 8,
        margin: [0, 2, 0, 6],
      });
    }
    content.push({
      table: {
        headerRows: 1,
        widths: table.columns.map((c) => `${(((c.width ?? 12) / totalWidth) * 100).toFixed(2)}%`),
        body,
      },
      layout: {
        fillColor: (i: number) => (i === 0 ? '#E8EEF7' : i % 2 === 0 ? '#F9FAFB' : null),
        hLineColor: '#D1D5DB',
        vLineColor: '#D1D5DB',
      },
    });
    if (table.rows.length === 0) content.push({ text: 'Нет данных', italics: true, margin: [0, 8, 0, 0] });
    return this.render({
      pageOrientation: table.columns.length > 7 ? 'landscape' : 'portrait',
      pageSize: 'A4',
      pageMargins: [20, 24, 20, 28],
      info: { title: table.title },
      content,
      footer: (current: number, total: number) => ({
        text: `стр. ${current} из ${total}`,
        alignment: 'right',
        fontSize: 7,
        color: '#6B7280',
        margin: [20, 6, 20, 0],
      }),
    });
  }
}
