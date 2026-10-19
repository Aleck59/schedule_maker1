import { BadRequestException, Injectable } from '@nestjs/common';
import { EducationLevel, LessonStatus, Prisma, SchedulePeriodStatus } from '@prisma/client';
import ExcelJS from 'exceljs';
import { AuthUser } from '../common/types/auth-user';
import { addDaysStr, eachDay, isoWeekday, parseDate, toDateStr, weekStart } from '../common/utils/dates';
import { STUDY_FORM_LABELS } from '../common/utils/labels';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { PdfService } from './pdf.service';
import {
  EDUCATION_BASE_TEXT,
  FormCell,
  FormGroup,
  FormLesson,
  FormSheet,
  FormSheetMeta,
  buildFormSheet,
  normalizePrintForm,
} from './schedule-form';

export interface ScheduleFormQuery {
  from: string;
  periodId?: string;
  keys?: string[];
  weekLabel?: string;
  lessonTypes?: boolean;
}

export interface ScheduleFormSheetInfo {
  key: string;
  specialtyId: string;
  title: string;
  profile: string | null;
  groupCodes: string[];
}

const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};

/** Печатная форма расписания на неделю по специальностям (как утверждаемый бумажный бланк) */
@Injectable()
export class ScheduleFormService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly pdf: PdfService,
  ) {}

  private async load(actor: AuthUser, query: ScheduleFormQuery) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(query.from)) throw new BadRequestException('Укажите неделю');
    const settings = await this.settings.getEffective(actor.organizationId);
    const monday = weekStart(query.from);
    const days = eachDay(monday, addDaysStr(monday, 6)).filter((d) =>
      settings.workingDays.includes(isoWeekday(d)),
    );
    const range = { gte: parseDate(monday), lte: parseDate(addDaysStr(monday, 6)) };
    const active = { notIn: [LessonStatus.CANCELLED, LessonStatus.MOVED] };
    const include = {
      semesterItem: { select: { curriculumItem: { select: { name: true } } } },
      teacher: { select: { fullName: true } },
      classroom: { select: { code: true } },
    } satisfies Prisma.ScheduleLessonInclude;
    // Выбранный период (в том числе черновик) — для его групп; остальные группы — из опубликованных
    const own = query.periodId
      ? await this.prisma.scheduleLesson.findMany({
          where: {
            schedulePeriodId: query.periodId,
            schedulePeriod: { organizationId: actor.organizationId },
            date: range,
            status: active,
          },
          include,
        })
      : [];
    const ownGroups = new Set(own.map((l) => l.studentGroupId));
    const published = await this.prisma.scheduleLesson.findMany({
      where: {
        schedulePeriod: { organizationId: actor.organizationId, status: SchedulePeriodStatus.PUBLISHED },
        schedulePeriodId: query.periodId ? { not: query.periodId } : undefined,
        studentGroupId: ownGroups.size ? { notIn: [...ownGroups] } : undefined,
        date: range,
        status: active,
      },
      include,
    });
    const rows = [...own, ...published];
    const groups = await this.prisma.studentGroup.findMany({
      where: { id: { in: [...new Set(rows.map((l) => l.studentGroupId))] } },
      include: {
        program: {
          include: {
            specialty: true,
            academicYears: { where: { startDate: { lte: range.lte }, endDate: { gte: range.gte } } },
          },
        },
      },
    });
    const lessons: Array<FormLesson & { sheetKey: string }> = [];
    const groupById = new Map(groups.map((g) => [g.id, g]));
    const keyOf = (g: (typeof groups)[number]) =>
      `${g.program.specialtyId}|${g.program.studyForm}|${g.program.educationBase ?? ''}`;
    for (const l of rows) {
      const g = groupById.get(l.studentGroupId);
      if (!g) continue;
      lessons.push({
        sheetKey: keyOf(g),
        date: toDateStr(l.date),
        lessonNumber: l.lessonNumber,
        groupId: l.studentGroupId,
        subgroupNumber: l.subgroupNumber,
        itemName: l.semesterItem.curriculumItem.name,
        teacherName: l.teacher?.fullName ?? null,
        classroom: l.classroom?.code ?? null,
        lessonType: l.lessonType,
      });
    }
    const printForm = normalizePrintForm(settings.printFormJson);
    const sheets = new Map<string, { meta: FormSheetMeta; groups: FormGroup[]; specialtyId: string }>();
    for (const g of [...groups].sort((a, b) => a.code.localeCompare(b.code, 'ru'))) {
      const key = keyOf(g);
      const p = g.program;
      if (!sheets.has(key)) {
        sheets.set(key, {
          specialtyId: p.specialtyId,
          meta: {
            key,
            specialtyCode: p.specialty.code,
            specialtyName: p.specialty.name,
            higherEducation: p.specialty.educationLevel !== EducationLevel.SPO,
            profile: printForm.profiles[p.specialtyId] ?? null,
            studyForm: p.studyForm,
            educationBase: p.educationBase,
            academicYear: p.academicYears[0]?.title.replace('–', '-') ?? null,
          },
          groups: [],
        });
      }
      sheets.get(key)!.groups.push({
        id: g.id,
        code: g.code,
        courseNumber: g.courseNumber,
        semesterNumber: g.currentSemesterNumber,
        subgroupCount: g.subgroupCount,
      });
    }
    const organization = await this.prisma.organization.findUnique({ where: { id: actor.organizationId } });
    return { settings, days, lessons, sheets, printForm, organizationName: organization?.name ?? '' };
  }

  async sheets(actor: AuthUser, query: ScheduleFormQuery): Promise<ScheduleFormSheetInfo[]> {
    const { sheets } = await this.load(actor, query);
    return [...sheets.values()]
      .map(({ meta, groups, specialtyId }) => ({
        key: meta.key,
        specialtyId,
        title: [
          `${meta.specialtyCode} ${meta.specialtyName}`,
          STUDY_FORM_LABELS[meta.studyForm],
          meta.educationBase ? EDUCATION_BASE_TEXT[meta.educationBase] : null,
        ]
          .filter(Boolean)
          .join(', '),
        profile: meta.profile,
        groupCodes: groups.map((g) => g.code).sort((a, b) => a.localeCompare(b, 'ru')),
      }))
      .sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  }

  async build(actor: AuthUser, query: ScheduleFormQuery): Promise<FormSheet[]> {
    const data = await this.load(actor, query);
    const result: FormSheet[] = [];
    const ordered = [...data.sheets.values()].sort(
      (a, b) =>
        a.meta.specialtyCode.localeCompare(b.meta.specialtyCode) || a.meta.key.localeCompare(b.meta.key),
    );
    for (const sheet of ordered) {
      if (query.keys?.length && !query.keys.includes(sheet.meta.key)) continue;
      result.push(
        buildFormSheet({
          meta: sheet.meta,
          groups: sheet.groups,
          lessons: data.lessons.filter((l) => l.sheetKey === sheet.meta.key),
          days: data.days,
          lessonTimes: data.settings.lessonTimes,
          showLessonTypes: query.lessonTypes ?? false,
          weekLabel: query.weekLabel ?? null,
          organizationName: data.organizationName,
          settings: data.printForm,
        }),
      );
    }
    if (result.length === 0) throw new BadRequestException('На выбранной неделе нет занятий для печати');
    return result;
  }

  // ------------------------------------------------------------------ PDF

  async pdfBuffer(sheets: FormSheet[]): Promise<Buffer> {
    const content: unknown[] = [];
    sheets.forEach((s, i) => content.push(...this.pdfSheet(s, i > 0)));
    const wide = sheets.some((s) => s.columns.length > 3);
    return this.pdf.render({
      pageOrientation: wide ? 'landscape' : 'portrait',
      pageSize: 'A4',
      pageMargins: [24, 20, 24, 20],
      info: { title: 'Расписание занятий' },
      defaultStyle: { font: 'Roboto', fontSize: 7.5 },
      content,
    });
  }

  private pdfSheet(s: FormSheet, pageBreak: boolean): unknown[] {
    const n = s.columns.length;
    const font = n > 6 ? 6.5 : 7.5;
    const approvals = s.approvals.length
      ? {
          columns: s.approvals.map((a) => ({
            width: '*',
            stack: [
              { text: a.heading, fontSize: 9 },
              { text: a.position, fontSize: 8 },
              { text: `____________ ${a.name}`, fontSize: 8, margin: [0, 2, 0, 0] },
              { text: `«____» ______________ ${s.year} г.`, fontSize: 8 },
            ],
          })),
          columnGap: 24,
          margin: [0, 0, 0, 8],
          pageBreak: pageBreak ? 'before' : undefined,
        }
      : { text: '', pageBreak: pageBreak ? 'before' : undefined };

    const title = s.titleLines.map((t, i) => ({
      text: t,
      alignment: 'center',
      fontSize: i === 0 ? 12 : 9,
      bold: i === 0,
    }));

    // Сетка: день, пара, затем на каждый столбец группы — дисциплина и аудитория
    const widths: unknown[] = [52, 36];
    for (let i = 0; i < n; i++) widths.push('*', 22);
    const body: unknown[][] = [];
    s.header.forEach((row, ri) => {
      const cells: unknown[] =
        ri === 0
          ? [
              { text: 'День', rowSpan: s.header.length, bold: true, alignment: 'center' },
              { text: 'Пара', rowSpan: s.header.length, bold: true, alignment: 'center' },
            ]
          : [{}, {}];
      const last = ri === s.header.length - 1;
      for (const h of row) {
        // Курс и семестр — на всю ширину своих столбцов, «ауд.» — только в нижней строке шапки
        const span = last ? h.span * 2 - 1 : h.span * 2;
        cells.push({ text: h.text, colSpan: span, bold: true, alignment: 'center' });
        for (let k = 1; k < span; k++) cells.push({});
        if (last) cells.push({ text: 'ауд.', fontSize: 6, alignment: 'center' });
      }
      body.push(cells);
    });
    for (const day of s.days) {
      day.rows.forEach((row, ri) => {
        const cells: unknown[] = [
          ri === 0
            ? {
                stack: [
                  { text: day.weekday, bold: true, fontSize: 6.5 },
                  { text: day.dateLabel, fontSize: 6.5 },
                ],
                rowSpan: day.rows.length,
                margin: [0, 2, 0, 0],
              }
            : {},
          { text: `${row.lessonNumber}\n${row.time}`, fontSize: 6, alignment: 'center', color: '#333333' },
        ];
        for (const c of row.cells) cells.push(...this.pdfCell(c, font));
        body.push(cells);
      });
    }
    const thick = new Set<number>([0, s.header.length]);
    let r = s.header.length;
    for (const day of s.days) {
      r += day.rows.length;
      thick.add(r);
    }
    return [
      approvals,
      ...title,
      {
        margin: [0, 6, 0, 0],
        table: { headerRows: s.header.length, widths, body, dontBreakRows: true },
        layout: {
          hLineWidth: (i: number) => (thick.has(i) ? 1.2 : 0.5),
          vLineWidth: () => 0.5,
        },
      },
      {
        columns: [
          { text: s.footerPosition, width: '*', alignment: 'right', margin: [0, 0, 24, 0] },
          { text: `____________ ${s.footerName}`, width: 'auto' },
        ],
        fontSize: 9,
        margin: [0, 10, 0, 0],
      },
    ];
  }

  private pdfCell(c: FormCell, font: number): unknown[] {
    const textSpan = c.span * 2 - 1;
    const cells: unknown[] = [];
    if (!c.subject) cells.push({ text: '' });
    else {
      cells.push({
        colSpan: textSpan,
        alignment: c.span > 1 ? 'center' : 'left',
        stack: [
          { text: c.type ? `${c.subject} (${c.type})` : c.subject, fontSize: font },
          c.teacher ? { text: `Преподаватель ${c.teacher}`, fontSize: font - 0.5 } : '',
        ],
      });
    }
    for (let k = 1; k < textSpan; k++) cells.push({});
    cells.push({ text: c.room ?? '', fontSize: font - 0.5, alignment: 'center' });
    return cells;
  }

  // ---------------------------------------------------------------- Excel

  async excelBuffer(sheets: FormSheet[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Расписание СПО и ВО';
    const used = new Set<string>();
    for (const s of sheets) {
      let name = (s.titleLines[1] ?? 'Расписание')
        .replace(/^\S+\s+/, '')
        .replace(/[\\/?*[\]:«»]/g, '')
        .slice(0, 28);
      let i = 2;
      while (used.has(name)) name = `${name.slice(0, 25)} ${i++}`;
      used.add(name);
      this.excelSheet(wb.addWorksheet(name || 'Расписание'), s);
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private excelSheet(ws: ExcelJS.Worksheet, s: FormSheet) {
    const n = s.columns.length;
    const lastCol = 2 + n * 2;
    const textWidth = n > 4 ? 26 : 34;
    ws.columns = [
      { width: 6 },
      { width: 9 },
      ...Array.from({ length: n }, () => [{ width: textWidth }, { width: 7 }]).flat(),
    ];
    ws.pageSetup = {
      paperSize: 9,
      orientation: n > 3 ? 'landscape' : 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0, footer: 0 },
    };
    let row = 1;
    // Грифы согласования и утверждения: равные блоки по ширине таблицы
    if (s.approvals.length) {
      const per = Math.max(1, Math.floor(lastCol / s.approvals.length));
      const lines = (a: FormSheet['approvals'][number]) => [
        a.heading,
        a.position,
        `____________ ${a.name}`,
        `«____» ______________ ${s.year} г.`,
      ];
      for (let li = 0; li < 4; li++) {
        s.approvals.forEach((a, ai) => {
          const c1 = 1 + ai * per;
          const c2 = ai === s.approvals.length - 1 ? lastCol : c1 + per - 1;
          ws.mergeCells(row, c1, row, c2);
          const cell = ws.getCell(row, c1);
          cell.value = lines(a)[li];
          cell.alignment = {
            horizontal: ai === s.approvals.length - 1 && ai > 0 ? 'right' : 'left',
            wrapText: true,
          };
          cell.font = { size: 10, bold: li === 0 };
        });
        row++;
      }
      row++;
    }
    s.titleLines.forEach((t, i) => {
      ws.mergeCells(row, 1, row, lastCol);
      const cell = ws.getCell(row, 1);
      cell.value = t;
      cell.alignment = { horizontal: 'center', wrapText: true };
      cell.font = { size: i === 0 ? 13 : 11, bold: i < 2 };
      row++;
    });
    row++;
    const style = (cell: ExcelJS.Cell, bold = false, center = true) => {
      cell.border = BORDER;
      cell.alignment = { horizontal: center ? 'center' : 'left', vertical: 'middle', wrapText: true };
      cell.font = { size: 10, bold };
    };
    const headTop = row;
    s.header.forEach((h, ri) => {
      let col = 3;
      const last = ri === s.header.length - 1;
      for (const cell of h) {
        const end = col + cell.span * 2 - (last ? 2 : 1);
        if (end > col) ws.mergeCells(row, col, row, end);
        ws.getCell(row, col).value = cell.text;
        style(ws.getCell(row, col), true);
        if (last) {
          const room = ws.getCell(row, end + 1);
          room.value = 'ауд.';
          style(room, false);
          room.font = { size: 8 };
        }
        col = last ? end + 2 : end + 1;
      }
      row++;
    });
    ws.mergeCells(headTop, 1, row - 1, 1);
    ws.mergeCells(headTop, 2, row - 1, 2);
    ws.getCell(headTop, 1).value = 'День';
    ws.getCell(headTop, 2).value = 'Пара';
    style(ws.getCell(headTop, 1), true);
    style(ws.getCell(headTop, 2), true);
    for (const day of s.days) {
      const top = row;
      for (const r of day.rows) {
        let lines = 2;
        const pair = ws.getCell(row, 2);
        pair.value = `${r.lessonNumber}\n${r.time}`;
        style(pair);
        pair.font = { size: 8 };
        let col = 3;
        for (const c of r.cells) {
          const end = col + c.span * 2 - 2;
          if (end > col) ws.mergeCells(row, col, row, end);
          const cell = ws.getCell(row, col);
          if (c.subject) {
            cell.value = `${c.type ? `${c.subject} (${c.type})` : c.subject}${c.teacher ? `\nПреподаватель ${c.teacher}` : ''}`;
          }
          style(cell, false, c.span > 1);
          // Высота строки по самой длинной ячейке: Excel не подбирает её сам для объединённых ячеек
          const chars = Math.max(10, (textWidth * c.span + 7 * (c.span - 1)) * 0.85);
          const text = String(cell.value ?? '');
          lines = Math.max(
            lines,
            text.split('\n').reduce((a, part) => a + Math.ceil(part.length / chars || 1), 0),
          );
          const room = ws.getCell(row, end + 1);
          room.value = c.room ?? '';
          style(room);
          col = end + 2;
        }
        ws.getRow(row).height = Math.max(28, lines * 14);
        row++;
      }
      ws.mergeCells(top, 1, row - 1, 1);
      const dayCell = ws.getCell(top, 1);
      dayCell.value = `${day.weekday}\n${day.dateLabel}`;
      style(dayCell, true);
      dayCell.alignment = { horizontal: 'center', vertical: 'middle', textRotation: 90, wrapText: true };
      for (let c = 1; c <= lastCol; c++) {
        ws.getCell(row - 1, c).border = { ...BORDER, bottom: { style: 'medium' } };
      }
    }
    row++;
    ws.mergeCells(row, 1, row, Math.max(2, lastCol - 2));
    ws.getCell(row, 1).value = s.footerPosition;
    ws.getCell(row, 1).alignment = { horizontal: 'right' };
    ws.getCell(row, 1).font = { size: 11 };
    if (lastCol - 1 > Math.max(2, lastCol - 2)) {
      ws.mergeCells(row, lastCol - 1, row, lastCol);
    }
    ws.getCell(row, lastCol - 1).value = `____________ ${s.footerName}`;
    ws.getCell(row, lastCol - 1).font = { size: 11 };
  }
}
