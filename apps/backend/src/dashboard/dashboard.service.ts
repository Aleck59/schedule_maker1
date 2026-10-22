import { Injectable } from '@nestjs/common';
import {
  ConductedStatus,
  LessonStatus,
  MakeupTaskStatus,
  SchedulePeriodStatus,
  UserRole,
} from '@prisma/client';
import { AuthUser } from '../common/types/auth-user';
import {
  addDaysStr,
  eachDay,
  isoWeekday,
  parseDate,
  toDateStr,
  todayInTimezone,
  weekStart,
  weekdayName,
} from '../common/utils/dates';
import { HourControlService } from '../hour-control/hour-control.service';
import { ACTIVE_STATUSES } from '../planning/hours-calculator';
import { PrismaService } from '../prisma/prisma.service';
import { presentLesson, ScheduleLessonsService } from '../schedule/schedule-lessons.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly hours: HourControlService,
    private readonly lessons: ScheduleLessonsService,
  ) {}

  async get(actor: AuthUser) {
    if (actor.role === UserRole.TEACHER) return this.teacher(actor);
    if (actor.role === UserRole.STUDENT) return this.student(actor);
    return this.staff(actor);
  }

  private async staff(actor: AuthUser) {
    const org = actor.organizationId;
    const settings = await this.settings.getEffective(org);
    const today = todayInTimezone(settings.timezone);
    const wFrom = weekStart(today);
    const wTo = addDaysStr(wFrom, 6);
    const [groups, teachers, classrooms, todayLessons, cancelled30, makeup, weekLessons, periods] =
      await Promise.all([
        this.prisma.studentGroup.count({ where: { program: { organizationId: org }, isActive: true } }),
        this.prisma.teacher.count({ where: { organizationId: org, isActive: true } }),
        this.prisma.classroom.findMany({
          where: { organizationId: org, isActive: true },
          select: { id: true, code: true, classroomType: true },
        }),
        this.prisma.scheduleLesson.count({
          where: {
            schedulePeriod: { organizationId: org },
            date: parseDate(today),
            status: { in: ACTIVE_STATUSES },
          },
        }),
        this.prisma.scheduleLesson.count({
          where: {
            schedulePeriod: { organizationId: org },
            status: LessonStatus.CANCELLED,
            date: { gte: parseDate(addDaysStr(today, -30)), lte: parseDate(addDaysStr(today, 30)) },
          },
        }),
        this.prisma.makeupTask.findMany({
          where: { group: { program: { organizationId: org } }, status: MakeupTaskStatus.OPEN },
          select: { academicHours: true },
        }),
        this.prisma.scheduleLesson.findMany({
          where: {
            schedulePeriod: { organizationId: org },
            date: { gte: parseDate(wFrom), lte: parseDate(wTo) },
            status: { in: ACTIVE_STATUSES },
          },
          select: {
            date: true,
            lessonNumber: true,
            classroomId: true,
            teacherId: true,
            streamKey: true,
            id: true,
          },
        }),
        this.prisma.schedulePeriod.findMany({
          where: { organizationId: org, status: { not: SchedulePeriodStatus.ARCHIVED } },
          include: { semester: { select: { number: true, program: { select: { title: true } } } } },
          orderBy: { startDate: 'desc' },
          take: 6,
        }),
      ]);

    // Занятия по дням текущей недели
    const byWeekday = settings.workingDays.map((wd) => ({
      weekday: wd,
      label: weekdayName(wd, true),
      date: addDaysStr(wFrom, wd - 1),
      lessons: weekLessons.filter((l) => isoWeekday(l.date) === wd).length,
    }));
    // Занятость аудиторий на текущей неделе
    const days = eachDay(wFrom, wTo).filter((d) => settings.workingDays.includes(isoWeekday(d)));
    const slots = days.length * settings.lessonsPerDay;
    const occupancy = classrooms
      .filter((c) => c.classroomType !== 'ONLINE')
      .map((c) => {
        const used = new Set(
          weekLessons
            .filter((l) => l.classroomId === c.id)
            .map((l) => `${toDateStr(l.date)}#${l.lessonNumber}`),
        ).size;
        return {
          classroomId: c.id,
          code: c.code,
          used,
          slots,
          percent: slots ? Math.round((used / slots) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => b.percent - a.percent);
    const totalUsed = occupancy.reduce((a, o) => a + o.used, 0);

    // Предупреждения по нагрузке (текущая неделя)
    const teacherList = await this.prisma.teacher.findMany({
      where: { organizationId: org, isActive: true },
      select: { id: true, fullName: true, maxWeeklyLessons: true, maxDailyLessons: true },
    });
    const workloadWarnings = [];
    for (const t of teacherList) {
      const own = weekLessons.filter((l) => l.teacherId === t.id);
      const units = new Set(
        own.map((l) => (l.streamKey ? `${l.streamKey}#${toDateStr(l.date)}#${l.lessonNumber}` : l.id)),
      );
      const perDay = new Map<string, number>();
      for (const l of own) perDay.set(toDateStr(l.date), (perDay.get(toDateStr(l.date)) ?? 0) + 1);
      const maxDay = Math.max(0, ...perDay.values());
      if (units.size > t.maxWeeklyLessons || maxDay > t.maxDailyLessons) {
        workloadWarnings.push({
          teacherId: t.id,
          fullName: t.fullName,
          weekLessons: units.size,
          maxWeeklyLessons: t.maxWeeklyLessons,
          maxDayLessons: maxDay,
          maxDailyLessons: t.maxDailyLessons,
        });
      }
    }

    // Выполнение учебного плана в текущих семестрах
    const progress = await this.hours.currentSemestersProgress(org);
    const deficitRows = (progress?.rows ?? []).filter((r) => r.status === 'DEFICIT' || r.status === 'RISK');
    const validation = await this.prisma.validationResult.groupBy({
      by: ['severity'],
      where: { schedulePeriodId: { in: periods.map((p) => p.id) }, isResolved: false },
      _count: { _all: true },
    });

    return {
      role: actor.role,
      today,
      counters: {
        activeGroups: groups,
        teachers,
        classrooms: classrooms.length,
        lessonsToday: todayLessons,
        cancelledLessons: cancelled30,
        hoursToMakeUp: makeup.reduce((a, m) => a + m.academicHours, 0),
        openMakeupTasks: makeup.length,
        deficitDisciplines: deficitRows.filter((r) => r.status === 'DEFICIT').length,
        riskDisciplines: deficitRows.filter((r) => r.status === 'RISK').length,
        workloadWarnings: workloadWarnings.length,
        validationErrors: validation.find((v) => v.severity === 'ERROR')?._count._all ?? 0,
        validationWarnings: validation.find((v) => v.severity === 'WARNING')?._count._all ?? 0,
      },
      planCompletion: progress
        ? {
            percent: progress.summary.completionPercent,
            forecastPercent: progress.summary.forecastPercent,
            planned: progress.summary.total.planned,
            conducted: progress.summary.total.conducted,
            scheduled: progress.summary.total.scheduled,
            byStatus: progress.summary.byStatus,
          }
        : null,
      deficits: deficitRows
        .sort((a, b) => b.total.forecastDeficit - a.total.forecastDeficit)
        .slice(0, 10)
        .map((r) => ({
          groupCode: r.groupCode,
          subgroupNumber: r.subgroupNumber,
          discipline: `${r.itemCode} ${r.itemName}`,
          status: r.status,
          planned: r.total.planned,
          scheduled: r.total.scheduled,
          conducted: r.total.conducted,
          deficit: Math.max(r.total.scheduleDeficit, r.total.forecastDeficit),
        })),
      workloadWarnings,
      lessonsByWeekday: byWeekday,
      classroomOccupancy: {
        week: { from: wFrom, to: wTo },
        percent:
          slots && occupancy.length ? Math.round((totalUsed / (slots * occupancy.length)) * 1000) / 10 : 0,
        rooms: occupancy,
      },
      periods: periods.map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        startDate: toDateStr(p.startDate),
        endDate: toDateStr(p.endDate),
        semester: p.semester.number,
        program: p.semester.program.title,
      })),
    };
  }

  private async teacher(actor: AuthUser) {
    const settings = await this.settings.getEffective(actor.organizationId);
    const today = todayInTimezone(settings.timezone);
    const teacherId = actor.teacherId;
    if (!teacherId) return { role: actor.role, today, todayLessons: [], unmarked: [], weekLessons: 0 };
    const todayLessons = await this.lessons.list({ teacherId, from: today, to: today }, actor);
    const unmarked = await this.prisma.scheduleLesson.findMany({
      where: {
        teacherId,
        date: { lt: parseDate(today), gte: parseDate(addDaysStr(today, -30)) },
        status: { in: [LessonStatus.PLANNED, LessonStatus.REPLACED] },
        conducted: null,
        schedulePeriod: { status: SchedulePeriodStatus.PUBLISHED },
      },
      include: {
        studentGroup: { select: { id: true, code: true, studentCount: true } },
        semesterItem: {
          select: {
            id: true,
            semesterId: true,
            curriculumItem: {
              select: { id: true, code: true, name: true, itemType: true, isDifficult: true },
            },
          },
        },
        teacher: { select: { id: true, fullName: true } },
        classroom: {
          select: { id: true, code: true, name: true, building: true, classroomType: true, capacity: true },
        },
        conducted: { include: { actualTeacher: { select: { id: true, fullName: true } } } },
        schedulePeriod: { select: { id: true, title: true, status: true } },
        originalLesson: { select: { id: true, date: true, lessonNumber: true, status: true } },
        derivedLessons: { select: { id: true, date: true, lessonNumber: true, status: true } },
        substitutions: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          include: {
            originalTeacher: { select: { id: true, fullName: true } },
            substituteTeacher: { select: { id: true, fullName: true } },
          },
        },
      },
      orderBy: [{ date: 'asc' }, { lessonNumber: 'asc' }],
    });
    const wFrom = weekStart(today);
    const week = await this.lessons.list(
      { teacherId, from: wFrom, to: addDaysStr(wFrom, 6), activeOnly: 'true' },
      actor,
    );
    const workload = await this.hours.teacherWorkload(actor.organizationId, teacherId);
    const makeup = await this.prisma.makeupTask.count({
      where: { teacherId, status: MakeupTaskStatus.OPEN },
    });
    return {
      role: actor.role,
      today,
      todayLessons,
      unmarked: unmarked.map(presentLesson),
      weekLessons: week.length,
      openMakeupTasks: makeup,
      workload: {
        planned: workload.planned.total,
        scheduled: workload.scheduled.total,
        conducted: workload.conducted.total,
        currentWeek: workload.currentWeek,
      },
    };
  }

  private async student(actor: AuthUser) {
    const settings = await this.settings.getEffective(actor.organizationId);
    const today = todayInTimezone(settings.timezone);
    const groupId = actor.studentGroupId;
    if (!groupId) return { role: actor.role, today, todayLessons: [], tomorrowLessons: [], changes: [] };
    const [todayLessons, tomorrowLessons, changes, group] = await Promise.all([
      this.lessons.list({ groupId, from: today, to: today }, actor),
      this.lessons.list({ groupId, from: addDaysStr(today, 1), to: addDaysStr(today, 1) }, actor),
      this.lessons.changes(actor, { groupId, from: today, to: addDaysStr(today, 14) }),
      this.prisma.studentGroup.findUnique({
        where: { id: groupId },
        select: { id: true, code: true, title: true },
      }),
    ]);
    const conducted = await this.prisma.conductedLesson.count({
      where: { scheduleLesson: { studentGroupId: groupId }, status: ConductedStatus.CONDUCTED },
    });
    return {
      role: actor.role,
      today,
      group,
      todayLessons,
      tomorrowLessons,
      changes: changes.slice(0, 20),
      conductedLessons: conducted,
    };
  }
}
