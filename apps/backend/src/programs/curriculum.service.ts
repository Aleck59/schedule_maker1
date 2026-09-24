import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CurriculumItemType, Prisma, SemesterCurriculumItem } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { computePlannedLessons } from '../common/utils/hours';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  CreateCurriculumItemDto,
  CreateCycleDto,
  SemesterHoursDto,
  UpdateCurriculumItemDto,
  UpdateCycleDto,
  UpdateSemesterItemDto,
} from './dto/programs.dto';
import { ProgramsService } from './programs.service';

type SemesterItemWithSemester = SemesterCurriculumItem & { semester: { id: string; number: number } };

export interface CurriculumNode {
  id: string;
  code: string;
  name: string;
  itemType: CurriculumItemType;
  isRequired: boolean;
  isDifficult: boolean;
  department: string | null;
  sortOrder: number;
  parentItemId: string | null;
  cycleId: string;
  semesters: SemesterItemWithSemester[];
  totals: Record<string, number>;
  children: CurriculumNode[];
}

const PRACTICE_TYPES: CurriculumItemType[] = [
  CurriculumItemType.EDUCATIONAL_PRACTICE,
  CurriculumItemType.INDUSTRIAL_PRACTICE,
  CurriculumItemType.PRE_DIPLOMA_PRACTICE,
];

@Injectable()
export class CurriculumService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly programs: ProgramsService,
    private readonly settings: SettingsService,
  ) {}

  // ---------------------------------------------------------------- циклы

  async listCycles(programId: string, actor: AuthUser) {
    await this.programs.ensureProgram(programId, actor);
    return this.prisma.curriculumCycle.findMany({
      where: { educationalProgramId: programId },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      include: { _count: { select: { items: true } } },
    });
  }

  async createCycle(programId: string, dto: CreateCycleDto, actor: AuthUser) {
    await this.programs.ensureProgram(programId, actor);
    const created = await this.prisma.curriculumCycle.create({
      data: {
        educationalProgramId: programId,
        code: dto.code.trim(),
        name: dto.name.trim(),
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.audit.log(actor.id, 'CREATE', 'CurriculumCycle', created.id, null, created);
    return created;
  }

  async updateCycle(id: string, dto: UpdateCycleDto, actor: AuthUser) {
    const before = await this.prisma.curriculumCycle.findFirst({
      where: { id, program: { organizationId: actor.organizationId } },
    });
    if (!before) throw new NotFoundException('Цикл учебного плана не найден');
    const updated = await this.prisma.curriculumCycle.update({ where: { id }, data: dto });
    await this.audit.log(actor.id, 'UPDATE', 'CurriculumCycle', id, before, updated);
    return updated;
  }

  async removeCycle(id: string, actor: AuthUser) {
    const before = await this.prisma.curriculumCycle.findFirst({
      where: { id, program: { organizationId: actor.organizationId } },
      include: { _count: { select: { items: true } } },
    });
    if (!before) throw new NotFoundException('Цикл учебного плана не найден');
    if (before._count.items > 0) {
      throw new ConflictException('Нельзя удалить цикл, содержащий дисциплины');
    }
    await this.prisma.curriculumCycle.delete({ where: { id } });
    await this.audit.log(actor.id, 'DELETE', 'CurriculumCycle', id, before, null);
    return { success: true };
  }

  // ---------------------------------------------------------------- дерево плана

  async tree(programId: string, actor: AuthUser, semesterId?: string) {
    const program = await this.programs.ensureProgram(programId, actor);
    const [cycles, items, semesters] = await Promise.all([
      this.prisma.curriculumCycle.findMany({
        where: { educationalProgramId: programId },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      }),
      this.prisma.curriculumItem.findMany({
        where: { educationalProgramId: programId },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        include: {
          semesterItems: {
            include: { semester: { select: { id: true, number: true } } },
            orderBy: { semester: { number: 'asc' } },
          },
        },
      }),
      this.prisma.semester.findMany({
        where: { educationalProgramId: programId },
        orderBy: { number: 'asc' },
        select: { id: true, number: true, courseNumber: true, startDate: true, endDate: true },
      }),
    ]);

    const nodes = new Map<string, CurriculumNode>();
    for (const item of items) {
      const semItems = semesterId
        ? item.semesterItems.filter((s) => s.semesterId === semesterId)
        : item.semesterItems;
      nodes.set(item.id, {
        id: item.id,
        code: item.code,
        name: item.name,
        itemType: item.itemType,
        isRequired: item.isRequired,
        isDifficult: item.isDifficult,
        department: item.department,
        sortOrder: item.sortOrder,
        parentItemId: item.parentItemId,
        cycleId: item.cycleId,
        semesters: semItems,
        totals: sumHours(semItems),
        children: [],
      });
    }
    const roots: CurriculumNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentItemId ? nodes.get(node.parentItemId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    // Итоги модулей — сумма по вложенным элементам
    const rollup = (node: CurriculumNode): Record<string, number> => {
      if (node.children.length === 0) return node.totals;
      const acc = { ...node.totals };
      for (const child of node.children) {
        const t = rollup(child);
        for (const [k, v] of Object.entries(t)) acc[k] = (acc[k] ?? 0) + v;
      }
      node.totals = acc;
      return acc;
    };
    roots.forEach(rollup);

    const prune = (list: CurriculumNode[]): CurriculumNode[] =>
      list
        .map((n) => ({ ...n, children: prune(n.children) }))
        .filter((n) => !semesterId || n.semesters.length > 0 || n.children.length > 0);

    const visibleRoots = prune(roots);
    return {
      program,
      semesters,
      cycles: cycles.map((c) => {
        const cycleItems = visibleRoots.filter((n) => n.cycleId === c.id);
        const totals: Record<string, number> = {};
        for (const n of cycleItems) {
          for (const [k, v] of Object.entries(n.totals)) totals[k] = (totals[k] ?? 0) + v;
        }
        return { ...c, items: cycleItems, totals };
      }),
    };
  }

  // ---------------------------------------------------------------- элементы плана

  async getItem(id: string, actor: AuthUser) {
    const item = await this.prisma.curriculumItem.findFirst({
      where: { id, program: { organizationId: actor.organizationId } },
      include: {
        cycle: true,
        parent: { select: { id: true, code: true, name: true } },
        children: { select: { id: true, code: true, name: true, itemType: true } },
        semesterItems: { include: { semester: true }, orderBy: { semester: { number: 'asc' } } },
      },
    });
    if (!item) throw new NotFoundException('Элемент учебного плана не найден');
    return item;
  }

  async createItem(programId: string, dto: CreateCurriculumItemDto, actor: AuthUser) {
    await this.programs.ensureProgram(programId, actor);
    await this.checkCycleAndParent(programId, dto.cycleId, dto.parentItemId ?? null, dto.itemType);
    const settings = await this.settings.getEffective(actor.organizationId);
    const item = await this.prisma.$transaction(async (tx) => {
      const created = await tx.curriculumItem.create({
        data: {
          educationalProgramId: programId,
          cycleId: dto.cycleId,
          parentItemId: dto.parentItemId ?? null,
          code: dto.code.trim(),
          name: dto.name.trim(),
          itemType: dto.itemType,
          isRequired: dto.isRequired ?? true,
          isDifficult: dto.isDifficult ?? false,
          department: dto.department,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      for (const sem of dto.semesters ?? []) {
        await this.upsertSemesterHours(
          tx,
          programId,
          created.id,
          dto.itemType,
          sem,
          settings.academicHoursPerLesson,
        );
      }
      return created;
    });
    await this.audit.log(actor.id, 'CREATE', 'CurriculumItem', item.id, null, dto);
    return this.getItem(item.id, actor);
  }

  async updateItem(id: string, dto: UpdateCurriculumItemDto, actor: AuthUser) {
    const before = await this.getItem(id, actor);
    const programId = before.educationalProgramId;
    if (dto.parentItemId === id) {
      throw new BadRequestException('Элемент не может быть родителем самого себя');
    }
    if (dto.cycleId !== undefined || dto.parentItemId !== undefined || dto.itemType !== undefined) {
      await this.checkCycleAndParent(
        programId,
        dto.cycleId ?? before.cycleId,
        dto.parentItemId === undefined ? before.parentItemId : dto.parentItemId,
        dto.itemType ?? before.itemType,
      );
    }
    const settings = await this.settings.getEffective(actor.organizationId);
    await this.prisma.$transaction(async (tx) => {
      await tx.curriculumItem.update({
        where: { id },
        data: {
          cycleId: dto.cycleId,
          parentItemId: dto.parentItemId,
          code: dto.code?.trim(),
          name: dto.name?.trim(),
          itemType: dto.itemType,
          isRequired: dto.isRequired,
          isDifficult: dto.isDifficult,
          department: dto.department,
          sortOrder: dto.sortOrder,
        },
      });
      if (dto.semesters) {
        const keep: string[] = [];
        for (const sem of dto.semesters) {
          const saved = await this.upsertSemesterHours(
            tx,
            programId,
            id,
            dto.itemType ?? before.itemType,
            sem,
            settings.academicHoursPerLesson,
          );
          keep.push(saved.semesterId);
        }
        // Семестры, не переданные в списке, удаляются (если по ним нет занятий)
        const toRemove = before.semesterItems.filter((s) => !keep.includes(s.semesterId));
        for (const s of toRemove) {
          const lessons = await tx.scheduleLesson.count({ where: { semesterCurriculumItemId: s.id } });
          if (lessons > 0) {
            throw new ConflictException(
              `Нельзя удалить часы ${s.semester.number}-го семестра: по ним уже есть занятия в расписании`,
            );
          }
          await tx.semesterCurriculumItem.delete({ where: { id: s.id } });
        }
      }
    });
    const after = await this.getItem(id, actor);
    await this.audit.log(actor.id, 'UPDATE', 'CurriculumItem', id, before, after);
    return after;
  }

  async removeItem(id: string, actor: AuthUser) {
    const before = await this.getItem(id, actor);
    const lessons = await this.prisma.scheduleLesson.count({
      where: { semesterItem: { curriculumItem: { OR: [{ id }, { parentItemId: id }] } } },
    });
    if (lessons > 0) {
      throw new ConflictException('Нельзя удалить дисциплину, по которой уже есть занятия в расписании');
    }
    await this.prisma.curriculumItem.delete({ where: { id } });
    await this.audit.log(actor.id, 'DELETE', 'CurriculumItem', id, before, null);
    return { success: true };
  }

  // ---------------------------------------------------------------- часы по семестрам

  async listSemesterItems(semesterId: string, actor: AuthUser) {
    const semester = await this.prisma.semester.findFirst({
      where: { id: semesterId, program: { organizationId: actor.organizationId } },
    });
    if (!semester) throw new NotFoundException('Семестр не найден');
    return this.prisma.semesterCurriculumItem.findMany({
      where: { semesterId },
      include: {
        curriculumItem: {
          include: {
            cycle: { select: { id: true, code: true, name: true } },
            parent: { select: { id: true, code: true, name: true } },
          },
        },
        semester: { select: { id: true, number: true, courseNumber: true } },
        _count: { select: { assignments: true } },
      },
      orderBy: [{ curriculumItem: { cycle: { sortOrder: 'asc' } } }, { curriculumItem: { code: 'asc' } }],
    });
  }

  async upsertItemSemester(itemId: string, dto: SemesterHoursDto, actor: AuthUser) {
    const item = await this.getItem(itemId, actor);
    const settings = await this.settings.getEffective(actor.organizationId);
    const saved = await this.prisma.$transaction((tx) =>
      this.upsertSemesterHours(
        tx,
        item.educationalProgramId,
        item.id,
        item.itemType,
        dto,
        settings.academicHoursPerLesson,
      ),
    );
    await this.audit.log(actor.id, 'UPSERT', 'SemesterCurriculumItem', saved.id, null, saved);
    return saved;
  }

  async updateSemesterItem(id: string, dto: UpdateSemesterItemDto, actor: AuthUser) {
    const before = await this.prisma.semesterCurriculumItem.findFirst({
      where: { id, semester: { program: { organizationId: actor.organizationId } } },
      include: { curriculumItem: true, semester: true },
    });
    if (!before) throw new NotFoundException('Часы дисциплины в семестре не найдены');
    const settings = await this.settings.getEffective(actor.organizationId);
    const saved = await this.prisma.$transaction((tx) =>
      this.upsertSemesterHours(
        tx,
        before.curriculumItem.educationalProgramId,
        before.curriculumItemId,
        before.curriculumItem.itemType,
        { ...dto, semesterId: before.semesterId },
        settings.academicHoursPerLesson,
        before,
      ),
    );
    await this.audit.log(actor.id, 'UPDATE', 'SemesterCurriculumItem', id, before, saved);
    return saved;
  }

  async removeSemesterItem(id: string, actor: AuthUser) {
    const before = await this.prisma.semesterCurriculumItem.findFirst({
      where: { id, semester: { program: { organizationId: actor.organizationId } } },
    });
    if (!before) throw new NotFoundException('Часы дисциплины в семестре не найдены');
    const lessons = await this.prisma.scheduleLesson.count({ where: { semesterCurriculumItemId: id } });
    if (lessons > 0) {
      throw new ConflictException('Нельзя удалить часы семестра: по ним уже есть занятия в расписании');
    }
    await this.prisma.semesterCurriculumItem.delete({ where: { id } });
    await this.audit.log(actor.id, 'DELETE', 'SemesterCurriculumItem', id, before, null);
    return { success: true };
  }

  /** Пересчёт плановых пар во всех строках плана (после смены «часов в паре») */
  async recomputeAllPlannedLessons(organizationId: string) {
    const settings = await this.settings.getEffective(organizationId);
    const items = await this.prisma.semesterCurriculumItem.findMany({
      where: { semester: { program: { organizationId } } },
    });
    for (const item of items) {
      await this.prisma.semesterCurriculumItem.update({
        where: { id: item.id },
        data: computePlannedLessons(item, settings.academicHoursPerLesson),
      });
    }
    return { updated: items.length };
  }

  private async upsertSemesterHours(
    tx: Prisma.TransactionClient,
    programId: string,
    itemId: string,
    itemType: CurriculumItemType,
    dto: SemesterHoursDto,
    academicHoursPerLesson: number,
    existing?: SemesterCurriculumItem,
  ) {
    let semesterId = dto.semesterId;
    if (!semesterId && dto.semesterNumber) {
      const sem = await tx.semester.findFirst({
        where: { educationalProgramId: programId, number: dto.semesterNumber },
      });
      if (!sem) {
        throw new BadRequestException(`В учебном плане нет ${dto.semesterNumber}-го семестра`);
      }
      semesterId = sem.id;
    }
    if (!semesterId) throw new BadRequestException('Укажите семестр');
    const semester = await tx.semester.findFirst({
      where: { id: semesterId, educationalProgramId: programId },
    });
    if (!semester) throw new BadRequestException('Семестр не принадлежит данному учебному плану');

    const current =
      existing ??
      (await tx.semesterCurriculumItem.findUnique({
        where: { curriculumItemId_semesterId: { curriculumItemId: itemId, semesterId } },
      }));

    const pick = (key: keyof SemesterHoursDto, fallback: number) =>
      (dto[key] as number | undefined) ??
      (current ? (current[key as keyof SemesterCurriculumItem] as number) : fallback);

    const hours = {
      lectureHours: pick('lectureHours', 0),
      practicalHours: pick('practicalHours', 0),
      laboratoryHours: pick('laboratoryHours', 0),
      consultationHours: pick('consultationHours', 0),
      selfStudyHours: pick('selfStudyHours', 0),
      assessmentHours: pick('assessmentHours', 0),
      practiceHours: pick('practiceHours', 0),
    };
    const isPractice = PRACTICE_TYPES.includes(itemType);
    if (itemType === CurriculumItemType.FINAL_ATTESTATION && hours.practiceHours > 0) {
      throw new BadRequestException('Для ГИА часы не ставятся в расписание — используйте календарный график');
    }
    const practiceAtCollege = dto.practiceAtCollege ?? current?.practiceAtCollege ?? false;
    const computedTotal = Object.values(hours).reduce((a, b) => a + b, 0);
    const totalHours =
      dto.totalHours ??
      (dto.totalHours === undefined && current && !hasHourChanges(dto) ? current.totalHours : computedTotal);
    if (totalHours < computedTotal) {
      throw new BadRequestException(
        `Общее количество часов (${totalHours}) меньше суммы часов по видам занятий (${computedTotal})`,
      );
    }
    const data = {
      ...hours,
      totalHours,
      controlForm: dto.controlForm ?? current?.controlForm ?? 'NONE',
      practiceAtCollege: isPractice ? practiceAtCollege : false,
      scheduleConsultations: dto.scheduleConsultations ?? current?.scheduleConsultations ?? true,
      lectureRoomTypes: dto.lectureRoomTypes ?? current?.lectureRoomTypes ?? [],
      practicalRoomTypes: dto.practicalRoomTypes ?? current?.practicalRoomTypes ?? [],
      laboratoryRoomTypes: dto.laboratoryRoomTypes ?? current?.laboratoryRoomTypes ?? [],
      consultationRoomTypes: dto.consultationRoomTypes ?? current?.consultationRoomTypes ?? [],
      practiceRoomTypes: dto.practiceRoomTypes ?? current?.practiceRoomTypes ?? [],
      notes: dto.notes ?? current?.notes ?? null,
      ...computePlannedLessons(hours, academicHoursPerLesson),
    };
    return tx.semesterCurriculumItem.upsert({
      where: { curriculumItemId_semesterId: { curriculumItemId: itemId, semesterId } },
      create: { curriculumItemId: itemId, semesterId, ...data },
      update: data,
    });
  }

  private async checkCycleAndParent(
    programId: string,
    cycleId: string,
    parentItemId: string | null,
    itemType: CurriculumItemType,
  ) {
    const cycle = await this.prisma.curriculumCycle.findFirst({
      where: { id: cycleId, educationalProgramId: programId },
    });
    if (!cycle) throw new BadRequestException('Цикл не принадлежит данному учебному плану');
    if (parentItemId) {
      const parent = await this.prisma.curriculumItem.findFirst({
        where: { id: parentItemId, educationalProgramId: programId },
      });
      if (!parent) throw new BadRequestException('Родительский элемент не найден в учебном плане');
      if (parent.itemType !== CurriculumItemType.MODULE) {
        throw new BadRequestException('Родительским элементом может быть только профессиональный модуль');
      }
      if (itemType === CurriculumItemType.MODULE) {
        throw new BadRequestException('Профессиональный модуль не может быть вложен в другой модуль');
      }
    }
  }
}

function hasHourChanges(dto: SemesterHoursDto): boolean {
  return (
    dto.lectureHours !== undefined ||
    dto.practicalHours !== undefined ||
    dto.laboratoryHours !== undefined ||
    dto.consultationHours !== undefined ||
    dto.selfStudyHours !== undefined ||
    dto.assessmentHours !== undefined ||
    dto.practiceHours !== undefined
  );
}

function sumHours(items: SemesterCurriculumItem[]): Record<string, number> {
  const acc: Record<string, number> = {
    total: 0,
    lecture: 0,
    practical: 0,
    laboratory: 0,
    consultation: 0,
    selfStudy: 0,
    assessment: 0,
    practice: 0,
  };
  for (const s of items) {
    acc.total += s.totalHours;
    acc.lecture += s.lectureHours;
    acc.practical += s.practicalHours;
    acc.laboratory += s.laboratoryHours;
    acc.consultation += s.consultationHours;
    acc.selfStudy += s.selfStudyHours;
    acc.assessment += s.assessmentHours;
    acc.practice += s.practiceHours;
  }
  return acc;
}
