import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ClassroomType, LessonStatus, LessonType } from '@prisma/client';
import {
  addDaysStr,
  diffDays,
  eachDay,
  isoWeekday,
  maxDate,
  minDate,
  toDateStr,
  weekStart,
} from '../common/utils/dates';
import { LESSON_TYPE_SHORT } from '../common/utils/labels';
import { streamKeyOf } from '../planning/planning.service';
import { PlanningService } from '../planning/planning.service';
import { DemandStream } from '../planning/planning.types';
import { PrismaService } from '../prisma/prisma.service';
import { EffectiveSettings, SettingsService } from '../settings/settings.service';
import { DemandMeta, GenerationParams } from './generation.types';
import { SUGGESTIONS } from './diagnostics';
import {
  SolverDay,
  SolverDemand,
  SolverOccupied,
  SolverProblem,
  SolverRoom,
  SolverTeacher,
  UnplacedItem,
  UnplacedReason,
} from './solver.types';

export const ACTIVE_LESSON_STATUSES: LessonStatus[] = [
  LessonStatus.PLANNED,
  LessonStatus.CONDUCTED,
  LessonStatus.REPLACED,
];

export interface BuiltProblem {
  problem: SolverProblem;
  settings: EffectiveSettings;
  period: { id: string; title: string; organizationId: string; semesterId: string };
  range: { from: string; to: string };
  groupIds: string[];
  demandMeta: Record<string, DemandMeta>;
  preUnplaced: UnplacedItem[];
  replaceLessonIds: string[];
  warnings: string[];
}

interface RoomLite {
  id: string;
  code: string;
  building: string | null;
  capacity: number;
  classroomType: ClassroomType;
}

/** Формирование задачи для генератора из данных БД */
@Injectable()
export class ProblemBuilderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planning: PlanningService,
    private readonly settingsService: SettingsService,
  ) {}

  async build(periodId: string, organizationId: string, params: GenerationParams): Promise<BuiltProblem> {
    const period = await this.prisma.schedulePeriod.findFirst({
      where: { id: periodId, organizationId },
      include: { semester: true },
    });
    if (!period) throw new NotFoundException('Период расписания не найден');
    const settings = await this.settingsService.getEffective(organizationId);
    const h = settings.academicHoursPerLesson;
    const warnings: string[] = [];

    const semesterStart = toDateStr(period.semester.startDate);
    const semesterEnd = toDateStr(period.semester.endDate);
    const from = maxDate(
      maxDate(params.dateFrom ?? toDateStr(period.startDate), toDateStr(period.startDate)),
      semesterStart,
    );
    const to = minDate(
      minDate(params.dateTo ?? toDateStr(period.endDate), toDateStr(period.endDate)),
      semesterEnd,
    );
    if (from > to) {
      throw new BadRequestException('Интервал генерации не пересекается с датами периода и семестра');
    }

    let groupIds = params.groupIds?.filter(Boolean) ?? [];
    if (groupIds.length === 0) {
      const groups = await this.prisma.studentGroup.findMany({
        where: { educationalProgramId: period.semester.educationalProgramId, isActive: true },
        select: { id: true },
      });
      groupIds = groups.map((g) => g.id);
    }
    if (groupIds.length === 0) {
      throw new BadRequestException('Нет активных групп для генерации расписания');
    }

    const streams = await this.planning.getStreams({
      organizationId,
      semesterIds: [period.semesterId],
      groupIds,
    });
    const ctx = await this.planning.buildCalendarContext(
      organizationId,
      semesterStart,
      maxDate(to, semesterEnd),
      groupIds,
    );
    const lessonsPerDay = params.lessonsPerDay ?? settings.lessonsPerDay;

    // --- Дни горизонта
    const firstMonday = weekStart(from);
    const days: SolverDay[] = eachDay(from, to)
      .filter((d) => settings.workingDays.includes(isoWeekday(d)))
      .map((d) => ({ date: d, weekday: isoWeekday(d), week: Math.floor(diffDays(d, firstMonday) / 7) }));
    const dayDates = new Set(days.map((d) => d.date));

    // --- Существующие занятия
    const existingInRange = await this.prisma.scheduleLesson.findMany({
      where: {
        schedulePeriod: { organizationId },
        date: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
        status: { in: ACTIVE_LESSON_STATUSES },
      },
      include: { conducted: { select: { id: true } } },
    });
    const replaceExisting = params.replaceExisting !== false;
    const replaceable = new Set(
      existingInRange
        .filter(
          (l) =>
            replaceExisting &&
            l.schedulePeriodId === periodId &&
            groupIds.includes(l.studentGroupId) &&
            l.status === LessonStatus.PLANNED &&
            !l.isManual &&
            !l.isLocked &&
            !l.conducted,
        )
        .map((l) => l.id),
    );
    const semesterLessons = await this.prisma.scheduleLesson.findMany({
      where: {
        studentGroupId: { in: groupIds },
        semesterItem: { semesterId: period.semesterId },
        status: { in: ACTIVE_LESSON_STATUSES },
      },
      select: {
        id: true,
        studentGroupId: true,
        semesterCurriculumItemId: true,
        lessonType: true,
        subgroupNumber: true,
        academicHours: true,
      },
    });
    const existingHours = new Map<string, number>();
    for (const l of semesterLessons) {
      if (replaceable.has(l.id)) continue;
      const key = streamKeyOf(l.studentGroupId, l.semesterCurriculumItemId, l.lessonType, l.subgroupNumber);
      existingHours.set(key, (existingHours.get(key) ?? 0) + l.academicHours);
      if (l.subgroupNumber === null) {
        // Занятие всей группы засчитывается и подгруппам (если дисциплина делится)
        for (const s of streams) {
          if (
            s.groupId === l.studentGroupId &&
            s.semesterItemId === l.semesterCurriculumItemId &&
            s.lessonType === l.lessonType &&
            s.subgroupNumber !== null
          ) {
            existingHours.set(s.key, (existingHours.get(s.key) ?? 0) + l.academicHours);
          }
        }
      }
    }

    // --- Аудитории, преподаватели
    const roomsDb = await this.prisma.classroom.findMany({
      where: { organizationId, isActive: true },
      include: { availability: { where: { isAvailable: false } } },
      orderBy: { code: 'asc' },
    });
    const rooms: SolverRoom[] = roomsDb.map((r) => ({
      id: r.id,
      code: r.code,
      building: r.building,
      capacity: r.capacity,
      type: r.classroomType,
      unavailable: r.availability.map((a) => [a.weekday, a.lessonNumber] as [number, number]),
      unlimited: r.classroomType === ClassroomType.ONLINE,
    }));
    const teacherIds = Array.from(new Set(streams.map((s) => s.teacherId).filter((x): x is string => !!x)));
    const teachersDb = await this.prisma.teacher.findMany({
      where: { id: { in: teacherIds } },
      include: { availability: true },
    });
    const teacherById = new Map(teachersDb.map((t) => [t.id, t]));

    // --- Потоки → спрос
    const preUnplaced: UnplacedItem[] = [];
    const demandMeta: Record<string, DemandMeta> = {};
    const demands: SolverDemand[] = [];
    const groupAllowed = new Map<string, string[]>();
    for (const gId of groupIds) {
      groupAllowed.set(
        gId,
        days.filter((d) => ctx.isRegularAllowed(gId, d.date)).map((d) => d.date),
      );
    }
    // Даты консультаций: последние N недель теоретического обучения группы в семестре
    const consultationDates = new Map<string, string[]>();
    for (const gId of groupIds) {
      const allSemesterDays = eachDay(semesterStart, semesterEnd).filter((d) => ctx.isRegularAllowed(gId, d));
      const last = allSemesterDays[allSemesterDays.length - 1];
      if (!last) {
        consultationDates.set(gId, []);
        continue;
      }
      const border = addDaysStr(weekStart(last), -7 * (settings.consultationWeeksBeforeEnd - 1));
      consultationDates.set(
        gId,
        allSemesterDays.filter((d) => d >= border && dayDates.has(d)),
      );
    }

    const pushUnplaced = (
      s: DemandStream,
      lessons: number,
      hours: number,
      code: UnplacedReason,
      message: string,
    ) => {
      preUnplaced.push({
        demandId: s.key,
        streamKeys: [s.key],
        groupCodes: [s.groupCode],
        subgroupNumber: s.subgroupNumber,
        semesterItemId: s.semesterItemId,
        disciplineName: s.itemName,
        itemCode: s.itemCode,
        lessonType: s.lessonType,
        teacherId: s.teacherId,
        teacherName: s.teacherName,
        lessonsRequired: lessons,
        lessonsUnplaced: lessons,
        hoursUnplaced: hours,
        reasons: [{ code, message }],
        suggestions: [SUGGESTIONS[code]],
      });
    };

    // Доля недельного темпа для назначений, покрывающих несколько видов занятий
    const assignmentTotals = new Map<string, number>();
    for (const s of streams) {
      if (s.assignmentId)
        assignmentTotals.set(s.assignmentId, (assignmentTotals.get(s.assignmentId) ?? 0) + s.plannedLessons);
    }

    interface Pending {
      stream: DemandStream;
      lessonsRequired: number;
      partialHours: number;
      remainingHours: number;
      allowedDates: string[] | null;
      weeklyRate: number | null;
    }
    const pending: Pending[] = [];
    for (const s of streams) {
      const remainingHours = s.plannedHours - (existingHours.get(s.key) ?? 0);
      if (remainingHours <= 0) continue;
      const lessonsRequired = Math.ceil(remainingHours / h);
      const partialHours = remainingHours % h;
      if (!s.teacherId) {
        pushUnplaced(s, lessonsRequired, remainingHours, 'NO_TEACHER', 'Преподаватель не назначен');
        continue;
      }
      const teacher = teacherById.get(s.teacherId);
      if (!teacher || !teacher.isActive) {
        pushUnplaced(
          s,
          lessonsRequired,
          remainingHours,
          'TEACHER_INACTIVE',
          `Преподаватель ${s.teacherName ?? ''} неактивен`,
        );
        continue;
      }
      let allowedDates: string[] | null = null;
      if (s.lessonType === LessonType.PRACTICE) {
        allowedDates = days
          .filter((d) => ctx.isPracticeAllowed(s.groupId, d.date, s.itemType))
          .map((d) => d.date);
        if (allowedDates.length === 0) {
          pushUnplaced(
            s,
            lessonsRequired,
            remainingHours,
            'NO_PRACTICE_PERIOD',
            'В календарном графике группы нет периода практики в выбранном интервале',
          );
          continue;
        }
      } else if (s.lessonType === LessonType.CONSULTATION) {
        allowedDates = consultationDates.get(s.groupId) ?? [];
        if (allowedDates.length === 0) allowedDates = null;
      }
      const assignmentTotal = s.assignmentId
        ? (assignmentTotals.get(s.assignmentId) ?? s.plannedLessons)
        : s.plannedLessons;
      const weeklyRate =
        s.weeklyTarget && assignmentTotal > 0 ? (s.weeklyTarget * s.plannedLessons) / assignmentTotal : null;
      pending.push({ stream: s, lessonsRequired, partialHours, remainingHours, allowedDates, weeklyRate });
    }

    const roomIdsFor = (types: ClassroomType[], size: number, preferred: string | null): string[] => {
      const suitable = roomsDb.filter(
        (r) =>
          types.includes(r.classroomType) && (r.classroomType === ClassroomType.ONLINE || r.capacity >= size),
      );
      suitable.sort((a, b) => {
        if (a.id === preferred) return -1;
        if (b.id === preferred) return 1;
        const ta = types.indexOf(a.classroomType);
        const tb = types.indexOf(b.classroomType);
        return ta - tb || a.capacity - b.capacity || a.code.localeCompare(b.code);
      });
      return suitable.map((r) => r.id);
    };

    const toDemand = (id: string, group: Pending[], lessons: number): SolverDemand | null => {
      const s = group[0].stream;
      const size = group.reduce((a, p) => a + p.stream.size, 0);
      const roomIds = roomIdsFor(s.roomTypes, size, s.preferredClassroomId);
      const title = `${group.map((p) => p.stream.groupCode).join(', ')}${
        s.subgroupNumber ? ` (п/г ${s.subgroupNumber})` : ''
      } · ${s.itemCode} ${s.itemName} · ${LESSON_TYPE_SHORT[s.lessonType] ?? s.lessonType}`;
      if (roomIds.length === 0) {
        for (const p of group) {
          pushUnplaced(
            p.stream,
            lessons,
            Math.min(p.remainingHours, lessons * h),
            'NO_SUITABLE_ROOM',
            `Нет активных аудиторий типа «${s.roomTypes.join(', ')}» вместимостью от ${size} мест`,
          );
        }
        return null;
      }
      let allowedDates: string[] | null = null;
      for (const p of group) {
        if (p.allowedDates) {
          allowedDates = allowedDates
            ? allowedDates.filter((d) => p.allowedDates!.includes(d))
            : [...p.allowedDates];
        }
      }
      demandMeta[id] = {
        demandId: id,
        title,
        itemCode: s.itemCode,
        itemName: s.itemName,
        lessonType: s.lessonType,
        teacherId: s.teacherId,
        teacherName: s.teacherName,
        subgroupNumber: s.subgroupNumber,
        groupCodes: group.map((p) => p.stream.groupCode),
        lessonsRequired: lessons,
        streams: group.map((p) => ({
          streamKey: p.stream.key,
          groupId: p.stream.groupId,
          groupCode: p.stream.groupCode,
          subgroupNumber: p.stream.subgroupNumber,
          semesterItemId: p.stream.semesterItemId,
          assignmentId: p.stream.assignmentId,
          lessonType: p.stream.lessonType,
          teacherId: p.stream.teacherId,
          lessonsRequired: p.lessonsRequired,
          partialHours: p.partialHours,
          streamGroupKey: group.length > 1 ? p.stream.streamKey : null,
        })),
      };
      return {
        id,
        groupIds: group.map((p) => p.stream.groupId),
        subgroupNumber: s.subgroupNumber,
        semesterItemId: s.semesterItemId,
        // Практика проводится концентрированно — лимит пар дисциплины в день к ней не применяется
        disciplineKeys:
          s.lessonType === LessonType.PRACTICE
            ? []
            : group.map((p) => `${p.stream.groupId}|${p.stream.semesterItemId}`),
        title,
        lessonType: s.lessonType,
        teacherId: s.teacherId!,
        lessonsRequired: lessons,
        weeklyRate: group[0].weeklyRate,
        priority: s.priority,
        size,
        roomIds,
        preferredRoomId: s.preferredClassroomId,
        allowedDates,
        isDifficult: s.isDifficult,
      };
    };

    // Потоки (объединённые группы): одна лекция на несколько групп
    const byStream = new Map<string, Pending[]>();
    const singles: Pending[] = [];
    for (const p of pending) {
      if (p.stream.streamKey && p.stream.subgroupNumber === null) {
        const key = `${p.stream.streamKey}|${p.stream.lessonType}|${p.stream.teacherId}`;
        const list = byStream.get(key) ?? [];
        list.push(p);
        byStream.set(key, list);
      } else {
        singles.push(p);
      }
    }
    for (const [key, group] of byStream) {
      if (group.length < 2) {
        singles.push(...group);
        continue;
      }
      const common = Math.min(...group.map((p) => p.lessonsRequired));
      const merged = toDemand(`stream:${key}`, group, common);
      if (merged) demands.push(merged);
      for (const p of group) {
        const rest = p.lessonsRequired - common;
        if (rest > 0) {
          const d = toDemand(`${p.stream.key}#rest`, [p], rest);
          if (d) demands.push(d);
        }
      }
      warnings.push(
        `Поток «${group[0].stream.streamKey}»: ${group.map((p) => p.stream.groupCode).join(', ')} — ${common} совместных пар`,
      );
    }
    for (const p of singles) {
      const d = toDemand(p.stream.key, [p], p.lessonsRequired);
      if (d) demands.push(d);
    }

    const teachers: SolverTeacher[] = teachersDb
      .filter((t) => demands.some((d) => d.teacherId === t.id))
      .map((t) => ({
        id: t.id,
        name: t.fullName,
        maxDailyLessons: t.maxDailyLessons,
        maxWeeklyLessons: t.maxWeeklyLessons,
        preferredStartLesson: t.preferredStartLesson,
        preferredEndLesson: t.preferredEndLesson,
        unavailable: t.availability
          .filter((a) => !a.isAvailable)
          .map((a) => [a.weekday, a.lessonNumber] as [number, number]),
        preferences: t.availability
          .filter((a) => a.isAvailable && a.preferenceWeight !== 0)
          .map((a) => [a.weekday, a.lessonNumber, a.preferenceWeight] as [number, number, number]),
        blockedDates: days.filter((d) => ctx.teacherBlocks(t.id, d.date).length > 0).map((d) => d.date),
      }));

    const occupied: SolverOccupied[] = existingInRange
      .filter((l) => !replaceable.has(l.id) && dayDates.has(toDateStr(l.date)))
      .map((l) => ({
        date: toDateStr(l.date),
        lessonNumber: l.lessonNumber,
        groupId: l.studentGroupId,
        subgroupNumber: l.subgroupNumber,
        teacherId: l.teacherId,
        roomId: l.classroomId,
        disciplineKey: `${l.studentGroupId}|${l.semesterCurriculumItemId}`,
      }));

    const groupsDb = await this.prisma.studentGroup.findMany({
      where: { id: { in: groupIds } },
      include: { subgroups: true },
    });
    const maxGroupLessonsPerDay = params.maxGroupLessonsPerDay ?? settings.maxGroupLessonsPerDay;
    const problem: SolverProblem = {
      version: 1,
      mode: params.mode,
      timeLimitSeconds: params.timeLimitSeconds ?? settings.solverTimeLimitSeconds,
      lessonsPerDay,
      workingDays: settings.workingDays,
      days,
      groups: groupsDb.map((g) => ({
        id: g.id,
        code: g.code,
        size: g.studentCount,
        subgroups: g.subgroups.map((s) => s.number).sort((a, b) => a - b),
        allowedDates: groupAllowed.get(g.id) ?? [],
        maxLessonsPerDay: maxGroupLessonsPerDay,
      })),
      teachers,
      rooms,
      demands,
      occupied,
      settings: {
        maxSameDisciplinePerDay: params.maxSameDisciplinePerDay ?? settings.maxSameDisciplinePerDay,
        maxSameDisciplinePerWeek: params.maxSameDisciplinePerWeek ?? settings.maxSameDisciplinePerWeek,
        lateLessonNumber: settings.lateLessonNumber,
        forbidLateLessons: params.allowLateLessons === false,
        avoidWindows: params.avoidWindows !== false,
        respectTeacherPreferences: params.respectTeacherPreferences !== false,
      },
      weights: { ...settings.weights, ...(params.weights ?? {}) },
      seed: params.seed ?? 42,
    };

    for (const g of problem.groups) {
      if (g.allowedDates.length === 0) {
        warnings.push(`Группа ${g.code}: в интервале ${from} — ${to} нет доступных учебных дней`);
      }
    }
    return {
      problem,
      settings,
      period: { id: period.id, title: period.title, organizationId, semesterId: period.semesterId },
      range: { from, to },
      groupIds,
      demandMeta,
      preUnplaced,
      replaceLessonIds: [...replaceable],
      warnings,
    };
  }

  /** Сведения об аудиториях для предпросмотра */
  roomsLite(problem: SolverProblem): Map<string, RoomLite> {
    return new Map(
      problem.rooms.map((r) => [
        r.id,
        {
          id: r.id,
          code: r.code,
          building: r.building,
          capacity: r.capacity,
          classroomType: r.type as ClassroomType,
        },
      ]),
    );
  }
}
