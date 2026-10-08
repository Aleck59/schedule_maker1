import { BadRequestException, Injectable } from '@nestjs/common';
import { ControlForm, CurriculumItemType } from '@prisma/client';
import ExcelJS from 'exceljs';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { computePlannedLessons } from '../common/utils/hours';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ProgramsService } from './programs.service';

const COLUMNS = [
  { key: 'cycleCode', header: 'Цикл (код)', width: 10 },
  { key: 'cycleName', header: 'Цикл (наименование)', width: 30 },
  { key: 'code', header: 'Индекс', width: 12 },
  { key: 'name', header: 'Наименование', width: 45 },
  { key: 'type', header: 'Тип', width: 14 },
  { key: 'parent', header: 'Индекс ПМ (для МДК/практик)', width: 16 },
  { key: 'semester', header: 'Семестр', width: 9 },
  { key: 'total', header: 'Всего часов', width: 10 },
  { key: 'lecture', header: 'Лекции', width: 9 },
  { key: 'practical', header: 'Практические', width: 12 },
  { key: 'laboratory', header: 'Лабораторные', width: 12 },
  { key: 'consultation', header: 'Консультации', width: 12 },
  { key: 'selfStudy', header: 'Самост. работа', width: 12 },
  { key: 'assessment', header: 'Аттестация', width: 11 },
  { key: 'practice', header: 'Практика в колледже, ч', width: 14 },
  { key: 'control', header: 'Форма контроля', width: 18 },
  { key: 'difficult', header: 'Сложная (да/нет)', width: 12 },
] as const;

const TYPE_ALIASES: Record<string, CurriculumItemType> = {
  дисциплина: CurriculumItemType.DISCIPLINE,
  д: CurriculumItemType.DISCIPLINE,
  discipline: CurriculumItemType.DISCIPLINE,
  пм: CurriculumItemType.MODULE,
  модуль: CurriculumItemType.MODULE,
  module: CurriculumItemType.MODULE,
  мдк: CurriculumItemType.INTERDISCIPLINARY_COURSE,
  interdisciplinary_course: CurriculumItemType.INTERDISCIPLINARY_COURSE,
  уп: CurriculumItemType.EDUCATIONAL_PRACTICE,
  'учебная практика': CurriculumItemType.EDUCATIONAL_PRACTICE,
  educational_practice: CurriculumItemType.EDUCATIONAL_PRACTICE,
  пп: CurriculumItemType.INDUSTRIAL_PRACTICE,
  'производственная практика': CurriculumItemType.INDUSTRIAL_PRACTICE,
  industrial_practice: CurriculumItemType.INDUSTRIAL_PRACTICE,
  пдп: CurriculumItemType.PRE_DIPLOMA_PRACTICE,
  'преддипломная практика': CurriculumItemType.PRE_DIPLOMA_PRACTICE,
  pre_diploma_practice: CurriculumItemType.PRE_DIPLOMA_PRACTICE,
  гиа: CurriculumItemType.FINAL_ATTESTATION,
  final_attestation: CurriculumItemType.FINAL_ATTESTATION,
  элективная: CurriculumItemType.ELECTIVE,
  elective: CurriculumItemType.ELECTIVE,
};

const CONTROL_ALIASES: Record<string, ControlForm> = {
  '': ControlForm.NONE,
  '-': ControlForm.NONE,
  э: ControlForm.EXAM,
  экзамен: ControlForm.EXAM,
  exam: ControlForm.EXAM,
  з: ControlForm.CREDIT,
  зачёт: ControlForm.CREDIT,
  зачет: ControlForm.CREDIT,
  credit: ControlForm.CREDIT,
  дз: ControlForm.DIFFERENTIATED_CREDIT,
  'дифф. зачёт': ControlForm.DIFFERENTIATED_CREDIT,
  'дифференцированный зачёт': ControlForm.DIFFERENTIATED_CREDIT,
  'дифференцированный зачет': ControlForm.DIFFERENTIATED_CREDIT,
  differentiated_credit: ControlForm.DIFFERENTIATED_CREDIT,
  дфк: ControlForm.OTHER,
  'другая форма контроля': ControlForm.OTHER,
  другая: ControlForm.OTHER,
  other: ControlForm.OTHER,
  кп: ControlForm.COURSE_PROJECT,
  кр: ControlForm.COURSE_PROJECT,
  'курсовой проект': ControlForm.COURSE_PROJECT,
  course_project: ControlForm.COURSE_PROJECT,
  'э(к)': ControlForm.QUALIFICATION_EXAM,
  эк: ControlForm.QUALIFICATION_EXAM,
  'экзамен по модулю': ControlForm.QUALIFICATION_EXAM,
  qualification_exam: ControlForm.QUALIFICATION_EXAM,
};

export interface ImportResult {
  cyclesCreated: number;
  itemsCreated: number;
  itemsUpdated: number;
  semesterRows: number;
  errors: Array<{ row: number; message: string }>;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('result' in value && value.result !== undefined) return String(value.result);
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    if ('text' in value) return String(value.text);
  }
  return String(value).trim();
}

function toInt(value: string): number {
  if (!value) return 0;
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

/** Импорт учебного плана из Excel по шаблону */
@Injectable()
export class CurriculumImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly programs: ProgramsService,
    private readonly settings: SettingsService,
  ) {}

  async template(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Расписание СПО';
    const ws = wb.addWorksheet('Учебный план');
    ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { wrapText: true, vertical: 'middle' };
    ws.addRow({
      cycleCode: 'ОП',
      cycleName: 'Общепрофессиональный цикл',
      code: 'ОП.04',
      name: 'Основы алгоритмизации и программирования',
      type: 'Дисциплина',
      semester: 3,
      lecture: 34,
      practical: 34,
      selfStudy: 4,
      control: 'Другая форма контроля',
      difficult: 'да',
    });
    ws.addRow({
      cycleCode: 'П.ПМ',
      cycleName: 'Профессиональные модули',
      code: 'ПМ.01',
      name: 'Разработка модулей программного обеспечения для компьютерных систем',
      type: 'ПМ',
    });
    ws.addRow({
      cycleCode: 'П.ПМ',
      code: 'УП.01',
      name: 'Учебная практика',
      type: 'УП',
      parent: 'ПМ.01',
      semester: 4,
      practice: 72,
      control: 'ДЗ',
    });
    const help = wb.addWorksheet('Справка');
    help.columns = [
      { header: 'Поле', key: 'f', width: 30 },
      { header: 'Допустимые значения', key: 'v', width: 90 },
    ];
    help.addRows([
      { f: 'Тип', v: 'Дисциплина, ПМ, МДК, УП, ПП, ПДП, ГИА, Элективная' },
      { f: 'Форма контроля', v: 'Экзамен (Э), Зачёт (З), ДЗ, Другая форма контроля, КП, Э(к)' },
      {
        f: 'Часы',
        v: 'Самостоятельная работа и аттестация не ставятся в расписание автоматически. Практика в колледже — часы учебной практики, проводимой на базе колледжа',
      },
      { f: 'Повторы', v: 'Одна дисциплина может занимать несколько строк — по одной на каждый семестр' },
    ]);
    help.getRow(1).font = { bold: true };
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async import(programId: string, file: Buffer, actor: AuthUser): Promise<ImportResult> {
    await this.programs.ensureProgram(programId, actor);
    const settings = await this.settings.getEffective(actor.organizationId);
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException('Не удалось прочитать файл. Загрузите файл Excel (.xlsx) по шаблону');
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('Файл не содержит листов');

    // Определяем колонки по заголовкам
    const headerRow = ws.getRow(1);
    const colIndex = new Map<string, number>();
    headerRow.eachCell((cell, col) => {
      const text = cellText(cell.value).toLowerCase();
      const column = COLUMNS.find((c) => c.header.toLowerCase() === text);
      if (column) colIndex.set(column.key, col);
    });
    for (const required of ['code', 'name']) {
      if (!colIndex.has(required)) {
        throw new BadRequestException('В файле не найдены обязательные колонки «Индекс» и «Наименование»');
      }
    }

    const result: ImportResult = {
      cyclesCreated: 0,
      itemsCreated: 0,
      itemsUpdated: 0,
      semesterRows: 0,
      errors: [],
    };
    const semesters = await this.prisma.semester.findMany({ where: { educationalProgramId: programId } });
    const cycles = new Map(
      (await this.prisma.curriculumCycle.findMany({ where: { educationalProgramId: programId } })).map(
        (c) => [c.code, c],
      ),
    );
    const items = new Map(
      (await this.prisma.curriculumItem.findMany({ where: { educationalProgramId: programId } })).map((i) => [
        i.code,
        i,
      ]),
    );
    const touchedItems = new Set<string>();
    let lastCycleCode: string | null = null;

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const get = (key: string) => {
        const col = colIndex.get(key);
        return col ? cellText(row.getCell(col).value) : '';
      };
      const code = get('code');
      const name = get('name');
      if (!code && !name) continue;
      try {
        if (!code || !name) throw new Error('не заполнены индекс или наименование');
        const cycleCode: string | null = get('cycleCode') || lastCycleCode;
        if (!cycleCode) throw new Error('не указан цикл учебного плана');
        lastCycleCode = cycleCode;
        let cycle = cycles.get(cycleCode);
        if (!cycle) {
          cycle = await this.prisma.curriculumCycle.create({
            data: {
              educationalProgramId: programId,
              code: cycleCode,
              name: get('cycleName') || cycleCode,
              sortOrder: cycles.size,
            },
          });
          cycles.set(cycleCode, cycle);
          result.cyclesCreated++;
        }
        const typeRaw = get('type').toLowerCase();
        const itemType = typeRaw ? TYPE_ALIASES[typeRaw] : CurriculumItemType.DISCIPLINE;
        if (!itemType) throw new Error(`неизвестный тип «${get('type')}»`);
        const parentCode = get('parent');
        let parentItemId: string | null = null;
        if (parentCode) {
          const parent = items.get(parentCode);
          if (!parent) throw new Error(`не найден модуль «${parentCode}» (он должен быть выше в файле)`);
          parentItemId = parent.id;
        }
        const difficult = ['да', 'yes', '1', 'true', '+'].includes(get('difficult').toLowerCase());
        let item = items.get(code);
        if (!item) {
          item = await this.prisma.curriculumItem.create({
            data: {
              educationalProgramId: programId,
              cycleId: cycle.id,
              parentItemId,
              code,
              name,
              itemType,
              isDifficult: difficult,
              sortOrder: items.size,
            },
          });
          items.set(code, item);
          result.itemsCreated++;
        } else if (!touchedItems.has(item.id)) {
          item = await this.prisma.curriculumItem.update({
            where: { id: item.id },
            data: { cycleId: cycle.id, parentItemId, name, itemType, isDifficult: difficult },
          });
          items.set(code, item);
          result.itemsUpdated++;
        }
        touchedItems.add(item.id);

        const semesterRaw = get('semester');
        if (semesterRaw) {
          const number = toInt(semesterRaw);
          const semester = semesters.find((s) => s.number === number);
          if (!semester) throw new Error(`в учебном плане нет ${semesterRaw}-го семестра`);
          const hours = {
            lectureHours: toInt(get('lecture')),
            practicalHours: toInt(get('practical')),
            laboratoryHours: toInt(get('laboratory')),
            consultationHours: toInt(get('consultation')),
            selfStudyHours: toInt(get('selfStudy')),
            assessmentHours: toInt(get('assessment')),
            practiceHours: toInt(get('practice')),
          };
          if (Object.values(hours).some((v) => Number.isNaN(v) || v < 0)) {
            throw new Error('часы должны быть неотрицательными числами');
          }
          const sum = Object.values(hours).reduce((a, b) => a + b, 0);
          const total = get('total') ? toInt(get('total')) : sum;
          if (Number.isNaN(total) || total < sum) {
            throw new Error(`всего часов (${get('total')}) меньше суммы по видам занятий (${sum})`);
          }
          const controlForm = CONTROL_ALIASES[get('control').toLowerCase()];
          if (controlForm === undefined) throw new Error(`неизвестная форма контроля «${get('control')}»`);
          const isPractice = (
            [
              CurriculumItemType.EDUCATIONAL_PRACTICE,
              CurriculumItemType.INDUSTRIAL_PRACTICE,
              CurriculumItemType.PRE_DIPLOMA_PRACTICE,
            ] as CurriculumItemType[]
          ).includes(itemType);
          const data = {
            ...hours,
            totalHours: total,
            controlForm,
            practiceAtCollege: isPractice && hours.practiceHours > 0,
            ...computePlannedLessons(hours, settings.academicHoursPerLesson),
          };
          await this.prisma.semesterCurriculumItem.upsert({
            where: { curriculumItemId_semesterId: { curriculumItemId: item.id, semesterId: semester.id } },
            create: { curriculumItemId: item.id, semesterId: semester.id, ...data },
            update: data,
          });
          result.semesterRows++;
        }
      } catch (e) {
        result.errors.push({ row: r, message: `Строка ${r}: ${(e as Error).message}` });
      }
    }
    await this.audit.log(actor.id, 'IMPORT', 'EducationalProgram', programId, null, result);
    return result;
  }
}
