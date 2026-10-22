import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleInit,
} from '@nestjs/common';
import { CalendarEventType, Holiday, HolidayKind, HolidayTransfer } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { eachDay, isoWeekday, parseDate, toDateStr } from '../common/utils/dates';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CreateHolidayDto, CreateTransferDto, UpdateHolidayDto } from './dto/holidays.dto';
import { DECREE_TRANSFERS, FEDERAL_HOLIDAYS } from './holiday-presets';
import {
  computeHolidayCalendar,
  HolidayCalendar,
  HolidayRuleInput,
  TransferRuleInput,
} from './holiday-rules';

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/**
 * Модуль «Праздники»: справочник праздников и переносов выходных, расчёт
 * производственного календаря и синхронизация нерабочих дней в календарный график
 * (события HOLIDAY с holidayYear), которые учитывают генерация, проверка и отчёты.
 */
@Injectable()
export class HolidaysService implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(HolidaysService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    // Смена режима недели (5/6 дней) меняет переносы — пересчитываем нерабочие дни
    this.settings.onWorkingDaysChanged((organizationId) => this.resyncAll(organizationId));
  }

  /** Организации без справочника праздников получают его при запуске — генерация сразу учитывает праздники */
  async onApplicationBootstrap() {
    try {
      const orgs = await this.prisma.organization.findMany({
        where: { OR: [{ settings: null }, { settings: { holidaysInitialized: false } }] },
        select: { id: true },
      });
      for (const o of orgs) await this.ensureInitialized(o.id);
    } catch (e) {
      this.logger.warn(`Не удалось заполнить справочник праздников: ${(e as Error).message}`);
    }
  }

  // ------------------------------------------------------------------ инициализация

  /** Заполняет справочник значениями по умолчанию при первом обращении организации */
  async ensureInitialized(organizationId: string): Promise<void> {
    const settings = await this.settings.getEffective(organizationId);
    if (settings.holidaysInitialized) return;
    const initialized = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.organizationSettings.updateMany({
        where: { organizationId, holidaysInitialized: false },
        data: { holidaysInitialized: true },
      });
      if (claimed.count === 0) return false; // параллельный запрос уже инициализировал
      await tx.holiday.createMany({
        data: FEDERAL_HOLIDAYS.map((h) => ({
          organizationId,
          title: h.title,
          kind: HolidayKind.FEDERAL,
          month: h.month,
          day: h.day,
          transferable: h.transferable,
        })),
      });
      await tx.holidayTransfer.createMany({
        data: DECREE_TRANSFERS.map((t) => ({
          organizationId,
          fromDate: parseDate(t.fromDate),
          toDate: parseDate(t.toDate),
          basis: t.basis,
        })),
        skipDuplicates: true,
      });
      // Праздники, ранее заведённые вручную в календарном графике (на всю организацию):
      // переносы и федеральные праздники заменяются расчётом, остальные — разовыми праздниками
      const legacy = await tx.calendarEvent.findMany({
        where: {
          organizationId,
          eventType: CalendarEventType.HOLIDAY,
          holidayYear: null,
          educationalProgramId: null,
          studentGroupId: null,
          teacherId: null,
          courseNumber: null,
        },
      });
      const federalMd = new Set(FEDERAL_HOLIDAYS.map((h) => `${pad(h.month)}-${pad(h.day)}`));
      const custom: Array<{ date: string; title: string; notes: string | null }> = [];
      for (const e of legacy) {
        const days = eachDay(e.startDate, e.endDate);
        if (days.length > 31 || e.title.startsWith('Перенос выходного')) continue;
        for (const d of days) {
          if (!federalMd.has(d.slice(5))) custom.push({ date: d, title: e.title, notes: e.notes });
        }
      }
      if (custom.length) {
        await tx.holiday.createMany({
          data: custom.map((c) => ({
            organizationId,
            title: c.title,
            kind: HolidayKind.CUSTOM,
            date: parseDate(c.date),
            notes: c.notes,
          })),
        });
      }
      if (legacy.length) {
        await tx.calendarEvent.deleteMany({ where: { id: { in: legacy.map((e) => e.id) } } });
      }
      return true;
    });
    if (!initialized) return;
    await this.resyncAll(organizationId);
    this.logger.log(`Справочник праздников заполнен для организации ${organizationId}`);
  }

  /** Годы, для которых нерабочие дни нужны в календаре: учебные годы организации, текущий и следующий */
  private async relevantYears(organizationId: string): Promise<number[]> {
    const years = new Set<number>();
    const now = new Date().getUTCFullYear();
    years.add(now);
    years.add(now + 1);
    const academicYears = await this.prisma.academicYear.findMany({
      where: { program: { organizationId } },
      select: { startDate: true, endDate: true },
    });
    for (const y of academicYears) {
      for (let year = y.startDate.getUTCFullYear(); year <= y.endDate.getUTCFullYear(); year++)
        years.add(year);
    }
    const synced = await this.prisma.calendarEvent.findMany({
      where: { organizationId, holidayYear: { not: null } },
      distinct: ['holidayYear'],
      select: { holidayYear: true },
    });
    for (const s of synced) years.add(s.holidayYear!);
    return [...years].filter((y) => y >= MIN_YEAR && y <= MAX_YEAR).sort();
  }

  // ------------------------------------------------------------------ расчёт и синхронизация

  async compute(organizationId: string, year: number): Promise<HolidayCalendar> {
    const [settings, holidays, transfers] = await Promise.all([
      this.settings.getEffective(organizationId),
      this.prisma.holiday.findMany({ where: { organizationId } }),
      this.prisma.holidayTransfer.findMany({ where: { organizationId } }),
    ]);
    return computeHolidayCalendar(
      year,
      settings.workingDays,
      holidays.map(toRule),
      transfers.map(toTransferRule),
      {
        autoTransfer: settings.holidayAutoTransfer,
      },
    );
  }

  /** Пересоздаёт нерабочие дни года в календарном графике */
  async syncYear(organizationId: string, year: number): Promise<HolidayCalendar> {
    const calendar = await this.compute(organizationId, year);
    const off = calendar.days.filter((d) => d.kind === 'HOLIDAY' || d.kind === 'TRANSFERRED_DAY_OFF');
    await this.prisma.$transaction([
      this.prisma.calendarEvent.deleteMany({ where: { organizationId, holidayYear: year } }),
      this.prisma.calendarEvent.createMany({
        data: off.map((d) => ({
          organizationId,
          eventType: CalendarEventType.HOLIDAY,
          title: d.title,
          startDate: parseDate(d.date),
          endDate: parseDate(d.date),
          blocksSchedule: true,
          holidayYear: year,
          notes: d.reason,
        })),
      }),
    ]);
    return calendar;
  }

  async resyncAll(organizationId: string, extraYears: number[] = []): Promise<void> {
    const years = new Set([...(await this.relevantYears(organizationId)), ...extraYears]);
    for (const year of years) await this.syncYear(organizationId, year);
  }

  // ------------------------------------------------------------------ чтение

  async calendar(actor: AuthUser, year: number) {
    assertYear(year);
    await this.ensureInitialized(actor.organizationId);
    const [calendar, settings, synced] = await Promise.all([
      this.compute(actor.organizationId, year),
      this.settings.getEffective(actor.organizationId),
      this.prisma.calendarEvent.count({ where: { organizationId: actor.organizationId, holidayYear: year } }),
    ]);
    return {
      ...calendar,
      autoTransfer: settings.holidayAutoTransfer,
      weekMode: settings.workingDays.includes(6) ? 'SIX_DAY' : 'FIVE_DAY',
      synced: synced > 0 || calendar.daysOff.length === 0,
    };
  }

  async listHolidays(actor: AuthUser) {
    await this.ensureInitialized(actor.organizationId);
    const rows = await this.prisma.holiday.findMany({ where: { organizationId: actor.organizationId } });
    return rows
      .map(serializeHoliday)
      .sort(
        (a, b) =>
          Number(!!a.date) - Number(!!b.date) ||
          (a.date ?? '').localeCompare(b.date ?? '') ||
          (a.month ?? 0) - (b.month ?? 0) ||
          (a.day ?? 0) - (b.day ?? 0),
      );
  }

  async listTransfers(actor: AuthUser, year?: number) {
    await this.ensureInitialized(actor.organizationId);
    const rows = await this.prisma.holidayTransfer.findMany({
      where: {
        organizationId: actor.organizationId,
        ...(year ? { fromDate: { gte: parseDate(`${year}-01-01`), lte: parseDate(`${year}-12-31`) } } : {}),
      },
      orderBy: { fromDate: 'asc' },
    });
    return rows.map(serializeTransfer);
  }

  // ------------------------------------------------------------------ изменение

  async createHoliday(dto: CreateHolidayDto, actor: AuthUser) {
    await this.ensureInitialized(actor.organizationId);
    const data = normalizeHoliday(dto);
    const created = await this.prisma.holiday.create({
      data: {
        organizationId: actor.organizationId,
        title: dto.title.trim(),
        kind: dto.kind ?? HolidayKind.CUSTOM,
        month: data.month,
        day: data.day,
        date: data.date ? parseDate(data.date) : null,
        transferable: dto.transferable ?? false,
        active: dto.active ?? true,
        notes: dto.notes?.trim() || null,
      },
    });
    await this.audit.log(actor.id, 'CREATE', 'Holiday', created.id, null, created);
    await this.resyncAll(actor.organizationId, data.date ? [Number(data.date.slice(0, 4))] : []);
    return serializeHoliday(created);
  }

  async updateHoliday(id: string, dto: UpdateHolidayDto, actor: AuthUser) {
    const before = await this.findHoliday(id, actor);
    const datesChanged = dto.month !== undefined || dto.day !== undefined || dto.date !== undefined;
    const merged = normalizeHoliday(
      datesChanged
        ? dto
        : { month: before.month, day: before.day, date: before.date ? toDateStr(before.date) : null },
    );
    const updated = await this.prisma.holiday.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        kind: dto.kind,
        month: merged.month,
        day: merged.day,
        date: merged.date ? parseDate(merged.date) : null,
        transferable: dto.transferable,
        active: dto.active,
        notes: dto.notes === undefined ? undefined : dto.notes?.trim() || null,
      },
    });
    await this.audit.log(actor.id, 'UPDATE', 'Holiday', id, before, updated);
    await this.resyncAll(actor.organizationId, merged.date ? [Number(merged.date.slice(0, 4))] : []);
    return serializeHoliday(updated);
  }

  async removeHoliday(id: string, actor: AuthUser) {
    const before = await this.findHoliday(id, actor);
    await this.prisma.holiday.delete({ where: { id } });
    await this.audit.log(actor.id, 'DELETE', 'Holiday', id, before, null);
    await this.resyncAll(actor.organizationId);
    return { success: true };
  }

  async createTransfer(dto: CreateTransferDto, actor: AuthUser) {
    await this.ensureInitialized(actor.organizationId);
    if (dto.fromDate === dto.toDate) throw new BadRequestException('Дни переноса должны различаться');
    const exists = await this.prisma.holidayTransfer.findFirst({
      where: { organizationId: actor.organizationId, fromDate: parseDate(dto.fromDate) },
    });
    if (exists) throw new BadRequestException('Перенос с этой даты уже добавлен');
    const created = await this.prisma.holidayTransfer.create({
      data: {
        organizationId: actor.organizationId,
        fromDate: parseDate(dto.fromDate),
        toDate: parseDate(dto.toDate),
        basis: dto.basis?.trim() || null,
      },
    });
    await this.audit.log(actor.id, 'CREATE', 'HolidayTransfer', created.id, null, created);
    await this.resyncAll(actor.organizationId, [
      Number(dto.fromDate.slice(0, 4)),
      Number(dto.toDate.slice(0, 4)),
    ]);
    return serializeTransfer(created);
  }

  async removeTransfer(id: string, actor: AuthUser) {
    const before = await this.prisma.holidayTransfer.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!before) throw new NotFoundException('Перенос не найден');
    await this.prisma.holidayTransfer.delete({ where: { id } });
    await this.audit.log(actor.id, 'DELETE', 'HolidayTransfer', id, before, null);
    await this.resyncAll(actor.organizationId);
    return { success: true };
  }

  async updateSettings(autoTransfer: boolean, actor: AuthUser) {
    await this.ensureInitialized(actor.organizationId);
    await this.prisma.organizationSettings.update({
      where: { organizationId: actor.organizationId },
      data: { holidayAutoTransfer: autoTransfer },
    });
    await this.audit.log(actor.id, 'UPDATE', 'HolidaySettings', actor.organizationId, null, { autoTransfer });
    await this.resyncAll(actor.organizationId);
    return { autoTransfer };
  }

  /** Восстанавливает федеральные праздники и переносы по постановлениям (свои праздники сохраняются) */
  async restoreDefaults(actor: AuthUser) {
    await this.ensureInitialized(actor.organizationId);
    const organizationId = actor.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await tx.holiday.deleteMany({ where: { organizationId, kind: HolidayKind.FEDERAL } });
      await tx.holiday.createMany({
        data: FEDERAL_HOLIDAYS.map((h) => ({
          organizationId,
          title: h.title,
          kind: HolidayKind.FEDERAL,
          month: h.month,
          day: h.day,
          transferable: h.transferable,
        })),
      });
      for (const t of DECREE_TRANSFERS) {
        await tx.holidayTransfer.upsert({
          where: { organizationId_fromDate: { organizationId, fromDate: parseDate(t.fromDate) } },
          create: {
            organizationId,
            fromDate: parseDate(t.fromDate),
            toDate: parseDate(t.toDate),
            basis: t.basis,
          },
          update: { toDate: parseDate(t.toDate), basis: t.basis },
        });
      }
    });
    await this.audit.log(actor.id, 'UPDATE', 'Holiday', organizationId, null, { restoreDefaults: true });
    await this.resyncAll(organizationId);
    return { success: true };
  }

  /** Добавляет нерабочие дни года в календарный график (для лет вне учебных годов) */
  async apply(actor: AuthUser, year: number) {
    assertYear(year);
    await this.ensureInitialized(actor.organizationId);
    const calendar = await this.syncYear(actor.organizationId, year);
    return { year, daysOff: calendar.daysOff.length };
  }

  private async findHoliday(id: string, actor: AuthUser): Promise<Holiday> {
    const h = await this.prisma.holiday.findFirst({ where: { id, organizationId: actor.organizationId } });
    if (!h) throw new NotFoundException('Праздник не найден');
    return h;
  }
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function assertYear(year: number) {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    throw new BadRequestException(`Год должен быть числом от ${MIN_YEAR} до ${MAX_YEAR}`);
  }
}

/** Праздник либо постоянный (месяц и день), либо разовый (дата) */
function normalizeHoliday(dto: { month?: number | null; day?: number | null; date?: string | null }) {
  if (dto.date) {
    const d = parseDate(dto.date);
    if (Number.isNaN(d.getTime()) || toDateStr(d) !== dto.date)
      throw new BadRequestException('Некорректная дата праздника');
    return { month: null, day: null, date: dto.date };
  }
  if (!dto.month || !dto.day) {
    throw new BadRequestException('Укажите дату разового праздника или день и месяц постоянного');
  }
  const probe = new Date(Date.UTC(2024, dto.month - 1, dto.day)); // високосный год: допускаем 29 февраля
  if (probe.getUTCMonth() !== dto.month - 1) throw new BadRequestException('В этом месяце нет такого дня');
  return { month: dto.month, day: dto.day, date: null };
}

function toRule(h: Holiday): HolidayRuleInput {
  return {
    id: h.id,
    title: h.title,
    month: h.month,
    day: h.day,
    date: h.date ? toDateStr(h.date) : null,
    transferable: h.transferable,
    active: h.active,
  };
}

function toTransferRule(t: HolidayTransfer): TransferRuleInput {
  return { id: t.id, fromDate: toDateStr(t.fromDate), toDate: toDateStr(t.toDate), basis: t.basis };
}

function serializeHoliday(h: Holiday) {
  return {
    id: h.id,
    title: h.title,
    kind: h.kind,
    month: h.month,
    day: h.day,
    date: h.date ? toDateStr(h.date) : null,
    transferable: h.transferable,
    active: h.active,
    notes: h.notes,
  };
}

function serializeTransfer(t: HolidayTransfer) {
  return {
    id: t.id,
    fromDate: toDateStr(t.fromDate),
    toDate: toDateStr(t.toDate),
    fromWeekday: isoWeekday(t.fromDate),
    toWeekday: isoWeekday(t.toDate),
    basis: t.basis,
  };
}
