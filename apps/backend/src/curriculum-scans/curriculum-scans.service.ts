import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ControlForm,
  CurriculumItemType,
  CurriculumScanStatus,
  EducationLevel,
  Prisma,
  StudyForm,
} from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate as validateDto } from 'class-validator';
import { randomUUID } from 'crypto';
import { mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { extname, join } from 'path';
import { AuditService } from '../audit/audit.service';
import { CacheService } from '../cache/cache.service';
import { AuthUser } from '../common/types/auth-user';
import { parseDate, toDateStr } from '../common/utils/dates';
import { flatten } from '../common/validation';
import { educationLevelByCode } from '../common/utils/education';
import { computePlannedLessons } from '../common/utils/hours';
import { CALENDAR_EVENT_LABELS } from '../common/utils/labels';
import { EngineService } from '../engine/engine.service';
import { defaultBlocksSchedule } from '../planning/calendar-context';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ApplyScanDto, ScanHoursDto, ScanItemDto, ScanItemKind } from './dto/curriculum-scan.dto';

export const SCAN_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp', '.webp'];
/** Файлы программы «Планы» (ММИС, GosInsp), совместимые с 1С:Университет: .plx и .xml */
export const PLAN_FILE_EXTENSIONS = ['.plx', '.xml'];
/** Пакетная загрузка: каждый файл .plx/.xml/PDF — отдельный учебный план */
export const BATCH_EXTENSIONS = [...PLAN_FILE_EXTENSIONS, '.pdf'];
export const BATCH_MAX_FILES = 100;
const RECOGNITION_TIMEOUT_MS = 30 * 60 * 1000;
const PLAN_FILE_TIMEOUT_MS = 2 * 60 * 1000;

/** Источник данных: скан (распознавание) или файл учебного плана */
export function isPlanFile(name: string) {
  return PLAN_FILE_EXTENSIONS.includes(extname(name).toLowerCase());
}

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
  /** plx — АС «Учебные планы», gosinsp — XML GosInsp; нет — распознанный скан */
  source?: 'plx' | 'gosinsp';
  title: Record<string, string | number | undefined>;
  semesters: Array<{
    number: number;
    course: number;
    startDate: string;
    endDate: string;
    weeks: Record<string, number>;
  }>;
  periods: Array<{ course: number; type: string; title?: string | null; startDate: string; endDate: string }>;
  cycles: Array<{ code: string; name: string }>;
  items: Array<{
    code: string;
    name: string;
    kind: ScanItemKind;
    cycleCode: string;
    parentCode: string | null;
    required?: boolean;
    issues: string[];
    semesters: Array<{ number: number; controlForm: string; hours: Record<string, number>; cells: unknown }>;
  }>;
  warnings: string[];
  stats?: { uncertain?: number };
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
  const level = (str(t.educationLevel) as EducationLevel) || educationLevelByCode(code);
  const semesterNumbers = plan.semesters.map((s) => s.number);
  return {
    specialty: {
      code,
      name,
      educationLevel: level,
      qualification: str(t.qualification),
      fgosNumber: str(t.fgosNumber) || undefined,
      fgosDate: str(t.fgosDate) || undefined,
    },
    program: {
      title: code || name ? `${code} ${name}, набор ${admissionYear}`.trim() : '',
      admissionYear,
      studyForm: (str(t.studyForm) || StudyForm.FULL_TIME) as StudyForm,
      // 6 семестров СПО — 2 г. 10 мес., 8 семестров бакалавриата — 4 года
      durationMonths:
        Number(t.durationMonths) ||
        Math.max(10, semesterNumbers.length * 6 - (level === EducationLevel.SPO ? 2 : 0)),
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
      .map((p) => ({
        course: p.course,
        type: p.type,
        title: p.title ?? undefined,
        startDate: p.startDate,
        endDate: p.endDate,
      })),
    cycles: plan.cycles,
    items: plan.items.map((i) => ({
      code: i.code,
      name: i.name,
      kind: i.kind,
      cycleCode: i.cycleCode,
      parentCode: i.parentCode,
      required: i.required ?? true,
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

/** Черновик → тело запроса на создание плана (без служебных полей распознавания), как на странице проверки */
export function draftToApplyPayload(draft: ReturnType<typeof toDraft>) {
  return {
    ...draft,
    program: { ...draft.program, title: draft.program.title.trim() || undefined },
    items: draft.items.map(({ issues: _issues, ...item }) => ({
      ...item,
      semesters: item.semesters.map(({ cells: _cells, ...s }) => s),
    })),
    group: undefined,
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
  let consultationHours = n(h.consultation);
  let selfStudyHours = n(h.selfStudy) + n(h.individualProject);
  const assessmentHours = n(h.assessment);
  let practiceHours = 0;
  let atCollege = false;
  if (PRACTICE_KINDS.includes(kind)) {
    // Практика: часы — по неделям календарного графика; на базе организации ставится в расписание
    atCollege = practiceAtCollege ?? kind === 'EDUCATIONAL_PRACTICE';
    practiceHours = atCollege ? n(h.total) : 0;
    lectureHours = practicalHours = laboratoryHours = consultationHours = selfStudyHours = 0;
  } else if (kind === 'MODULE_EXAM' || kind === 'FINAL_ATTESTATION' || kind === 'MODULE') {
    lectureHours = practicalHours = laboratoryHours = consultationHours = 0;
  }
  const parts =
    lectureHours +
    practicalHours +
    laboratoryHours +
    consultationHours +
    selfStudyHours +
    assessmentHours +
    practiceHours;
  const hours = {
    totalHours: Math.max(n(h.total), parts),
    lectureHours,
    practicalHours,
    laboratoryHours,
    consultationHours,
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
  /** Файлы .plx/.xml — тоже по одному, но в своей очереди: не ждут долгого распознавания сканов */
  private planChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: EngineService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly cache: CacheService,
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
      // Файлы .plx/.xml читаются без распознавания — нужен только Python-модуль
      fileImportAvailable: Boolean(info.available),
      fileImportError: info.available ? null : (info.error ?? 'Python-модуль недоступен'),
      fileFormats: PLAN_FILE_EXTENSIONS,
    };
  }

  list(actor: AuthUser, batchId?: string) {
    return this.prisma.curriculumScan.findMany({
      where: { organizationId: actor.organizationId, batchId: batchId || undefined },
      orderBy: batchId ? [{ createdAt: 'asc' }, { id: 'asc' }] : { createdAt: 'desc' },
      take: batchId ? BATCH_MAX_FILES : 50,
      select: {
        id: true,
        fileNames: true,
        status: true,
        progress: true,
        message: true,
        error: true,
        programId: true,
        batchId: true,
        autoApply: true,
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
    if (!files.length) {
      throw new BadRequestException('Загрузите файл учебного плана (.plx, .xml, PDF или изображения)');
    }
    const names = files.map((f) => Buffer.from(f.originalname, 'latin1').toString('utf8'));
    for (const name of names) {
      const ext = extname(name).toLowerCase();
      if (!SCAN_EXTENSIONS.includes(ext) && !PLAN_FILE_EXTENSIONS.includes(ext)) {
        throw new BadRequestException(
          `Файл «${name}» не поддерживается. Допустимые форматы: PLX, XML, PDF, JPG, PNG, TIFF, BMP, WEBP`,
        );
      }
    }
    const planFile = names.some(isPlanFile);
    if (planFile && files.length > 1) {
      throw new BadRequestException('Файл учебного плана .plx или .xml загружается по одному, без сканов');
    }
    const status = await this.status();
    if (planFile && !status.fileImportAvailable) {
      throw new ServiceUnavailableException(
        `Загрузка файлов учебного плана недоступна: ${status.fileImportError}`,
      );
    }
    if (!planFile && !status.available) {
      throw new ServiceUnavailableException(`Распознавание сканов недоступно: ${status.error}`);
    }
    const scan = await this.prisma.curriculumScan.create({
      data: {
        organizationId: actor.organizationId,
        createdById: actor.id,
        fileNames: names,
        message: planFile ? 'В очереди на чтение файла' : 'В очереди на распознавание',
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
    this.enqueue(scan.id, paths, dir, planFile);
    return scan;
  }

  /** Очередь обработки: файлы планов и сканы — каждая по одному файлу за раз */
  private enqueue(id: string, paths: string[], dir: string, planFile: boolean) {
    if (planFile) {
      // Чтение файла занимает доли секунды — отдельно от очереди распознавания
      this.planChain = this.planChain.then(() => this.process(id, paths, dir, true));
    } else {
      this.chain = this.chain.then(() => this.process(id, paths, dir, false));
    }
  }

  /**
   * Пакетная загрузка: каждый файл .plx/.xml/PDF становится отдельной загрузкой с общим batchId
   * и обрабатывается в фоне. При autoApply учебный план создаётся сразу, если в данных нет ошибок;
   * иначе загрузка остаётся «на проверке» с причиной.
   */
  async uploadBatch(files: Express.Multer.File[], autoApply: boolean, actor: AuthUser) {
    if (!files.length) throw new BadRequestException('Выберите файлы учебных планов');
    if (files.length > BATCH_MAX_FILES) {
      throw new BadRequestException(`За один раз можно загрузить не более ${BATCH_MAX_FILES} файлов`);
    }
    const names = files.map((f) => Buffer.from(f.originalname, 'latin1').toString('utf8'));
    const bad = names.filter((n) => !BATCH_EXTENSIONS.includes(extname(n).toLowerCase()));
    if (bad.length) {
      throw new BadRequestException(
        `Не поддерживается: ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? ' и др.' : ''}. ` +
          'В пакетной загрузке каждый файл — отдельный план: .plx, .xml или PDF. ' +
          'Фотографии страниц одного плана загружайте по одному плану.',
      );
    }
    const status = await this.status();
    const hasPlanFiles = names.some(isPlanFile);
    const hasScans = names.some((n) => !isPlanFile(n));
    if (hasPlanFiles && !status.fileImportAvailable) {
      throw new ServiceUnavailableException(
        `Загрузка файлов учебного плана недоступна: ${status.fileImportError}`,
      );
    }
    if (hasScans && !status.available) {
      throw new ServiceUnavailableException(
        `Распознавание сканов PDF недоступно: ${status.error}. Файлы .plx и .xml загружаются без распознавания.`,
      );
    }
    const batchId = randomUUID();
    const created: Array<{ id: string; fileName: string }> = [];
    for (const [i, f] of files.entries()) {
      const planFile = isPlanFile(names[i]);
      const scan = await this.prisma.curriculumScan.create({
        data: {
          organizationId: actor.organizationId,
          createdById: actor.id,
          fileNames: [names[i]],
          batchId,
          autoApply,
          message: planFile ? 'В очереди на чтение файла' : 'В очереди на распознавание',
        },
      });
      const dir = join(tmpdir(), 'curriculum-scans', scan.id);
      await mkdir(dir, { recursive: true });
      const path = join(dir, `01${extname(names[i]).toLowerCase()}`);
      await writeFile(path, f.buffer);
      this.enqueue(scan.id, [path], dir, planFile);
      created.push({ id: scan.id, fileName: names[i] });
    }
    await this.audit.log(actor.id, 'UPLOAD', 'CurriculumScan', batchId, null, {
      batch: true,
      autoApply,
      files: names,
    });
    return { batchId, count: created.length, scans: created };
  }

  private async process(id: string, paths: string[], dir: string, planFile: boolean): Promise<void> {
    let lastWrite = 0;
    try {
      await this.prisma.curriculumScan.update({
        where: { id },
        data: { message: planFile ? 'Чтение файла учебного плана' : 'Распознавание', progress: 0.01 },
      });
      const args = planFile ? ['import-plan', paths[0]] : ['recognize', ...paths];
      const result = await this.engine.run<Prisma.InputJsonValue>(args, {
        timeoutMs: planFile ? PLAN_FILE_TIMEOUT_MS : RECOGNITION_TIMEOUT_MS,
        onProgress: (fraction, message) => {
          const now = Date.now();
          if (now - lastWrite < 800) return;
          lastWrite = now;
          void this.prisma.curriculumScan
            .update({ where: { id }, data: { progress: Math.min(0.99, fraction), message } })
            .catch(() => undefined);
        },
      });
      const scan = await this.prisma.curriculumScan.update({
        where: { id },
        data: {
          status: CurriculumScanStatus.READY,
          progress: 1,
          message: planFile
            ? 'Файл прочитан — проверьте данные'
            : 'Распознавание завершено — проверьте данные',
          resultJson: result,
        },
      });
      if (scan.autoApply) await this.autoApply(id, planFile);
    } catch (e) {
      const message = (e as Error).message;
      this.logger.warn(`Скан ${id}: ошибка ${planFile ? 'чтения файла' : 'распознавания'}: ${message}`);
      await this.prisma.curriculumScan
        .update({
          where: { id },
          data: {
            status: CurriculumScanStatus.FAILED,
            error: message,
            message: planFile ? 'Ошибка чтения файла' : 'Ошибка распознавания',
          },
        })
        .catch(() => undefined);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      await this.notifyBatchDone(id).catch(() => undefined);
    }
  }

  /** Почему план нельзя создать без проверки (пусто — можно создавать) */
  async autoApplyBlockers(
    plan: RecognizedPlan,
    dto: ApplyScanDto,
    organizationId: string,
    planFile: boolean,
  ): Promise<string[]> {
    const reasons: string[] = [];
    const invalid = await validateDto(dto, { whitelist: true });
    reasons.push(...flatten(invalid));
    reasons.push(...this.validate(dto));
    if (!dto.items.some((i) => i.include !== false && i.kind !== 'GROUP')) {
      reasons.push('Не найдено ни одной дисциплины');
    }
    if (!planFile) {
      // Скан: сомнительные цифры распознавания проверяет человек
      const uncertain = plan.stats?.uncertain ?? 0;
      const withIssues = plan.items.filter((i) => i.issues?.length).length;
      if (uncertain > 0 || withIssues > 0) {
        reasons.push(
          `Скан распознан с сомнениями (${uncertain || withIssues} мест) — проверьте цифры вручную`,
        );
      }
    }
    const title =
      dto.program.title?.trim() ||
      `${dto.specialty.code} ${dto.specialty.name?.trim() ?? ''}, набор ${dto.program.admissionYear}`;
    const duplicate = await this.prisma.educationalProgram.findFirst({
      where: { organizationId, title },
      select: { id: true },
    });
    if (duplicate) reasons.push(`Учебный план «${title}» уже есть — повторно не создаётся`);
    return [...new Set(reasons)];
  }

  /** Создание учебного плана сразу после чтения файла (пакетная загрузка) */
  private async autoApply(id: string, planFile: boolean) {
    const scan = await this.prisma.curriculumScan.findUnique({ where: { id } });
    if (!scan?.resultJson) return;
    const plan = scan.resultJson as unknown as RecognizedPlan;
    const dto = plainToInstance(ApplyScanDto, draftToApplyPayload(toDraft(plan)));
    const blockers = await this.autoApplyBlockers(plan, dto, scan.organizationId, planFile);
    if (blockers.length) {
      await this.prisma.curriculumScan.update({
        where: { id },
        data: { message: `Нужна проверка: ${blockers[0]}`, error: blockers.join('\n') },
      });
      return;
    }
    const actor = await this.actorOf(scan.createdById, scan.organizationId);
    try {
      await this.apply(id, dto, actor);
      // Создано не из HTTP-запроса — сбросить кэш ответов явно
      await this.cache.invalidate();
      const warnings = plan.warnings?.length ?? 0;
      await this.prisma.curriculumScan.update({
        where: { id },
        data: {
          message: warnings
            ? `Учебный план создан, замечаний при чтении: ${warnings}`
            : 'Учебный план создан',
          error: null,
        },
      });
    } catch (e) {
      const err = e as Error & { getResponse?: () => unknown };
      const body = err.getResponse?.() as { errors?: string[] } | undefined;
      const reasons = body?.errors?.length ? body.errors : [err.message];
      this.logger.warn(`Скан ${id}: план не создан автоматически: ${reasons.join('; ')}`);
      await this.prisma.curriculumScan.update({
        where: { id },
        data: { message: `Нужна проверка: ${reasons[0]}`, error: reasons.join('\n') },
      });
    }
  }

  private async actorOf(userId: string | null, organizationId: string): Promise<AuthUser> {
    const user = userId
      ? await this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            fullName: true,
            role: true,
            teacherId: true,
            studentGroupId: true,
          },
        })
      : null;
    if (!user) throw new NotFoundException('Пользователь, загрузивший файл, не найден');
    return { ...user, organizationId };
  }

  /** Последний файл пакета обработан — уведомление тому, кто загружал */
  private async notifyBatchDone(id: string) {
    const scan = await this.prisma.curriculumScan.findUnique({
      where: { id },
      select: { batchId: true, createdById: true },
    });
    if (!scan?.batchId || !scan.createdById) return;
    const all = await this.prisma.curriculumScan.findMany({
      where: { batchId: scan.batchId },
      select: { status: true },
    });
    if (all.some((s) => s.status === CurriculumScanStatus.PROCESSING)) return;
    const applied = all.filter((s) => s.status === CurriculumScanStatus.APPLIED).length;
    const ready = all.filter((s) => s.status === CurriculumScanStatus.READY).length;
    const failed = all.filter((s) => s.status === CurriculumScanStatus.FAILED).length;
    const parts = [
      applied ? `создано планов: ${applied}` : '',
      ready ? `ждут проверки: ${ready}` : '',
      failed ? `с ошибкой: ${failed}` : '',
    ].filter(Boolean);
    await this.prisma.notification.create({
      data: {
        userId: scan.createdById,
        type: 'GENERAL',
        title: 'Загрузка учебных планов завершена',
        message: `Файлов: ${all.length}; ${parts.join(', ')}. Подробности — «Импорт учебного плана».`,
      },
    });
    await this.cache.invalidate();
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
    const source = (scan.resultJson as unknown as RecognizedPlan | null)?.source;
    const sourceLabel = source
      ? `файла учебного плана (${scan.fileNames[0] ?? source})`
      : 'скана учебного плана';
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
            educationLevel: dto.specialty.educationLevel ?? educationLevelByCode(dto.specialty.code),
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
              isRequired: item.required ?? true,
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
              notes: `Импортировано из ${sourceLabel}`.slice(0, 500),
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
      source: source ?? 'scan',
      scanId: id,
      ...counts,
    });
    return result;
  }
}
