import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ControlForm, CurriculumItemType, CurriculumScanStatus, Prisma, StudyForm } from '@prisma/client';
import { mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { extname, join } from 'path';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { parseDate, toDateStr } from '../common/utils/dates';
import { computePlannedLessons } from '../common/utils/hours';
import { CALENDAR_EVENT_LABELS } from '../common/utils/labels';
import { EngineService } from '../engine/engine.service';
import { defaultBlocksSchedule } from '../planning/calendar-context';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ApplyScanDto, ScanHoursDto, ScanItemDto, ScanItemKind } from './dto/curriculum-scan.dto';

export const SCAN_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp', '.webp'];
const RECOGNITION_TIMEOUT_MS = 30 * 60 * 1000;

const ITEM_TYPES: Partial<Record<ScanItemKind, CurriculumItemType>> = {
  DISCIPLINE: CurriculumItemType.DISCIPLINE,
  MODULE: CurriculumItemType.MODULE,
  INTERDISCIPLINARY_COURSE: CurriculumItemType.INTERDISCIPLINARY_COURSE,
  EDUCATIONAL_PRACTICE: CurriculumItemType.EDUCATIONAL_PRACTICE,
  INDUSTRIAL_PRACTICE: CurriculumItemType.INDUSTRIAL_PRACTICE,
  PRE_DIPLOMA_PRACTICE: CurriculumItemType.PRE_DIPLOMA_PRACTICE,
  FINAL_ATTESTATION: CurriculumItemType.FINAL_ATTESTATION,
  ELECTIVE: CurriculumItemType.ELECTIVE,
};
const PRACTICE_KINDS: ScanItemKind[] = [
  'EDUCATIONAL_PRACTICE',
  'INDUSTRIAL_PRACTICE',
  'PRE_DIPLOMA_PRACTICE',
];

/** Результат распознавания (формат Python-модуля, см. apps/solver/app/ocr/plan.py) */
export interface RecognizedPlan {
  title: Record<string, string | number | undefined>;
  semesters: Array<{
    number: number;
    course: number;
    startDate: string;
    endDate: string;
    weeks: Record<string, number>;
  }>;
  periods: Array<{ course: number; type: string; startDate: string; endDate: string }>;
  cycles: Array<{ code: string; name: string }>;
  items: Array<{
    code: string;
    name: string;
    kind: ScanItemKind;
    cycleCode: string;
    parentCode: string | null;
    issues: string[];
    semesters: Array<{ number: number; controlForm: string; hours: Record<string, number>; cells: unknown }>;
  }>;
  warnings: string[];
}

/** Черновик для формы проверки: данные скана в формате запроса на создание учебного плана */
export function toDraft(plan: RecognizedPlan) {
  const t = plan.title ?? {};
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const admissionYear =
    Number(t.admissionYear) ||
    (plan.semesters[0] ? Number(plan.semesters[0].startDate.slice(0, 4)) : new Date().getFullYear());
  const code = str(t.specialtyCode);
  const name = str(t.specialtyName);
  const semesterNumbers = plan.semesters.map((s) => s.number);
  return {
    specialty: {
      code,
      name,
      qualification: str(t.qualification),
      fgosNumber: str(t.fgosNumber) || undefined,
      fgosDate: str(t.fgosDate) || undefined,
    },
    program: {
      title: code || name ? `${code} ${name}, набор ${admissionYear}`.trim() : '',
      admissionYear,
      studyForm: (str(t.studyForm) || StudyForm.FULL_TIME) as StudyForm,
      durationMonths: Number(t.durationMonths) || Math.max(10, semesterNumbers.length * 5),
    },
    semesters: plan.semesters.map((s) => ({
      number: s.number,
      course: s.course,
      startDate: s.startDate,
      endDate: s.endDate,
      theoryWeeks: s.weeks?.theory ?? 0,
      examWeeks: s.weeks?.exam ?? 0,
      vacationWeeks: s.weeks?.vacation ?? 0,
      practiceWeeks: s.weeks?.practice ?? 0,
    })),
    periods: plan.periods
      .filter((p) => p.type in CALENDAR_EVENT_LABELS)
      .map((p) => ({ course: p.course, type: p.type, startDate: p.startDate, endDate: p.endDate })),
    cycles: plan.cycles,
    items: plan.items.map((i) => ({
      code: i.code,
      name: i.name,
      kind: i.kind,
      cycleCode: i.cycleCode,
      parentCode: i.parentCode,
      include: i.kind !== 'GROUP',
      issues: i.issues,
      semesters: i.semesters
        .filter((s) => semesterNumbers.includes(s.number))
        .map((s) => ({
          number: s.number,
          controlForm: (i.kind === 'MODULE_EXAM'
            ? ControlForm.QUALIFICATION_EXAM
            : s.controlForm) as ControlForm,
          hours: s.hours,
          practiceAtCollege: PRACTICE_KINDS.includes(i.kind) ? i.kind === 'EDUCATIONAL_PRACTICE' : undefined,
          cells: s.cells,
        })),
    })),
    group: null,
  };
}

export interface ApplyScanResult {
  programId: string;
  groupId: string | null;
  created: {
    semesters: number;
    cycles: number;
    items: number;
    semesterItems: number;
    calendarEvents: number;
  };
}

/** Часы строки скана → поля строки учебного плана семестра */
export function semesterHours(
  kind: ScanItemKind,
  h: ScanHoursDto,
  practiceAtCollege: boolean | undefined,
  academicHoursPerLesson: number,
) {
  const n = (v: number | undefined) => Math.max(0, Math.round(v ?? 0));
  let lectureHours = n(h.lecture);
  let practicalHours = n(h.practical) + n(h.seminar);
  let laboratoryHours = n(h.laboratory);
  let selfStudyHours = n(h.selfStudy) + n(h.individualProject);
  const assessmentHours = n(h.assessment);
  let practiceHours = 0;
  let atCollege = false;
  if (PRACTICE_KINDS.includes(kind)) {
    // Практика: часы — по неделям календарного графика; на базе колледжа ставится в расписание
    atCollege = practiceAtCollege ?? kind === 'EDUCATIONAL_PRACTICE';
    practiceHours = atCollege ? n(h.total) : 0;
    lectureHours = practicalHours = laboratoryHours = selfStudyHours = 0;
  } else if (kind === 'MODULE_EXAM' || kind === 'FINAL_ATTESTATION' || kind === 'MODULE') {
    lectureHours = practicalHours = laboratoryHours = 0;
  }
  const parts =
    lectureHours + practicalHours + laboratoryHours + selfStudyHours + assessmentHours + practiceHours;
  const hours = {
    totalHours: Math.max(n(h.total), parts),
    lectureHours,
    practicalHours,
    laboratoryHours,
    consultationHours: 0,
    selfStudyHours,
    assessmentHours,
    practiceHours,
  };
  return {
    ...hours,
    practiceAtCollege: atCollege,
    ...computePlannedLessons(hours, academicHoursPerLesson),
  };
}

/**
 * Импорт учебного плана со скана: файл распознаётся Python-модулем (Tesseract OCR) в фоне,
 * результат проверяется администратором, затем по нему создаются специальность, учебный план,
 * учебные годы, семестры, циклы, дисциплины (ПМ, МДК, практики), часы по семестрам,
 * календарный график и (по желанию) учебная группа.
 */
@Injectable()
export class CurriculumScansService implements OnModuleInit {
  private readonly logger = new Logger(CurriculumScansService.name);
  /** Распознавание выполняется по одному файлу за раз (нагрузка на процессор) */
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: EngineService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async onModuleInit() {
    await this.prisma.curriculumScan.updateMany({
      where: { status: CurriculumScanStatus.PROCESSING },
      data: {
        status: CurriculumScanStatus.FAILED,
        error: 'Распознавание прервано перезапуском сервера — загрузите файл повторно',
      },
    });
  }

  async status() {
    const info = await this.engine.info();
    return {
      available: Boolean(info.available && info.ocr?.ready),
      tesseract: info.ocr?.version ?? null,
      languages: info.ocr?.languages ?? [],
      error: info.available ? (info.ocr?.error ?? null) : (info.error ?? 'Python-модуль недоступен'),
      formats: SCAN_EXTENSIONS,
    };
  }

  list(actor: AuthUser) {
    return this.prisma.curriculumScan.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        fileNames: true,
        status: true,
        progress: true,
        message: true,
        error: true,
        programId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async get(id: string, actor: AuthUser) {
    const scan = await this.prisma.curriculumScan.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!scan) throw new NotFoundException('Скан учебного плана не найден');
    return scan;
  }

  /** Скан с черновиком для проверки (после распознавания) */
  async getWithDraft(id: string, actor: AuthUser) {
    const scan = await this.get(id, actor);
    const result = scan.resultJson as unknown as RecognizedPlan | null;
    return { ...scan, draft: result ? toDraft(result) : null };
  }

  async remove(id: string, actor: AuthUser) {
    const scan = await this.get(id, actor);
    if (scan.status === CurriculumScanStatus.PROCESSING) {
      throw new ConflictException('Дождитесь окончания распознавания');
    }
    await this.prisma.curriculumScan.delete({ where: { id } });
    return { deleted: true };
  }

  async upload(files: Express.Multer.File[], actor: AuthUser) {
    if (!files.length) throw new BadRequestException('Загрузите файл учебного плана (PDF или изображения)');
    for (const f of files) {
      const ext = extname(f.originalname).toLowerCase();
      if (!SCAN_EXTENSIONS.includes(ext)) {
        throw new BadRequestException(
          `Файл «${f.originalname}» не поддерживается. Допустимые форматы: PDF, JPG, PNG, TIFF, BMP, WEBP`,
        );
      }
    }
    const status = await this.status();
    if (!status.available) {
      throw new ServiceUnavailableException(`Распознавание сканов недоступно: ${status.error}`);
    }
    const scan = await this.prisma.curriculumScan.create({
      data: {
        organizationId: actor.organizationId,
        createdById: actor.id,
        fileNames: files.map((f) => Buffer.from(f.originalname, 'latin1').toString('utf8')),
        message: 'В очереди на распознавание',
      },
    });
    const dir = join(tmpdir(), 'curriculum-scans', scan.id);
    await mkdir(dir, { recursive: true });
    const paths: string[] = [];
    for (const [i, f] of files.entries()) {
      const path = join(dir, `${String(i + 1).padStart(2, '0')}${extname(f.originalname).toLowerCase()}`);
      await writeFile(path, f.buffer);
      paths.push(path);
    }
    await this.audit.log(actor.id, 'UPLOAD', 'CurriculumScan', scan.id, null, { files: scan.fileNames });
    this.chain = this.chain.then(() => this.process(scan.id, paths, dir));
    return scan;
  }

  private async process(id: string, paths: string[], dir: string): Promise<void> {
    let lastWrite = 0;
    try {
      await this.prisma.curriculumScan.update({
        where: { id },
        data: { message: 'Распознавание', progress: 0.01 },
      });
      const result = await this.engine.run<Prisma.InputJsonValue>(['recognize', ...paths], {
        timeoutMs: RECOGNITION_TIMEOUT_MS,
        onProgress: (fraction, message) => {
          const now = Date.now();
          if (now - lastWrite < 800) return;
          lastWrite = now;
          void this.prisma.curriculumScan
            .update({ where: { id }, data: { progress: Math.min(0.99, fraction), message } })
            .catch(() => undefined);
        },
      });
      await this.prisma.curriculumScan.update({
        where: { id },
        data: {
          status: CurriculumScanStatus.READY,
          progress: 1,
          message: 'Распознавание завершено — проверьте данные',
          resultJson: result,
        },
      });
    } catch (e) {
      const message = (e as Error).message;
      this.logger.warn(`Скан ${id}: ошибка распознавания: ${message}`);
      await this.prisma.curriculumScan
        .update({
          where: { id },
          data: { status: CurriculumScanStatus.FAILED, error: message, message: 'Ошибка распознавания' },
        })
        .catch(() => undefined);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Проверка согласованности данных перед созданием учебного плана */
  private validate(dto: ApplyScanDto): string[] {
    const errors: string[] = [];
    const numbers = new Set<number>();
    for (const s of dto.semesters) {
      if (numbers.has(s.number)) errors.push(`Семестр ${s.number} указан дважды`);
      numbers.add(s.number);
      if (s.startDate > s.endDate) errors.push(`Семестр ${s.number}: дата начала позже даты окончания`);
      if (Math.ceil(s.number / 2) !== s.course) {
        errors.push(`Семестр ${s.number} не может относиться к ${s.course}-му курсу`);
      }
    }
    if (!dto.semesters.length) errors.push('Не указаны семестры');
    for (const p of dto.periods) {
      if (p.startDate > p.endDate) {
        errors.push(`Период «${CALENDAR_EVENT_LABELS[p.type]}» (${p.course} курс): начало позже окончания`);
      }
    }
    const codes = new Set<string>();
    for (const item of dto.items.filter((i) => i.include !== false)) {
      if (codes.has(item.code)) errors.push(`Индекс ${item.code} встречается несколько раз`);
      codes.add(item.code);
      for (const s of item.semesters) {
        if (!numbers.has(s.number)) errors.push(`${item.code}: в плане нет ${s.number}-го семестра`);
      }
    }
    return errors;
  }

  async apply(id: string, dto: ApplyScanDto, actor: AuthUser): Promise<ApplyScanResult> {
    const scan = await this.get(id, actor);
    if (scan.status === CurriculumScanStatus.APPLIED) {
      throw new ConflictException('Данные этого скана уже внесены в систему');
    }
    if (scan.status === CurriculumScanStatus.PROCESSING) {
      throw new ConflictException('Дождитесь окончания распознавания');
    }
    const errors = this.validate(dto);
    if (errors.length) {
      throw new BadRequestException({ message: 'Исправьте данные перед созданием учебного плана', errors });
    }
    const settings = await this.settings.getEffective(actor.organizationId);
    const perLesson = settings.academicHoursPerLesson;
    const items = dto.items.filter((i) => i.include !== false);
    const totalSemesters = Math.max(...dto.semesters.map((s) => s.number));
    const counts = { semesters: 0, cycles: 0, items: 0, semesterItems: 0, calendarEvents: 0 };

    const created = await this.prisma.$transaction(
      async (tx) => {
        const specialty = await tx.specialty.upsert({
          where: {
            code_qualification: {
              code: dto.specialty.code,
              qualification: dto.specialty.qualification.trim(),
            },
          },
          update: {},
          create: {
            code: dto.specialty.code,
            name: dto.specialty.name.trim(),
            qualification: dto.specialty.qualification.trim(),
            fgosNumber: dto.specialty.fgosNumber || null,
            fgosDate: dto.specialty.fgosDate ? parseDate(dto.specialty.fgosDate) : null,
            durationMonths: dto.program.durationMonths,
          },
        });
        const program = await tx.educationalProgram.create({
          data: {
            organizationId: actor.organizationId,
            specialtyId: specialty.id,
            title:
              dto.program.title?.trim() ||
              `${dto.specialty.code} ${dto.specialty.name.trim()}, набор ${dto.program.admissionYear}`,
            admissionYear: dto.program.admissionYear,
            studyForm: dto.program.studyForm ?? StudyForm.FULL_TIME,
            durationMonths: dto.program.durationMonths,
            totalSemesters,
          },
        });

        // Учебные годы и семестры
        const semesterIds = new Map<number, string>();
        const semesterRanges: Array<{
          id: string;
          number: number;
          course: number;
          start: string;
          end: string;
        }> = [];
        const courses = [...new Set(dto.semesters.map((s) => s.course))].sort((a, b) => a - b);
        for (const course of courses) {
          const y = dto.program.admissionYear + course - 1;
          const own = dto.semesters.filter((s) => s.course === course);
          const start = [`${y}-09-01`, ...own.map((s) => s.startDate)].sort()[0];
          const end = [`${y + 1}-08-31`, ...own.map((s) => s.endDate)].sort().at(-1)!;
          const year = await tx.academicYear.create({
            data: {
              educationalProgramId: program.id,
              title: `${y}–${y + 1}`,
              courseNumber: course,
              startDate: parseDate(start),
              endDate: parseDate(end),
            },
          });
          for (const s of own.sort((a, b) => a.number - b.number)) {
            const semester = await tx.semester.create({
              data: {
                educationalProgramId: program.id,
                academicYearId: year.id,
                number: s.number,
                courseNumber: course,
                startDate: parseDate(s.startDate),
                endDate: parseDate(s.endDate),
                theoreticalWeeks: Math.round(s.theoryWeeks ?? 0),
                examWeeks: Math.round(s.examWeeks ?? 0),
                vacationWeeks: Math.round(s.vacationWeeks ?? 0),
                practiceWeeks: Math.round(s.practiceWeeks ?? 0),
              },
            });
            semesterIds.set(s.number, semester.id);
            semesterRanges.push({
              id: semester.id,
              number: s.number,
              course,
              start: s.startDate,
              end: s.endDate,
            });
            counts.semesters++;
          }
        }

        // Циклы: из списка циклов и из строк-групп («СОО.01 Обязательная часть»)
        const cycleIds = new Map<string, string>();
        const cycleNames = new Map(dto.cycles.map((c) => [c.code.trim(), c.name.trim()]));
        for (const g of items.filter((i) => i.kind === 'GROUP')) {
          if (!cycleNames.has(g.code)) cycleNames.set(g.code, g.name.trim());
        }
        const ensureCycle = async (code: string) => {
          const existing = cycleIds.get(code);
          if (existing) return existing;
          const cycle = await tx.curriculumCycle.create({
            data: {
              educationalProgramId: program.id,
              code,
              name: cycleNames.get(code) ?? code,
              sortOrder: cycleIds.size,
            },
          });
          cycleIds.set(code, cycle.id);
          counts.cycles++;
          return cycle.id;
        };
        for (const code of cycleNames.keys()) {
          if (items.some((i) => i.kind !== 'GROUP' && i.cycleCode === code)) await ensureCycle(code);
        }

        // Элементы плана: сначала модули, затем остальные (МДК и практики ссылаются на модуль)
        const itemIds = new Map<string, string>();
        const createItem = async (item: ScanItemDto, type: CurriculumItemType, sortOrder: number) => {
          const parentId = item.parentCode ? (itemIds.get(item.parentCode) ?? null) : null;
          const record = await tx.curriculumItem.create({
            data: {
              educationalProgramId: program.id,
              cycleId: await ensureCycle(item.cycleCode.trim()),
              parentItemId: type === CurriculumItemType.MODULE ? null : parentId,
              code: item.code.trim(),
              name: item.name.trim(),
              itemType: type,
              isDifficult: item.isDifficult ?? false,
              sortOrder,
            },
          });
          itemIds.set(item.code, record.id);
          counts.items++;
          return record.id;
        };
        const ordered = items.map((item, index) => ({ item, index }));
        for (const { item, index } of ordered.filter((o) => o.item.kind === 'MODULE')) {
          await createItem(item, CurriculumItemType.MODULE, index);
        }
        // Экзамен по модулю без модуля на скане: модуль создаётся автоматически
        for (const { item, index } of ordered.filter((o) => o.item.kind === 'MODULE_EXAM')) {
          if (item.parentCode && !itemIds.has(item.parentCode)) {
            await createItem(
              { ...item, code: item.parentCode, name: `Профессиональный модуль ${item.parentCode.slice(3)}` },
              CurriculumItemType.MODULE,
              index,
            );
          }
        }
        const rows: Array<{ itemId: string; kind: ScanItemKind; item: ScanItemDto }> = [];
        for (const { item, index } of ordered) {
          const type = ITEM_TYPES[item.kind];
          if (item.kind === 'GROUP' || item.kind === 'MODULE_EXAM') continue;
          const itemId =
            item.kind === 'MODULE' ? itemIds.get(item.code)! : await createItem(item, type!, index);
          // Часы модуля — сумма МДК и практик, отдельно не импортируются
          if (item.kind !== 'MODULE') rows.push({ itemId, kind: item.kind, item });
        }
        for (const item of items.filter((i) => i.kind === 'MODULE_EXAM')) {
          const moduleId = item.parentCode ? itemIds.get(item.parentCode) : undefined;
          if (moduleId) {
            rows.push({
              itemId: moduleId,
              kind: 'MODULE_EXAM',
              item: {
                ...item,
                semesters: item.semesters.map((s) => ({ ...s, controlForm: ControlForm.QUALIFICATION_EXAM })),
              },
            });
          }
        }
        for (const { itemId, kind, item } of rows) {
          for (const s of item.semesters) {
            const data = {
              ...semesterHours(kind, s.hours, s.practiceAtCollege, perLesson),
              controlForm: s.controlForm,
            };
            await tx.semesterCurriculumItem.upsert({
              where: {
                curriculumItemId_semesterId: {
                  curriculumItemId: itemId,
                  semesterId: semesterIds.get(s.number)!,
                },
              },
              create: { curriculumItemId: itemId, semesterId: semesterIds.get(s.number)!, ...data },
              update: data,
            });
            counts.semesterItems++;
          }
        }

        // Календарный учебный график
        for (const p of dto.periods) {
          const semester = semesterRanges.find(
            (s) => s.course === p.course && p.startDate >= s.start && p.startDate <= s.end,
          );
          await tx.calendarEvent.create({
            data: {
              organizationId: actor.organizationId,
              educationalProgramId: program.id,
              semesterId: semester?.id ?? null,
              courseNumber: p.course,
              eventType: p.type,
              title: p.title?.trim() || `${CALENDAR_EVENT_LABELS[p.type]} (${p.course} курс)`,
              startDate: parseDate(p.startDate),
              endDate: parseDate(p.endDate),
              blocksSchedule: defaultBlocksSchedule(p.type),
              notes: 'Импортировано из скана учебного плана',
            },
          });
          counts.calendarEvents++;
        }

        // Учебная группа
        let groupId: string | null = null;
        if (dto.group) {
          const today = toDateStr(new Date());
          const sorted = [...semesterRanges].sort((a, b) => a.number - b.number);
          const current =
            sorted.find((s) => today >= s.start && today <= s.end) ??
            (today < sorted[0].start
              ? sorted[0]
              : (sorted.filter((s) => s.start <= today).at(-1) ?? sorted[0]));
          const subgroupCount = dto.group.subgroupCount ?? 1;
          const exists = await tx.studentGroup.findUnique({ where: { code: dto.group.code.trim() } });
          if (exists) throw new ConflictException(`Группа ${dto.group.code} уже существует`);
          const group = await tx.studentGroup.create({
            data: {
              educationalProgramId: program.id,
              code: dto.group.code.trim(),
              title: `${program.title}, группа ${dto.group.code.trim()}`,
              admissionYear: dto.program.admissionYear,
              courseNumber: current.course,
              currentSemesterNumber: current.number,
              studentCount: dto.group.studentCount,
              subgroupCount,
            },
          });
          if (subgroupCount > 1) {
            const base = Math.floor(dto.group.studentCount / subgroupCount);
            const extra = dto.group.studentCount % subgroupCount;
            await tx.subgroup.createMany({
              data: Array.from({ length: subgroupCount }, (_, i) => ({
                studentGroupId: group.id,
                number: i + 1,
                name: `Подгруппа ${i + 1}`,
                studentCount: base + (i < extra ? 1 : 0),
              })),
            });
          }
          groupId = group.id;
        }
        await tx.curriculumScan.update({
          where: { id },
          data: { status: CurriculumScanStatus.APPLIED, programId: program.id },
        });
        return { programId: program.id, groupId };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
    const result: ApplyScanResult = { ...created, created: counts };
    await this.audit.log(actor.id, 'IMPORT', 'EducationalProgram', created.programId, null, {
      source: 'scan',
      scanId: id,
      ...counts,
    });
    return result;
  }
}
