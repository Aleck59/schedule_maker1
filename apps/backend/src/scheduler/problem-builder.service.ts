import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ClassroomType, LessonStatus, LessonType, SchedulePeriod, Semester } from '@prisma/client';
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
import { groupLessonNumbers } from '../common/utils/groups';
import { LESSON_TYPE_SHORT } from '../common/utils/labels';
import { TeacherRules } from '../planning/availability-rules';
import { streamKeyOf } from '../planning/planning.service';
import { PlanningService } from '../planning/planning.service';
import { DemandStream } from '../planning/planning.types';
import { employmentText, isEmployedOn, levelRestriction } from '../common/utils/teacher-levels';
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
  /** Периоды совместной генерации (для одного периода — он сам) */
  periods: Array<{ id: string; title: string; groupCodes: string[] }>;
  range: { from: string; to: string };
  groupIds: string[];
  demandMeta: Record<string, DemandMeta>;
  preUnplaced: UnplacedItem[];
  replaceLessonIds: string[];
  warnings: string[];
  /** Преподаватели с отсутствием в интервале, у которого не включена отработка после выхода */
  absentWithoutMakeup: string[];
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

  /**
   * Задача для постоянного расписания (типовая неделя для руководства): весь объём нагрузки
   * семестров без учёта уже составленного рабочего расписания, недоступности, пожеланий и лимитов
   * преподавателей. «Периодами» служат сами семестры.
   */
  buildPermanent(
    organizationId: string,
    semesters: Semester[],
    params: Omit<GenerationParams, 'mode'>,
  ): Promise<BuiltProblem> {
    if (semesters.length === 0) throw new BadRequestException('Нет семестров для постоянного расписания');
    return this.build(semesters[0].id, organizationId, { ...params, mode: 'WEEKLY_TEMPLATE' }, semesters);
  }

  async build(
    periodId: string,
    organizationId: string,
    params: GenerationParams,
    permanentSemesters?: Semester[],
  ): Promise<BuiltProblem> {
    const permanent = !!permanentSemesters;
    const ids = permanentSemesters
      ? permanentSemesters.map((s) => s.id)
      : [...new Set([periodId, ...(params.periodIds ?? [])])];
    const periodsDb: Array<SchedulePeriod & { semester: Semester }> = permanentSemesters
      ? permanentSemesters.map((s) => ({
          id: s.id,
          organizationId,
          academicYearId: s.academicYearId,
          semesterId: s.id,
          title: `${s.number} семестр`,
          startDate: s.startDate,
          endDate: s.endDate,
          status: 'DRAFT',
          publishedAt: null,
          notes: null,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          semester: s,
        }))
      : await this.prisma.schedulePeriod.findMany({
          where: { id: { in: ids }, organizationId },
          include: { semester: true },
        });
    const period = periodsDb.find((p) => p.id === periodId);
    if (!period || periodsDb.length !== ids.length)
      throw new NotFoundException('Период расписания не найден');
    const joint = periodsDb.length > 1;
    const settings = await this.settingsService.getEffective(organizationId);
    const h = settings.academicHoursPerLesson;
    const warnings: string[] = [];

    // Интервал генерации каждого периода: пересечение дат периода, семестра и параметров
    const windows = new Map<string, { from: string; to: string }>();
    for (const p of periodsDb) {
      const pFrom = maxDate(
        maxDate(params.dateFrom ?? toDateStr(p.startDate), toDateStr(p.startDate)),
        toDateStr(p.semester.startDate),
      );
      const pTo = minDate(
        minDate(params.dateTo ?? toDateStr(p.endDate), toDateStr(p.endDate)),
        toDateStr(p.semester.endDate),
      );
      if (pFrom <= pTo) windows.set(p.id, { from: pFrom, to: pTo });
      else if (joint)
        warnings.push(`Период «${p.title}»: интервал генерации не пересекается с датами семестра`);
    }
    if (windows.size === 0) {
      throw new BadRequestException('Интервал генерации не пересекается с датами периода и семестра');
    }
    const activePeriods = periodsDb.filter((p) => windows.has(p.id));
    const periodByProgram = new Map<string, (typeof periodsDb)[number]>();
    for (const p of activePeriods) {
      if (periodByProgram.has(p.semester.educationalProgramId)) {
        throw new BadRequestException(
          `В совместной генерации у учебного плана может быть только один семестр («${p.title}»)`,
        );
      }
      periodByProgram.set(p.semester.educationalProgramId, p);
    }
    const from = [...windows.values()].map((w) => w.from).sort()[0];
    const to = [...windows.values()]
      .map((w) => w.to)
      .sort()
      .at(-1)!;
    const semesterStart = activePeriods.map((p) => toDateStr(p.semester.startDate)).sort()[0];
    const semesterEnd = activePeriods
      .map((p) => toDateStr(p.semester.endDate))
      .sort()
      .at(-1)!;
    const semesterIds = activePeriods.map((p) => p.semesterId);

    let groupIds = params.groupIds?.filter(Boolean) ?? [];
    if (groupIds.length === 0) {
      const groups = await this.prisma.studentGroup.findMany({
        where: { educationalProgramId: { in: [...periodByProgram.keys()] }, isActive: true },
        select: { id: true },
      });
      groupIds = groups.map((g) => g.id);
    }
    const groupsDb = await this.prisma.studentGroup.findMany({
      where: { id: { in: groupIds } },
      include: { subgroups: true, program: { select: { specialty: { select: { educationLevel: true } } } } },
      orderBy: { code: 'asc' },
    });
    // Группа относится к периоду своего учебного плана
    const periodOfGroup = new Map<string, (typeof periodsDb)[number]>();
    for (const g of groupsDb) {
      const p = periodByProgram.get(g.educationalProgramId);
      if (p) periodOfGroup.set(g.id, p);
      else warnings.push(`Группа ${g.code}: нет периода расписания для её учебного плана — группа пропущена`);
    }
    groupIds = groupsDb.filter((g) => periodOfGroup.has(g.id)).map((g) => g.id);
    if (groupIds.length === 0) {
      throw new BadRequestException('Нет активных групп для генерации расписания');
    }
    const groupWindow = (gId: string) => windows.get(periodOfGroup.get(gId)!.id)!;

    const streams = await this.planning.getStreams({ organizationId, semesterIds, groupIds });
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
    // Постоянное расписание не зависит от рабочего: занятия по датам не учитываются
    const existingInRange = permanent
      ? []
      : await this.prisma.scheduleLesson.findMany({
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
            windows.has(l.schedulePeriodId) &&
            groupIds.includes(l.studentGroupId) &&
            l.status === LessonStatus.PLANNED &&
            !l.isManual &&
            !l.isLocked &&
            !l.conducted,
        )
        .map((l) => l.id),
    );
    const semesterLessons = permanent
      ? []
      : await this.prisma.scheduleLesson.findMany({
          where: {
            studentGroupId: { in: groupIds },
            semesterItem: { semesterId: { in: semesterIds } },
            status: { in: ACTIVE_LESSON_STATUSES },
          },
          select: {
            id: true,
            studentGroupId: true,
            semesterCurriculumItemId: true,
            lessonType: true,
            subgroupNumber: true,
            academicHours: true,
            date: true,
          },
        });
    const existingHours = new Map<string, number>();
    // Потоки, у которых уже есть пары после интервала: будущие недели заполнены, интервал добирает остаток целиком
    const plannedAfterWindow = new Set<string>();
    for (const l of semesterLessons) {
      if (replaceable.has(l.id)) continue;
      const key = streamKeyOf(l.studentGroupId, l.semesterCurriculumItemId, l.lessonType, l.subgroupNumber);
      existingHours.set(key, (existingHours.get(key) ?? 0) + l.academicHours);
      if (toDateStr(l.date) > to) plannedAfterWindow.add(key);
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
            if (toDateStr(l.date) > to) plannedAfterWindow.add(s.key);
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
      include: { availability: true, availabilityRules: true },
    });
    const teacherById = new Map(teachersDb.map((t) => [t.id, t]));

    // --- Потоки → спрос
    const preUnplaced: UnplacedItem[] = [];
    const demandMeta: Record<string, DemandMeta> = {};
    const demands: SolverDemand[] = [];
    const groupById = new Map(groupsDb.map((g) => [g.id, g]));
    const groupAllowed = new Map<string, string[]>();
    const inWindow = (gId: string, date: string) => {
      const w = groupWindow(gId);
      return date >= w.from && date <= w.to;
    };
    for (const gId of groupIds) {
      const studyDays = groupById.get(gId)?.studyDays ?? [];
      groupAllowed.set(
        gId,
        days
          .filter(
            (d) =>
              inWindow(gId, d.date) &&
              (studyDays.length === 0 || studyDays.includes(d.weekday)) &&
              ctx.isRegularAllowed(gId, d.date),
          )
          .map((d) => d.date),
      );
    }
    // Даты консультаций: последние N недель теоретического обучения группы в семестре
    const consultationDates = new Map<string, string[]>();
    const consultationBorder = new Map<string, string>();
    for (const gId of groupIds) {
      const semester = periodOfGroup.get(gId)!.semester;
      const allSemesterDays = eachDay(toDateStr(semester.startDate), toDateStr(semester.endDate)).filter(
        (d) => ctx.isRegularAllowed(gId, d),
      );
      const last = allSemesterDays[allSemesterDays.length - 1];
      if (!last) {
        consultationDates.set(gId, []);
        continue;
      }
      const border = addDaysStr(weekStart(last), -7 * (settings.consultationWeeksBeforeEnd - 1));
      consultationBorder.set(gId, border);
      consultationDates.set(
        gId,
        allSemesterDays.filter((d) => d >= border && dayDates.has(d) && inWindow(gId, d)),
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
      let remainingHours = s.plannedHours - (existingHours.get(s.key) ?? 0);
      if (remainingHours <= 0) continue;
      let lessonsRequired = Math.ceil(remainingHours / h);
      let partialHours = remainingHours % h;
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
      const wrongLevel = levelRestriction(
        teacher,
        groupById.get(s.groupId)!.program.specialty.educationLevel,
      );
      if (wrongLevel) {
        pushUnplaced(s, lessonsRequired, remainingHours, 'TEACHER_LEVEL', wrongLevel);
        continue;
      }
      if (!permanent && !days.some((d) => inWindow(s.groupId, d.date) && isEmployedOn(teacher, d.date))) {
        pushUnplaced(
          s,
          lessonsRequired,
          remainingHours,
          'TEACHER_NOT_EMPLOYED',
          `${teacher.fullName} не работает в эти даты (${employmentText(teacher)})`,
        );
        continue;
      }
      let allowedDates: string[] | null = null;
      if (s.lessonType === LessonType.PRACTICE) {
        allowedDates = days
          .filter((d) => inWindow(s.groupId, d.date) && ctx.isPracticeAllowed(s.groupId, d.date, s.itemType))
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
      // Составление на часть семестра (неделя, месяц): в интервал ставится доля оставшихся пар,
      // пропорциональная учебным дням интервала, — остальное распределяется по следующим неделям,
      // а не втискивается в эти дни
      const fraction =
        permanent || plannedAfterWindow.has(s.key)
          ? null
          : this.windowShare(s, teacher, groupWindow(s.groupId), periodOfGroup.get(s.groupId)!.semester, {
              ctx,
              settings,
              studyDays: groupById.get(s.groupId)?.studyDays ?? [],
              consultationFrom: consultationBorder.get(s.groupId) ?? null,
            });
      // Округление вверх с допуском: 1,2 пары → 1, 1,3 → 2; хвост меньше четверти пары ждёт следующего интервала
      const share = fraction === null ? null : Math.ceil(lessonsRequired * fraction - 0.25);
      if (share !== null && share < lessonsRequired) {
        if (share <= 0) continue;
        lessonsRequired = share;
        partialHours = 0;
        remainingHours = share * h;
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
        periodId: periodOfGroup.get(s.groupId)?.id,
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

    // Отработка после отсутствия: со дня выхода лимиты пар преподавателя увеличены до конца семестра
    const makeupEvents = await this.prisma.calendarEvent.findMany({
      where: {
        organizationId,
        teacherId: { in: teacherIds },
        makeupAfterReturn: true,
        endDate: { gte: new Date(`${semesterStart}T00:00:00.000Z`), lt: new Date(`${to}T00:00:00.000Z`) },
      },
      orderBy: { endDate: 'asc' },
    });
    const absences = await this.prisma.calendarEvent.findMany({
      where: {
        organizationId,
        teacherId: { in: teacherIds },
        blocksSchedule: true,
        makeupAfterReturn: false,
        startDate: { lte: new Date(`${to}T00:00:00.000Z`) },
        endDate: { gte: new Date(`${from}T00:00:00.000Z`) },
      },
      select: { teacherId: true },
    });
    const relief = new Map<string, { from: string; weekly: number }>();
    for (const e of makeupEvents) {
      const prev = relief.get(e.teacherId!);
      relief.set(e.teacherId!, {
        from: prev?.from ?? addDaysStr(toDateStr(e.endDate), 1),
        weekly: Math.max(prev?.weekly ?? 0, e.makeupExtraWeekly),
      });
    }
    const teachers: SolverTeacher[] = teachersDb
      .filter((t) => demands.some((d) => d.teacherId === t.id))
      .map((t) =>
        permanent
          ? // Постоянное расписание: преподаватель лишь не может вести две пары одновременно
            {
              id: t.id,
              name: t.fullName,
              maxDailyLessons: lessonsPerDay,
              maxWeeklyLessons: lessonsPerDay * 7,
              preferredStartLesson: 1,
              preferredEndLesson: lessonsPerDay,
              unavailable: [],
              preferences: [],
              blockedDates: [],
            }
          : {
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
              blockedDates: days
                .filter((d) => !isEmployedOn(t, d.date) || ctx.teacherBlocks(t.id, d.date).length > 0)
                .map((d) => d.date),
              ...this.ruleSlots(
                new TeacherRules(t.availabilityRules, settings.lessonTimes),
                days,
                lessonsPerDay,
              ),
              ...(relief.has(t.id)
                ? {
                    relaxedFrom: relief.get(t.id)!.from,
                    extraDailyLessons: 1,
                    extraWeeklyLessons: relief.get(t.id)!.weekly,
                  }
                : {}),
            },
      );
    for (const t of teachers) {
      if (t.relaxedFrom) {
        warnings.push(
          `${t.name}: отработка после отсутствия — с ${t.relaxedFrom.split('-').reverse().join('.')} допускается до ` +
            `${t.maxDailyLessons + 1} пар в день и ${t.maxWeeklyLessons + (t.extraWeeklyLessons ?? 0)} в неделю`,
        );
      }
    }
    const onlineRoomId = rooms.find((r) => r.type === ClassroomType.ONLINE)?.id ?? null;
    for (const t of teachers) {
      if (t.onlineSlots?.length && !onlineRoomId) {
        warnings.push(
          `${t.name}: по правилам доступности часть занятий проводится онлайн, но в справочнике нет онлайн-аудитории — ` +
            'такие занятия будут поставлены в обычные аудитории',
        );
      }
    }

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
        allowedLessons: groupLessonNumbers(g, lessonsPerDay),
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
        maximizePlacement: params.maximizePlacement === true,
      },
      weights: { ...settings.weights, ...(params.weights ?? {}) },
      seed: params.seed ?? 42,
      onlineRoomId,
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
      periods: activePeriods.map((p) => ({
        id: p.id,
        title: p.title,
        groupCodes: groupsDb.filter((g) => periodOfGroup.get(g.id)?.id === p.id).map((g) => g.code),
      })),
      range: { from, to },
      groupIds,
      demandMeta,
      preUnplaced,
      replaceLessonIds: [...replaceable],
      warnings,
      absentWithoutMakeup: [...new Set(absences.map((a) => a.teacherId!))].filter((id) => !relief.has(id)),
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

  /** Слоты по гибким правилам доступности: запреты, предпочтения и онлайн на конкретные даты */
  private ruleSlots(rules: TeacherRules, days: SolverDay[], lessonsPerDay: number) {
    const blockedSlots: Array<[string, number]> = [];
    const slotPreferences: Array<[string, number, number]> = [];
    const onlineSlots: Array<[string, number]> = [];
    if (!rules.isEmpty) {
      for (const d of days) {
        for (let lesson = 1; lesson <= lessonsPerDay; lesson++) {
          const v = rules.evaluate(d.date, lesson);
          if (v.blocked) {
            blockedSlots.push([d.date, lesson]);
            continue;
          }
          if (v.weight) slotPreferences.push([d.date, lesson, v.weight]);
          if (v.online) onlineSlots.push([d.date, lesson]);
        }
      }
    }
    return { blockedSlots, slotPreferences, onlineSlots };
  }

  /**
   * Доля учебных дней интервала среди учебных дней до конца семестра (с учётом календаря группы,
   * отсутствий преподавателя и периода его работы). null — интервал доходит до конца семестра.
   */
  private windowShare(
    s: DemandStream,
    teacher: { id: string; employedFrom: Date | null; employedTo: Date | null },
    window: { from: string; to: string },
    semester: { endDate: Date },
    opts: {
      ctx: Awaited<ReturnType<PlanningService['buildCalendarContext']>>;
      settings: EffectiveSettings;
      studyDays: number[];
      consultationFrom: string | null;
    },
  ): number | null {
    const semesterEnd = toDateStr(semester.endDate);
    if (window.to >= semesterEnd) return null;
    const { ctx, settings, studyDays } = opts;
    const eligible = (date: string) => {
      const weekday = isoWeekday(date);
      if (!settings.workingDays.includes(weekday)) return false;
      if (!isEmployedOn(teacher, date) || ctx.teacherBlocks(teacher.id, date).length > 0) return false;
      if (s.lessonType === LessonType.PRACTICE) return ctx.isPracticeAllowed(s.groupId, date, s.itemType);
      if (studyDays.length > 0 && !studyDays.includes(weekday)) return false;
      if (s.lessonType === LessonType.CONSULTATION && opts.consultationFrom && date < opts.consultationFrom)
        return false;
      return ctx.isRegularAllowed(s.groupId, date);
    };
    let inside = 0;
    let future = 0;
    for (const date of eachDay(window.from, semesterEnd)) {
      if (!eligible(date)) continue;
      future++;
      if (date <= window.to) inside++;
    }
    if (future === 0 || inside === future) return null;
    return inside / future;
  }
}
