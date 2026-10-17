import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CalendarEvent,
  CalendarEventType,
  ControlForm,
  LessonStatus,
  LessonType,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { addDaysStr, eachDay, isoWeekday, parseDate, toDateStr, weekStart } from '../common/utils/dates';
import { CALENDAR_EVENT_CODES, CALENDAR_EVENT_LABELS } from '../common/utils/labels';
import { defaultBlocksSchedule, PRACTICE_EVENT_TYPES } from '../planning/calendar-context';
import { PlanningService } from '../planning/planning.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  AutoPlaceAssessmentsDto,
  CreateAssessmentDto,
  CreateCalendarEventDto,
  SetWeekTypeDto,
  UpdateCalendarEventDto,
} from './dto/calendar.dto';

const ACTIVE_STATUSES: LessonStatus[] = [LessonStatus.PLANNED, LessonStatus.CONDUCTED, LessonStatus.REPLACED];
const EXAM_FORMS: ControlForm[] = [ControlForm.EXAM, ControlForm.QUALIFICATION_EXAM];
const CREDIT_FORMS: ControlForm[] = [
  ControlForm.CREDIT,
  ControlForm.DIFFERENTIATED_CREDIT,
  ControlForm.OTHER,
  ControlForm.COURSE_PROJECT,
];

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly planning: PlanningService,
    private readonly settings: SettingsService,
  ) {}

  // ---------------------------------------------------------------- события календаря

  listEvents(
    actor: AuthUser,
    params: {
      programId?: string;
      groupId?: string;
      teacherId?: string;
      from?: string;
      to?: string;
      eventType?: CalendarEventType;
    },
  ) {
    const where: Prisma.CalendarEventWhereInput = {
      organizationId: actor.organizationId,
      eventType: params.eventType || undefined,
      teacherId: params.teacherId || undefined,
      startDate: params.to ? { lte: parseDate(params.to) } : undefined,
      endDate: params.from ? { gte: parseDate(params.from) } : undefined,
    };
    if (params.programId) {
      // События программы + общие события организации
      where.OR = [
        { educationalProgramId: params.programId },
        { educationalProgramId: null, studentGroupId: null, teacherId: null },
      ];
    }
    if (params.groupId) {
      where.AND = [{ OR: [{ studentGroupId: params.groupId }, { studentGroupId: null }] }];
    }
    return this.prisma.calendarEvent.findMany({
      where,
      include: {
        program: { select: { id: true, title: true } },
        group: { select: { id: true, code: true } },
        teacher: { select: { id: true, fullName: true } },
        semester: { select: { id: true, number: true } },
      },
      orderBy: [{ startDate: 'asc' }, { eventType: 'asc' }],
    });
  }

  async createEvent(dto: CreateCalendarEventDto, actor: AuthUser) {
    await this.checkRelations(dto, actor);
    if (dto.startDate > dto.endDate) {
      throw new BadRequestException('Дата окончания периода не может быть раньше даты начала');
    }
    const created = await this.prisma.calendarEvent.create({
      data: {
        organizationId: actor.organizationId,
        educationalProgramId: dto.educationalProgramId ?? null,
        semesterId: dto.semesterId ?? null,
        studentGroupId: dto.studentGroupId ?? null,
        courseNumber: dto.courseNumber ?? null,
        teacherId: dto.teacherId ?? null,
        eventType: dto.eventType,
        title: dto.title.trim(),
        startDate: parseDate(dto.startDate),
        endDate: parseDate(dto.endDate),
        blocksSchedule: dto.blocksSchedule ?? defaultBlocksSchedule(dto.eventType),
        notes: dto.notes,
      },
    });
    await this.audit.log(actor.id, 'CREATE', 'CalendarEvent', created.id, null, created);
    return created;
  }

  async updateEvent(id: string, dto: UpdateCalendarEventDto, actor: AuthUser) {
    const before = await this.prisma.calendarEvent.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!before) throw new NotFoundException('Период календарного графика не найден');
    await this.checkRelations(dto, actor);
    const start = dto.startDate ?? toDateStr(before.startDate);
    const end = dto.endDate ?? toDateStr(before.endDate);
    if (start > end) throw new BadRequestException('Дата окончания периода не может быть раньше даты начала');
    const updated = await this.prisma.calendarEvent.update({
      where: { id },
      data: {
        educationalProgramId: dto.educationalProgramId,
        semesterId: dto.semesterId,
        studentGroupId: dto.studentGroupId,
        courseNumber: dto.courseNumber,
        teacherId: dto.teacherId,
        eventType: dto.eventType,
        title: dto.title?.trim(),
        startDate: dto.startDate ? parseDate(dto.startDate) : undefined,
        endDate: dto.endDate ? parseDate(dto.endDate) : undefined,
        blocksSchedule: dto.blocksSchedule,
        notes: dto.notes,
      },
    });
    await this.audit.log(actor.id, 'UPDATE', 'CalendarEvent', id, before, updated);
    return updated;
  }

  async removeEvent(id: string, actor: AuthUser) {
    const before = await this.prisma.calendarEvent.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!before) throw new NotFoundException('Период календарного графика не найден');
    await this.prisma.calendarEvent.delete({ where: { id } });
    await this.audit.log(actor.id, 'DELETE', 'CalendarEvent', id, before, null);
    return { success: true };
  }

  private async checkRelations(dto: UpdateCalendarEventDto, actor: AuthUser) {
    if (dto.educationalProgramId) {
      const p = await this.prisma.educationalProgram.findFirst({
        where: { id: dto.educationalProgramId, organizationId: actor.organizationId },
      });
      if (!p) throw new BadRequestException('Учебный план не найден');
    }
    if (dto.studentGroupId) {
      const g = await this.prisma.studentGroup.findFirst({
        where: { id: dto.studentGroupId, program: { organizationId: actor.organizationId } },
      });
      if (!g) throw new BadRequestException('Группа не найдена');
    }
    if (dto.teacherId) {
      const t = await this.prisma.teacher.findFirst({
        where: { id: dto.teacherId, organizationId: actor.organizationId },
      });
      if (!t) throw new BadRequestException('Преподаватель не найден');
    }
  }

  // ---------------------------------------------------------------- календарный учебный график (сетка недель)

  async calendarGraph(programId: string, actor: AuthUser, groupId?: string) {
    const program = await this.prisma.educationalProgram.findFirst({
      where: { id: programId, organizationId: actor.organizationId },
      include: {
        academicYears: { orderBy: { startDate: 'asc' } },
        semesters: { orderBy: { number: 'asc' } },
        groups: { orderBy: { code: 'asc' }, select: { id: true, code: true } },
      },
    });
    if (!program) throw new NotFoundException('Учебный план не найден');
    const settings = await this.settings.getEffective(actor.organizationId);
    if (program.academicYears.length === 0) {
      return { program, years: [], legend: this.legend() };
    }
    const from = toDateStr(program.academicYears[0].startDate);
    const to = toDateStr(program.academicYears[program.academicYears.length - 1].endDate);
    const events = await this.prisma.calendarEvent.findMany({
      where: {
        organizationId: actor.organizationId,
        teacherId: null,
        startDate: { lte: parseDate(to) },
        endDate: { gte: parseDate(from) },
        OR: [
          { educationalProgramId: programId, studentGroupId: groupId ? { in: [groupId] } : null },
          { educationalProgramId: programId, studentGroupId: null },
          { educationalProgramId: null, studentGroupId: null },
        ],
      },
    });

    const years = program.academicYears.map((year) => {
      const yearStart = toDateStr(year.startDate);
      const yearEnd = toDateStr(year.endDate);
      const weeks: Array<{
        index: number;
        start: string;
        end: string;
        type: CalendarEventType | null;
        code: string;
        label: string;
        mixed: boolean;
        holidays: number;
        workingDays: number;
        blockedDays: number;
        eventIds: string[];
      }> = [];
      let cursor = weekStart(yearStart);
      let index = 1;
      while (cursor <= yearEnd) {
        const wEnd = addDaysStr(cursor, 6);
        // Недели на границе учебных лет учитывают только дни своего учебного года
        const days = eachDay(cursor < yearStart ? yearStart : cursor, wEnd > yearEnd ? yearEnd : wEnd).filter(
          (d) => settings.workingDays.includes(isoWeekday(d)),
        );
        const counts = new Map<CalendarEventType, number>();
        let holidays = 0;
        let blockedDays = 0;
        const eventIds = new Set<string>();
        for (const d of days) {
          const dayEvents = events.filter(
            (e) =>
              toDateStr(e.startDate) <= d &&
              toDateStr(e.endDate) >= d &&
              (!e.courseNumber || e.courseNumber === year.courseNumber),
          );
          if (dayEvents.some((e) => e.blocksSchedule)) blockedDays++;
          for (const e of dayEvents) {
            eventIds.add(e.id);
            if (e.eventType === CalendarEventType.HOLIDAY) {
              holidays++;
              continue;
            }
            counts.set(e.eventType, (counts.get(e.eventType) ?? 0) + 1);
          }
        }
        const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
        let type: CalendarEventType | null = sorted[0]?.[0] ?? null;
        if (!type && holidays > 0 && holidays >= days.length) type = CalendarEventType.HOLIDAY;
        weeks.push({
          index,
          start: cursor,
          end: wEnd,
          type,
          code: type ? CALENDAR_EVENT_CODES[type] : '',
          label: type ? CALENDAR_EVENT_LABELS[type] : 'Не задано',
          mixed: sorted.length > 1,
          holidays,
          workingDays: days.length,
          blockedDays,
          eventIds: [...eventIds],
        });
        cursor = addDaysStr(cursor, 7);
        index++;
      }
      const summary: Record<string, number> = {};
      for (const w of weeks) if (w.type) summary[w.type] = (summary[w.type] ?? 0) + 1;
      return {
        academicYearId: year.id,
        title: year.title,
        courseNumber: year.courseNumber,
        startDate: yearStart,
        endDate: yearEnd,
        semesters: program.semesters
          .filter((s) => s.academicYearId === year.id)
          .map((s) => ({
            id: s.id,
            number: s.number,
            startDate: toDateStr(s.startDate),
            endDate: toDateStr(s.endDate),
          })),
        weeks,
        summary,
      };
    });
    return {
      program: { id: program.id, title: program.title, groups: program.groups },
      years,
      legend: this.legend(),
    };
  }

  legend() {
    return Object.keys(CALENDAR_EVENT_LABELS).map((type) => ({
      type,
      code: CALENDAR_EVENT_CODES[type],
      label: CALENDAR_EVENT_LABELS[type],
      blocksSchedule: defaultBlocksSchedule(type as CalendarEventType),
    }));
  }

  /**
   * Установка типа недели в календарном графике: пересекающиеся периоды того же
   * уровня (программа/курс/группа) обрезаются или разбиваются, соседние периоды
   * одного типа объединяются.
   */
  async setWeekType(programId: string, dto: SetWeekTypeDto, actor: AuthUser) {
    const program = await this.prisma.educationalProgram.findFirst({
      where: { id: programId, organizationId: actor.organizationId },
      include: { semesters: true },
    });
    if (!program) throw new NotFoundException('Учебный план не найден');
    const wStart = weekStart(dto.weekStart);
    const wEnd = addDaysStr(wStart, 6);
    const scope = {
      organizationId: actor.organizationId,
      educationalProgramId: programId,
      studentGroupId: dto.studentGroupId ?? null,
      courseNumber: dto.courseNumber ?? null,
      teacherId: null,
    };
    const semester = program.semesters.find(
      (s) => toDateStr(s.startDate) <= wEnd && toDateStr(s.endDate) >= wStart,
    );

    await this.prisma.$transaction(async (tx) => {
      const overlapping = await tx.calendarEvent.findMany({
        where: {
          ...scope,
          eventType: { not: CalendarEventType.HOLIDAY },
          startDate: { lte: parseDate(wEnd) },
          endDate: { gte: parseDate(wStart) },
        },
      });
      for (const e of overlapping) {
        const s = toDateStr(e.startDate);
        const en = toDateStr(e.endDate);
        const keepBefore = s < wStart;
        const keepAfter = en > wEnd;
        if (keepBefore) {
          await tx.calendarEvent.update({
            where: { id: e.id },
            data: { endDate: parseDate(addDaysStr(wStart, -1)) },
          });
        }
        if (keepAfter) {
          const data = copyEvent(e, addDaysStr(wEnd, 1), en);
          if (keepBefore) await tx.calendarEvent.create({ data });
          else
            await tx.calendarEvent.update({
              where: { id: e.id },
              data: { startDate: parseDate(addDaysStr(wEnd, 1)) },
            });
        }
        if (!keepBefore && !keepAfter) await tx.calendarEvent.delete({ where: { id: e.id } });
      }
      if (dto.eventType) {
        const prev = await tx.calendarEvent.findFirst({
          where: { ...scope, eventType: dto.eventType, endDate: parseDate(addDaysStr(wStart, -1)) },
        });
        const next = await tx.calendarEvent.findFirst({
          where: { ...scope, eventType: dto.eventType, startDate: parseDate(addDaysStr(wEnd, 1)) },
        });
        if (prev && next) {
          await tx.calendarEvent.update({ where: { id: prev.id }, data: { endDate: next.endDate } });
          await tx.calendarEvent.delete({ where: { id: next.id } });
        } else if (prev) {
          await tx.calendarEvent.update({ where: { id: prev.id }, data: { endDate: parseDate(wEnd) } });
        } else if (next) {
          await tx.calendarEvent.update({ where: { id: next.id }, data: { startDate: parseDate(wStart) } });
        } else {
          await tx.calendarEvent.create({
            data: {
              ...scope,
              semesterId: semester?.id ?? null,
              eventType: dto.eventType,
              title: CALENDAR_EVENT_LABELS[dto.eventType],
              startDate: parseDate(wStart),
              endDate: parseDate(wEnd),
              blocksSchedule: defaultBlocksSchedule(dto.eventType),
            },
          });
        }
      }
    });
    await this.audit.log(actor.id, 'SET_WEEK_TYPE', 'CalendarEvent', programId, null, {
      ...dto,
      weekStart: wStart,
    });
    return this.calendarGraph(programId, actor, dto.studentGroupId ?? undefined);
  }

  // ---------------------------------------------------------------- прогноз ёмкости семестра

  /**
   * Хватает ли учебных дней для выполнения всех часов:
   * доступно пар = учебные дни × пар в день − заблокированные периоды, праздники, практики.
   */
  async capacityForecast(semesterId: string, actor: AuthUser, groupId?: string) {
    const semester = await this.prisma.semester.findFirst({
      where: { id: semesterId, program: { organizationId: actor.organizationId } },
    });
    if (!semester) throw new NotFoundException('Семестр не найден');
    const settings = await this.settings.getEffective(actor.organizationId);
    const from = toDateStr(semester.startDate);
    const to = toDateStr(semester.endDate);
    const streams = await this.planning.getStreams({
      organizationId: actor.organizationId,
      semesterIds: [semesterId],
      groupIds: groupId ? [groupId] : undefined,
    });
    const groupIds = Array.from(new Set(streams.map((s) => s.groupId)));
    const groupsList = await this.prisma.studentGroup.findMany({
      where: {
        educationalProgramId: semester.educationalProgramId,
        id: groupId ? groupId : undefined,
        isActive: groupId ? undefined : true,
      },
      orderBy: { code: 'asc' },
    });
    for (const g of groupsList) if (!groupIds.includes(g.id)) groupIds.push(g.id);
    const ctx = await this.planning.buildCalendarContext(actor.organizationId, from, to, groupIds);
    const lessons = await this.prisma.scheduleLesson.groupBy({
      by: ['studentGroupId', 'status'],
      where: { studentGroupId: { in: groupIds }, semesterItem: { semesterId } },
      _count: { _all: true },
    });
    const days = eachDay(from, to);

    return groupsList.map((group) => {
      let workingDays = 0;
      let regularDays = 0;
      let blockedDays = 0;
      let practiceDays = 0;
      const blockedByType: Record<string, number> = {};
      const weekly = new Map<string, { weekStart: string; allowedDays: number; blockedDays: number }>();
      for (const d of days) {
        const info = ctx.groupDay(group.id, d);
        if (!info.isWorkingDay) continue;
        workingDays++;
        const wk = weekStart(d);
        const w = weekly.get(wk) ?? { weekStart: wk, allowedDays: 0, blockedDays: 0 };
        if (info.regularAllowed) {
          regularDays++;
          w.allowedDays++;
        } else {
          blockedDays++;
          w.blockedDays++;
          for (const b of info.blocks) blockedByType[b.eventType] = (blockedByType[b.eventType] ?? 0) + 1;
        }
        if (info.practiceTypes.length > 0) practiceDays++;
        weekly.set(wk, w);
      }
      const groupStreams = streams.filter((s) => s.groupId === group.id);
      const regular = groupStreams.filter((s) => s.lessonType !== LessonType.PRACTICE);
      const whole = regular
        .filter((s) => s.subgroupNumber === null)
        .reduce((a, s) => a + s.plannedLessons, 0);
      const bySubgroup = new Map<number, number>();
      for (const s of regular.filter((x) => x.subgroupNumber !== null)) {
        bySubgroup.set(s.subgroupNumber!, (bySubgroup.get(s.subgroupNumber!) ?? 0) + s.plannedLessons);
      }
      const subgroupValues = [...bySubgroup.values()];
      const maxSub = subgroupValues.length ? Math.max(...subgroupValues) : 0;
      const sumSub = subgroupValues.reduce((a, b) => a + b, 0);
      const requiredParallel = whole + maxSub;
      const requiredSequential = whole + sumSub;
      const practiceRequired = groupStreams
        .filter((s) => s.lessonType === LessonType.PRACTICE)
        .reduce((a, s) => a + s.plannedLessons, 0);
      const availableLessons = regularDays * settings.lessonsPerDay;
      const comfortableLessons = regularDays * settings.maxGroupLessonsPerDay;
      const counts = lessons.filter((l) => l.studentGroupId === group.id);
      const scheduled = counts
        .filter((c) => ACTIVE_STATUSES.includes(c.status))
        .reduce((a, c) => a + c._count._all, 0);
      const conducted = counts
        .filter((c) => c.status === LessonStatus.CONDUCTED)
        .reduce((a, c) => a + c._count._all, 0);
      const theoreticalWeeks = [...weekly.values()].filter((w) => w.allowedDays > 0).length;
      const status =
        requiredParallel > availableLessons
          ? 'INSUFFICIENT'
          : requiredParallel > comfortableLessons
            ? 'TIGHT'
            : 'OK';
      return {
        groupId: group.id,
        groupCode: group.code,
        semester: { id: semester.id, number: semester.number, startDate: from, endDate: to },
        workingDays,
        regularDays,
        blockedDays,
        practiceDays,
        blockedByType,
        theoreticalWeeks,
        lessonsPerDay: settings.lessonsPerDay,
        maxGroupLessonsPerDay: settings.maxGroupLessonsPerDay,
        availableLessons,
        comfortableLessons,
        requiredLessons: requiredParallel,
        requiredLessonsSequential: requiredSequential,
        practiceRequiredLessons: practiceRequired,
        averageLessonsPerWeek: theoreticalWeeks
          ? Math.round((requiredParallel / theoreticalWeeks) * 10) / 10
          : 0,
        scheduledLessons: scheduled,
        conductedLessons: conducted,
        status,
        message:
          status === 'INSUFFICIENT'
            ? `Не хватает учебного времени: требуется ${requiredParallel} пар, доступно ${availableLessons}`
            : status === 'TIGHT'
              ? `Плотный график: ${requiredParallel} пар при комфортной ёмкости ${comfortableLessons}`
              : `Учебного времени достаточно: требуется ${requiredParallel} пар из ${availableLessons} доступных`,
        weeks: [...weekly.values()],
      };
    });
  }

  // ---------------------------------------------------------------- контрольные мероприятия

  listAssessments(
    actor: AuthUser,
    params: { groupId?: string; semesterId?: string; from?: string; to?: string },
  ) {
    return this.prisma.assessmentEvent.findMany({
      where: {
        group: { program: { organizationId: actor.organizationId } },
        studentGroupId: params.groupId || undefined,
        semesterItem: params.semesterId ? { semesterId: params.semesterId } : undefined,
        date: {
          gte: params.from ? parseDate(params.from) : undefined,
          lte: params.to ? parseDate(params.to) : undefined,
        },
      },
      include: {
        group: { select: { id: true, code: true } },
        semesterItem: { include: { curriculumItem: { select: { code: true, name: true } } } },
        teacher: { select: { id: true, fullName: true } },
        classroom: { select: { id: true, code: true } },
      },
      orderBy: [{ date: 'asc' }, { lessonNumber: 'asc' }],
    });
  }

  async createAssessment(dto: CreateAssessmentDto, actor: AuthUser) {
    const group = await this.prisma.studentGroup.findFirst({
      where: { id: dto.studentGroupId, program: { organizationId: actor.organizationId } },
    });
    if (!group) throw new BadRequestException('Группа не найдена');
    const item = await this.prisma.semesterCurriculumItem.findFirst({
      where: {
        id: dto.semesterCurriculumItemId,
        semester: { educationalProgramId: group.educationalProgramId },
      },
    });
    if (!item) throw new BadRequestException('Дисциплина не относится к учебному плану группы');
    const created = await this.prisma.assessmentEvent.create({
      data: {
        studentGroupId: dto.studentGroupId,
        semesterCurriculumItemId: dto.semesterCurriculumItemId,
        controlForm: dto.controlForm ?? item.controlForm,
        date: parseDate(dto.date),
        lessonNumber: dto.lessonNumber,
        teacherId: dto.teacherId,
        classroomId: dto.classroomId,
        notes: dto.notes,
      },
    });
    await this.audit.log(actor.id, 'CREATE', 'AssessmentEvent', created.id, null, created);
    return created;
  }

  async removeAssessment(id: string, actor: AuthUser) {
    const before = await this.prisma.assessmentEvent.findFirst({
      where: { id, group: { program: { organizationId: actor.organizationId } } },
    });
    if (!before) throw new NotFoundException('Контрольное мероприятие не найдено');
    await this.prisma.assessmentEvent.delete({ where: { id } });
    await this.audit.log(actor.id, 'DELETE', 'AssessmentEvent', id, before, null);
    return { success: true };
  }

  /**
   * Автоматическая расстановка экзаменов по дням промежуточной аттестации
   * (не чаще одного экзамена в N дней) и зачётов — на последней неделе теоретического обучения.
   */
  async autoPlaceAssessments(dto: AutoPlaceAssessmentsDto, actor: AuthUser) {
    const semester = await this.prisma.semester.findFirst({
      where: { id: dto.semesterId, program: { organizationId: actor.organizationId } },
    });
    if (!semester) throw new NotFoundException('Семестр не найден');
    const gap = dto.minDaysBetween ?? 2;
    const from = toDateStr(semester.startDate);
    const to = toDateStr(semester.endDate);
    const groups = await this.prisma.studentGroup.findMany({
      where: {
        educationalProgramId: semester.educationalProgramId,
        id: dto.studentGroupId || undefined,
        isActive: true,
      },
    });
    const ctx = await this.planning.buildCalendarContext(
      actor.organizationId,
      from,
      addDaysStr(to, 14),
      groups.map((g) => g.id),
    );
    const items = await this.prisma.semesterCurriculumItem.findMany({
      where: { semesterId: semester.id, controlForm: { not: ControlForm.NONE } },
      include: {
        curriculumItem: true,
        assignments: { select: { studentGroupId: true, teacherId: true } },
      },
    });
    const warnings: string[] = [];
    let created = 0;
    for (const group of groups) {
      const existing = await this.prisma.assessmentEvent.findMany({
        where: { studentGroupId: group.id, semesterItem: { semesterId: semester.id } },
      });
      const done = new Set(existing.map((e) => e.semesterCurriculumItemId));
      const days = eachDay(from, addDaysStr(to, 14));
      const sessionDays = days.filter((d) => {
        const info = ctx.groupDay(group.id, d);
        return (
          info.isWorkingDay &&
          info.blocks.some((b) => b.eventType === CalendarEventType.EXAM_SESSION) &&
          info.blocks.every((b) => b.eventType === CalendarEventType.EXAM_SESSION)
        );
      });
      const regularDays = days.filter((d) => d <= to && ctx.isRegularAllowed(group.id, d));
      const lastWeekDays = regularDays.slice(-6);
      const exams = items.filter((i) => EXAM_FORMS.includes(i.controlForm) && !done.has(i.id));
      const credits = items.filter((i) => CREDIT_FORMS.includes(i.controlForm) && !done.has(i.id));
      let lastExam: string | null = null;
      for (const exam of exams) {
        const day = sessionDays.find((d) => !lastExam || diff(d, lastExam) > gap);
        if (!day) {
          warnings.push(
            `${group.code}: не хватает дней промежуточной аттестации для «${exam.curriculumItem.name}»`,
          );
          continue;
        }
        lastExam = day;
        await this.prisma.assessmentEvent.create({
          data: {
            studentGroupId: group.id,
            semesterCurriculumItemId: exam.id,
            controlForm: exam.controlForm,
            date: parseDate(day),
            lessonNumber: 1,
            teacherId: exam.assignments.find((a) => a.studentGroupId === group.id)?.teacherId ?? null,
          },
        });
        created++;
      }
      let i = 0;
      for (const credit of credits) {
        const day = lastWeekDays[i % Math.max(1, lastWeekDays.length)];
        if (!day) {
          warnings.push(`${group.code}: нет учебных дней для зачёта «${credit.curriculumItem.name}»`);
          continue;
        }
        i++;
        await this.prisma.assessmentEvent.create({
          data: {
            studentGroupId: group.id,
            semesterCurriculumItemId: credit.id,
            controlForm: credit.controlForm,
            date: parseDate(day),
            teacherId: credit.assignments.find((a) => a.studentGroupId === group.id)?.teacherId ?? null,
          },
        });
        created++;
      }
    }
    await this.audit.log(actor.id, 'AUTO_PLACE', 'AssessmentEvent', semester.id, null, { created, warnings });
    return { created, warnings };
  }

  /** Периоды практики программы — для отчёта по практике */
  async practicePeriods(actor: AuthUser, programId?: string) {
    return this.prisma.calendarEvent.findMany({
      where: {
        organizationId: actor.organizationId,
        educationalProgramId: programId || undefined,
        eventType: { in: PRACTICE_EVENT_TYPES },
      },
      include: {
        group: { select: { id: true, code: true } },
        program: { select: { id: true, title: true } },
      },
      orderBy: { startDate: 'asc' },
    });
  }
}

function diff(a: string, b: string): number {
  return Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / 86400000);
}

function copyEvent(e: CalendarEvent, start: string, end: string): Prisma.CalendarEventUncheckedCreateInput {
  return {
    organizationId: e.organizationId,
    educationalProgramId: e.educationalProgramId,
    semesterId: e.semesterId,
    studentGroupId: e.studentGroupId,
    courseNumber: e.courseNumber,
    teacherId: e.teacherId,
    eventType: e.eventType,
    title: e.title,
    startDate: parseDate(start),
    endDate: parseDate(end),
    blocksSchedule: e.blocksSchedule,
    notes: e.notes,
  };
}
