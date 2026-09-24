import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProgramStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { diffDays, parseDate, toDateStr } from '../common/utils/dates';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateAcademicYearDto,
  CreateProgramDto,
  CreateSemesterDto,
  UpdateAcademicYearDto,
  UpdateProgramDto,
  UpdateSemesterDto,
} from './dto/programs.dto';

@Injectable()
export class ProgramsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, status?: ProgramStatus) {
    const programs = await this.prisma.educationalProgram.findMany({
      where: { organizationId: actor.organizationId, status: status || undefined },
      include: {
        specialty: true,
        semesters: { orderBy: { number: 'asc' }, select: { id: true, number: true, courseNumber: true } },
        _count: { select: { groups: true, items: true, semesters: true } },
      },
      orderBy: [{ admissionYear: 'desc' }, { title: 'asc' }],
    });
    const hours = await this.hoursByProgram(programs.map((p) => p.id));
    return programs.map((p) => ({ ...p, hours: hours.get(p.id) ?? emptyHours() }));
  }

  async get(id: string, actor: AuthUser) {
    const program = await this.prisma.educationalProgram.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: {
        specialty: true,
        academicYears: { orderBy: { startDate: 'asc' } },
        semesters: { orderBy: { number: 'asc' }, include: { academicYear: { select: { id: true, title: true } } } },
        groups: { orderBy: { code: 'asc' } },
        cycles: { orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] },
        _count: { select: { items: true } },
      },
    });
    if (!program) throw new NotFoundException('Учебный план не найден');
    const bySemester = await this.hoursBySemester(program.id);
    return {
      ...program,
      semesters: program.semesters.map((s) => ({ ...s, hours: bySemester.get(s.id) ?? emptyHours() })),
      hours: (await this.hoursByProgram([program.id])).get(program.id) ?? emptyHours(),
    };
  }

  async ensureProgram(id: string, actor: AuthUser) {
    const program = await this.prisma.educationalProgram.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!program) throw new NotFoundException('Учебный план не найден');
    return program;
  }

  async create(dto: CreateProgramDto, actor: AuthUser) {
    const specialty = await this.prisma.specialty.findUnique({ where: { id: dto.specialtyId } });
    if (!specialty) throw new BadRequestException('Специальность не найдена');
    const program = await this.prisma.$transaction(async (tx) => {
      const created = await tx.educationalProgram.create({
        data: {
          organizationId: actor.organizationId,
          specialtyId: dto.specialtyId,
          title: dto.title.trim(),
          admissionYear: dto.admissionYear,
          studyForm: dto.studyForm,
          durationMonths: dto.durationMonths,
          totalSemesters: dto.totalSemesters,
          status: dto.status,
        },
      });
      if (dto.generateStructure !== false) {
        await this.generateStructure(tx, created.id, dto.admissionYear, dto.totalSemesters);
      }
      return created;
    });
    await this.audit.log(actor.id, 'CREATE', 'EducationalProgram', program.id, null, program);
    return this.get(program.id, actor);
  }

  /** Типовая структура: учебный год 1 сентября – 31 августа, 2 семестра в году */
  private async generateStructure(
    tx: Prisma.TransactionClient,
    programId: string,
    admissionYear: number,
    totalSemesters: number,
  ) {
    const years = Math.ceil(totalSemesters / 2);
    for (let i = 0; i < years; i++) {
      const y = admissionYear + i;
      const year = await tx.academicYear.create({
        data: {
          educationalProgramId: programId,
          title: `${y}–${y + 1}`,
          courseNumber: i + 1,
          startDate: parseDate(`${y}-09-01`),
          endDate: parseDate(`${y + 1}-08-31`),
        },
      });
      const autumn = i * 2 + 1;
      const spring = i * 2 + 2;
      if (autumn <= totalSemesters) {
        await tx.semester.create({
          data: {
            educationalProgramId: programId,
            academicYearId: year.id,
            number: autumn,
            courseNumber: i + 1,
            startDate: parseDate(`${y}-09-01`),
            endDate: parseDate(`${y}-12-31`),
            theoreticalWeeks: 16,
            examWeeks: 1,
            vacationWeeks: 2,
          },
        });
      }
      if (spring <= totalSemesters) {
        await tx.semester.create({
          data: {
            educationalProgramId: programId,
            academicYearId: year.id,
            number: spring,
            courseNumber: i + 1,
            startDate: parseDate(`${y + 1}-01-12`),
            endDate: parseDate(`${y + 1}-06-30`),
            theoreticalWeeks: 21,
            examWeeks: 2,
            vacationWeeks: 9,
          },
        });
      }
    }
  }

  async update(id: string, dto: UpdateProgramDto, actor: AuthUser) {
    const before = await this.ensureProgram(id, actor);
    const updated = await this.prisma.educationalProgram.update({ where: { id }, data: dto });
    await this.audit.log(actor.id, 'UPDATE', 'EducationalProgram', id, before, updated);
    return this.get(id, actor);
  }

  async remove(id: string, actor: AuthUser) {
    const before = await this.ensureProgram(id, actor);
    const lessons = await this.prisma.scheduleLesson.count({ where: { studentGroup: { educationalProgramId: id } } });
    if (lessons > 0) {
      throw new ConflictException(
        'Нельзя удалить учебный план, по которому уже составлено расписание. Переведите его в архив',
      );
    }
    await this.prisma.educationalProgram.delete({ where: { id } });
    await this.audit.log(actor.id, 'DELETE', 'EducationalProgram', id, before, null);
    return { success: true };
  }

  // ---------------------------------------------------------------- учебные годы

  async listAcademicYears(programId: string, actor: AuthUser) {
    await this.ensureProgram(programId, actor);
    return this.prisma.academicYear.findMany({
      where: { educationalProgramId: programId },
      orderBy: { startDate: 'asc' },
      include: { semesters: { orderBy: { number: 'asc' } } },
    });
  }

  async createAcademicYear(programId: string, dto: CreateAcademicYearDto, actor: AuthUser) {
    await this.ensureProgram(programId, actor);
    this.checkRange(dto.startDate, dto.endDate);
    const created = await this.prisma.academicYear.create({
      data: {
        educationalProgramId: programId,
        title: dto.title.trim(),
        courseNumber: dto.courseNumber,
        startDate: parseDate(dto.startDate),
        endDate: parseDate(dto.endDate),
      },
    });
    await this.audit.log(actor.id, 'CREATE', 'AcademicYear', created.id, null, created);
    return created;
  }

  async updateAcademicYear(id: string, dto: UpdateAcademicYearDto, actor: AuthUser) {
    const before = await this.prisma.academicYear.findFirst({
      where: { id, program: { organizationId: actor.organizationId } },
    });
    if (!before) throw new NotFoundException('Учебный год не найден');
    const start = dto.startDate ?? toDateStr(before.startDate);
    const end = dto.endDate ?? toDateStr(before.endDate);
    this.checkRange(start, end);
    const updated = await this.prisma.academicYear.update({
      where: { id },
      data: {
        title: dto.title,
        courseNumber: dto.courseNumber,
        startDate: dto.startDate ? parseDate(dto.startDate) : undefined,
        endDate: dto.endDate ? parseDate(dto.endDate) : undefined,
      },
    });
    await this.audit.log(actor.id, 'UPDATE', 'AcademicYear', id, before, updated);
    return updated;
  }

  async removeAcademicYear(id: string, actor: AuthUser) {
    const before = await this.prisma.academicYear.findFirst({
      where: { id, program: { organizationId: actor.organizationId } },
      include: { _count: { select: { schedulePeriods: true } } },
    });
    if (!before) throw new NotFoundException('Учебный год не найден');
    if (before._count.schedulePeriods > 0) {
      throw new ConflictException('Нельзя удалить учебный год, для которого созданы периоды расписания');
    }
    await this.prisma.academicYear.delete({ where: { id } });
    await this.audit.log(actor.id, 'DELETE', 'AcademicYear', id, before, null);
    return { success: true };
  }

  // ---------------------------------------------------------------- семестры

  async listSemesters(programId: string, actor: AuthUser) {
    await this.ensureProgram(programId, actor);
    const semesters = await this.prisma.semester.findMany({
      where: { educationalProgramId: programId },
      orderBy: { number: 'asc' },
      include: { academicYear: { select: { id: true, title: true } } },
    });
    const hours = await this.hoursBySemester(programId);
    return semesters.map((s) => ({ ...s, hours: hours.get(s.id) ?? emptyHours() }));
  }

  async getSemester(id: string, actor: AuthUser) {
    const semester = await this.prisma.semester.findFirst({
      where: { id, program: { organizationId: actor.organizationId } },
      include: {
        academicYear: true,
        program: { include: { specialty: true } },
      },
    });
    if (!semester) throw new NotFoundException('Семестр не найден');
    return semester;
  }

  /** Все семестры организации (для выбора в интерфейсе генерации) */
  async listAllSemesters(actor: AuthUser) {
    return this.prisma.semester.findMany({
      where: { program: { organizationId: actor.organizationId, status: { not: ProgramStatus.ARCHIVED } } },
      orderBy: [{ startDate: 'desc' }, { number: 'asc' }],
      include: {
        academicYear: { select: { id: true, title: true } },
        program: { select: { id: true, title: true, admissionYear: true } },
      },
    });
  }

  async createSemester(programId: string, dto: CreateSemesterDto, actor: AuthUser) {
    const program = await this.ensureProgram(programId, actor);
    if (dto.number > program.totalSemesters) {
      throw new BadRequestException(
        `Номер семестра превышает количество семестров учебного плана (${program.totalSemesters})`,
      );
    }
    const year = await this.prisma.academicYear.findFirst({
      where: { id: dto.academicYearId, educationalProgramId: programId },
    });
    if (!year) throw new BadRequestException('Учебный год не принадлежит данному учебному плану');
    this.checkRange(dto.startDate, dto.endDate);
    const created = await this.prisma.semester.create({
      data: {
        educationalProgramId: programId,
        academicYearId: dto.academicYearId,
        number: dto.number,
        courseNumber: dto.courseNumber,
        startDate: parseDate(dto.startDate),
        endDate: parseDate(dto.endDate),
        theoreticalWeeks: dto.theoreticalWeeks ?? Math.floor((diffDays(dto.endDate, dto.startDate) + 1) / 7),
        examWeeks: dto.examWeeks ?? 0,
        vacationWeeks: dto.vacationWeeks ?? 0,
        practiceWeeks: dto.practiceWeeks ?? 0,
      },
    });
    await this.audit.log(actor.id, 'CREATE', 'Semester', created.id, null, created);
    return created;
  }

  async updateSemester(id: string, dto: UpdateSemesterDto, actor: AuthUser) {
    const before = await this.getSemester(id, actor);
    const start = dto.startDate ?? toDateStr(before.startDate);
    const end = dto.endDate ?? toDateStr(before.endDate);
    this.checkRange(start, end);
    const updated = await this.prisma.semester.update({
      where: { id },
      data: {
        academicYearId: dto.academicYearId,
        number: dto.number,
        courseNumber: dto.courseNumber,
        startDate: dto.startDate ? parseDate(dto.startDate) : undefined,
        endDate: dto.endDate ? parseDate(dto.endDate) : undefined,
        theoreticalWeeks: dto.theoreticalWeeks,
        examWeeks: dto.examWeeks,
        vacationWeeks: dto.vacationWeeks,
        practiceWeeks: dto.practiceWeeks,
      },
    });
    await this.audit.log(actor.id, 'UPDATE', 'Semester', id, before, updated);
    return updated;
  }

  async removeSemester(id: string, actor: AuthUser) {
    const before = await this.getSemester(id, actor);
    const periods = await this.prisma.schedulePeriod.count({ where: { semesterId: id } });
    if (periods > 0) {
      throw new ConflictException('Нельзя удалить семестр, для которого созданы периоды расписания');
    }
    await this.prisma.semester.delete({ where: { id } });
    await this.audit.log(actor.id, 'DELETE', 'Semester', id, before, null);
    return { success: true };
  }

  private checkRange(start: string, end: string) {
    if (start > end) {
      throw new BadRequestException('Дата окончания не может быть раньше даты начала');
    }
  }

  // ---------------------------------------------------------------- агрегаты часов

  private async hoursBySemester(programId: string) {
    const rows = await this.prisma.semesterCurriculumItem.groupBy({
      by: ['semesterId'],
      where: { semester: { educationalProgramId: programId } },
      _sum: SUM_FIELDS,
    });
    return new Map(rows.map((r) => [r.semesterId, toHours(r._sum)]));
  }

  private async hoursByProgram(programIds: string[]) {
    const result = new Map<string, ReturnType<typeof emptyHours>>();
    if (programIds.length === 0) return result;
    const items = await this.prisma.semesterCurriculumItem.findMany({
      where: { semester: { educationalProgramId: { in: programIds } } },
      select: {
        semester: { select: { educationalProgramId: true } },
        totalHours: true,
        lectureHours: true,
        practicalHours: true,
        laboratoryHours: true,
        consultationHours: true,
        selfStudyHours: true,
        assessmentHours: true,
        practiceHours: true,
      },
    });
    for (const item of items) {
      const key = item.semester.educationalProgramId;
      const acc = result.get(key) ?? emptyHours();
      acc.total += item.totalHours;
      acc.lecture += item.lectureHours;
      acc.practical += item.practicalHours;
      acc.laboratory += item.laboratoryHours;
      acc.consultation += item.consultationHours;
      acc.selfStudy += item.selfStudyHours;
      acc.assessment += item.assessmentHours;
      acc.practice += item.practiceHours;
      result.set(key, acc);
    }
    return result;
  }
}

const SUM_FIELDS = {
  totalHours: true,
  lectureHours: true,
  practicalHours: true,
  laboratoryHours: true,
  consultationHours: true,
  selfStudyHours: true,
  assessmentHours: true,
  practiceHours: true,
} as const;

export function emptyHours() {
  return {
    total: 0,
    lecture: 0,
    practical: 0,
    laboratory: 0,
    consultation: 0,
    selfStudy: 0,
    assessment: 0,
    practice: 0,
  };
}

function toHours(sum: Record<string, number | null>) {
  return {
    total: sum.totalHours ?? 0,
    lecture: sum.lectureHours ?? 0,
    practical: sum.practicalHours ?? 0,
    laboratory: sum.laboratoryHours ?? 0,
    consultation: sum.consultationHours ?? 0,
    selfStudy: sum.selfStudyHours ?? 0,
    assessment: sum.assessmentHours ?? 0,
    practice: sum.practiceHours ?? 0,
  };
}
