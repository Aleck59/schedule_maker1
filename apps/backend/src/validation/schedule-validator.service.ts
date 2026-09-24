import { Injectable, NotFoundException } from '@nestjs/common';
import { CalendarEventType, ClassroomType, ControlForm, LessonType, Prisma, Severity } from '@prisma/client';
import { addDaysStr, eachDay, formatDateRu, parseDate, toDateStr, todayInTimezone, weekStart } from '../common/utils/dates';
import { CALENDAR_EVENT_LABELS, CLASSROOM_TYPE_LABELS, LESSON_TYPE_LABELS } from '../common/utils/labels';
import { effectiveRoomTypes } from '../common/utils/rooms';
import { PRACTICE_EVENT_TYPES, practiceEventTypeFor } from '../planning/calendar-context';
import { ACTIVE_STATUSES, computeStreamHours, LessonForHours, matchLessonsToStreams } from '../planning/hours-calculator';
import { PlanningService } from '../planning/planning.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { BLOCKING_TYPES, ValidationIssue, ValidationSummary } from './validation.types';

const lessonInclude = {
  studentGroup: { select: { id: true, code: true, studentCount: true, subgroupCount: true, subgroups: true } },
  teacher: { include: { availability: true } },
  classroom: { include: { availability: true } },
  semesterItem: { include: { curriculumItem: true, semester: true } },
  assignment: { select: { classroomTypes: true, allowHoursExcess: true } },
  conducted: true,
} satisfies Prisma.ScheduleLessonInclude;

type LessonFull = Prisma.ScheduleLessonGetPayload<{ include: typeof lessonInclude }>;

function gapsOf(set: Set<number>): number {
  if (set.size < 2) return 0;
  const arr = [...set];
  return Math.max(...arr) - Math.min(...arr) + 1 - arr.length;
}

/**
 * Полная проверка расписания периода. Ошибки (ERROR) блокируют публикацию,
 * предупреждения (WARNING) и информационные сообщения (INFO) — нет.
 */
@Injectable()
export class ScheduleValidatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planning: PlanningService,
    private readonly settings: SettingsService,
  ) {}

  async validatePeriod(periodId: string, organizationId: string, persist = true): Promise<ValidationSummary> {
    const period = await this.prisma.schedulePeriod.findFirst({
      where: { id: periodId, organizationId },
      include: { semester: true },
    });
    if (!period) throw new NotFoundException('Период расписания не найден');
    const settings = await this.settings.getEffective(organizationId);
    const today = todayInTimezone(settings.timezone);
    const from = toDateStr(period.startDate);
    const to = toDateStr(period.endDate);
    const issues: ValidationIssue[] = [];
    const add = (i: ValidationIssue) => issues.push(i);

    const lessons: LessonFull[] = await this.prisma.scheduleLesson.findMany({
      where: { schedulePeriodId: periodId, status: { in: ACTIVE_STATUSES } },
      include: lessonInclude,
      orderBy: [{ date: 'asc' }, { lessonNumber: 'asc' }],
    });
    // Занятия других периодов в те же даты — для межпериодных пересечений преподавателей и аудиторий
    const others = await this.prisma.scheduleLesson.findMany({
      where: {
        schedulePeriodId: { not: periodId },
        schedulePeriod: { organizationId },
        status: { in: ACTIVE_STATUSES },
        date: { gte: period.startDate, lte: period.endDate },
      },
      select: {
        id: true,
        date: true,
        lessonNumber: true,
        teacherId: true,
        classroomId: true,
        studentGroupId: true,
        subgroupNumber: true,
        streamKey: true,
        studentGroup: { select: { code: true } },
      },
    });
    const groupIds = Array.from(new Set(lessons.map((l) => l.studentGroupId)));
    const ctx = await this.planning.buildCalendarContext(organizationId, from, to, groupIds);
    const describe = (l: LessonFull) =>
      `${formatDateRu(l.date)}, ${l.lessonNumber} пара, ${l.studentGroup.code}${l.subgroupNumber ? ` (п/г ${l.subgroupNumber})` : ''}, ${l.semesterItem.curriculumItem.name}`;

    // ------------------------------------------------------------ по каждому занятию
    for (const l of lessons) {
      const date = toDateStr(l.date);
      const base = { entityType: 'ScheduleLesson', entityId: l.id };
      if (date < from || date > to) {
        add({ ...base, severity: Severity.ERROR, validationType: 'LESSON_OUTSIDE_PERIOD', message: `Занятие вне периода расписания: ${describe(l)}` });
      }
      if (date < toDateStr(l.semesterItem.semester.startDate) || date > toDateStr(l.semesterItem.semester.endDate)) {
        add({ ...base, severity: Severity.ERROR, validationType: 'LESSON_OUTSIDE_SEMESTER', message: `Занятие вне дат семестра: ${describe(l)}` });
      }
      const day = ctx.groupDay(l.studentGroupId, date);
      if (!day.isWorkingDay) {
        add({ ...base, severity: Severity.WARNING, validationType: 'LESSON_ON_DAY_OFF', message: `Занятие в выходной день: ${describe(l)}` });
      }
      const practiceType = practiceEventTypeFor(l.semesterItem.curriculumItem.itemType);
      for (const b of day.blocks) {
        const type = b.eventType as CalendarEventType;
        if (l.lessonType === LessonType.PRACTICE && practiceType === type) continue;
        const code =
          type === CalendarEventType.VACATION
            ? 'LESSON_IN_VACATION'
            : type === CalendarEventType.HOLIDAY
              ? 'LESSON_ON_HOLIDAY'
              : PRACTICE_EVENT_TYPES.includes(type)
                ? 'LESSON_IN_PRACTICE'
                : 'LESSON_IN_BLOCKED_PERIOD';
        add({
          ...base,
          severity: Severity.ERROR,
          validationType: code,
          message: `${CALENDAR_EVENT_LABELS[type] ?? type} «${b.title}»: ${describe(l)}`,
          details: { eventId: b.eventId },
        });
      }
      if (!l.teacherId) {
        add({ ...base, severity: Severity.ERROR, validationType: 'NO_TEACHER', message: `Занятие без преподавателя: ${describe(l)}` });
      } else if (l.teacher) {
        const slot = l.teacher.availability.find((a) => a.weekday === l.weekday && a.lessonNumber === l.lessonNumber);
        if ((slot && !slot.isAvailable) || !l.teacher.isActive) {
          add({
            ...base,
            severity: Severity.ERROR,
            validationType: 'TEACHER_UNAVAILABLE',
            message: `Преподаватель ${l.teacher.fullName} недоступен: ${describe(l)}`,
          });
        }
        for (const b of ctx.teacherBlocks(l.teacher.id, date)) {
          add({
            ...base,
            severity: Severity.ERROR,
            validationType: 'TEACHER_UNAVAILABLE',
            message: `Преподаватель ${l.teacher.fullName} недоступен (${b.title}): ${describe(l)}`,
          });
        }
      }
      if (!l.classroomId || !l.classroom) {
        add({ ...base, severity: Severity.ERROR, validationType: 'NO_CLASSROOM', message: `Занятие без аудитории: ${describe(l)}` });
      } else {
        const room = l.classroom;
        const slot = room.availability.find((a) => a.weekday === l.weekday && a.lessonNumber === l.lessonNumber);
        if ((slot && !slot.isAvailable) || !room.isActive) {
          add({ ...base, severity: Severity.ERROR, validationType: 'CLASSROOM_UNAVAILABLE', message: `Аудитория ${room.code} недоступна: ${describe(l)}` });
        }
        const allowed = effectiveRoomTypes(l.lessonType, l.semesterItem, l.assignment?.classroomTypes);
        if (!allowed.includes(room.classroomType)) {
          add({
            ...base,
            severity: Severity.ERROR,
            validationType: 'WRONG_CLASSROOM_TYPE',
            message: `${LESSON_TYPE_LABELS[l.lessonType]} в аудитории «${CLASSROOM_TYPE_LABELS[room.classroomType]}» ${room.code}, требуется ${allowed
              .map((t) => CLASSROOM_TYPE_LABELS[t])
              .join(' / ')}: ${describe(l)}`,
          });
        }
      }
      if (l.academicHours < settings.academicHoursPerLesson) {
        add({
          ...base,
          severity: settings.warnOnPartialLessons ? Severity.WARNING : Severity.INFO,
          validationType: 'PARTIAL_LESSON',
          message: `Неполная пара (${l.academicHours} ак. ч.): ${describe(l)}`,
        });
      }
    }

    // ------------------------------------------------------------ пересечения
    const slotKey = (date: Date, lesson: number) => `${toDateStr(date)}#${lesson}`;
    type Occ = { id: string; streamKey: string | null; label: string; own: boolean };
    const teacherSlots = new Map<string, Occ[]>();
    const roomSlots = new Map<string, Occ[]>();
    const groupSlots = new Map<string, Array<Occ & { subgroup: number | null }>>();
    const pushTo = <T>(map: Map<string, T[]>, key: string, value: T) => {
      const list = map.get(key) ?? [];
      list.push(value);
      map.set(key, list);
    };
    for (const l of lessons) {
      const occ = { id: l.id, streamKey: l.streamKey, label: describe(l), own: true };
      if (l.teacherId) pushTo(teacherSlots, `${l.teacherId}#${slotKey(l.date, l.lessonNumber)}`, occ);
      if (l.classroomId && l.classroom?.classroomType !== ClassroomType.ONLINE) {
        pushTo(roomSlots, `${l.classroomId}#${slotKey(l.date, l.lessonNumber)}`, occ);
      }
      pushTo(groupSlots, `${l.studentGroupId}#${slotKey(l.date, l.lessonNumber)}`, { ...occ, subgroup: l.subgroupNumber });
    }
    for (const o of others) {
      const occ = {
        id: o.id,
        streamKey: o.streamKey,
        label: `${formatDateRu(o.date)}, ${o.lessonNumber} пара, ${o.studentGroup.code} (другой период)`,
        own: false,
      };
      if (o.teacherId) pushTo(teacherSlots, `${o.teacherId}#${slotKey(o.date, o.lessonNumber)}`, occ);
      if (o.classroomId) pushTo(roomSlots, `${o.classroomId}#${slotKey(o.date, o.lessonNumber)}`, occ);
      pushTo(groupSlots, `${o.studentGroupId}#${slotKey(o.date, o.lessonNumber)}`, { ...occ, subgroup: o.subgroupNumber });
    }
    const units = (list: Occ[]) => new Set(list.map((o) => o.streamKey ?? o.id)).size;
    for (const [key, list] of teacherSlots) {
      if (units(list) > 1 && list.some((o) => o.own)) {
        const teacher = lessons.find((l) => l.id === list.find((o) => o.own)?.id)?.teacher;
        add({
          severity: Severity.ERROR,
          validationType: 'TEACHER_CONFLICT',
          entityType: 'Teacher',
          entityId: key.split('#')[0],
          message: `Преподаватель ${teacher?.fullName ?? ''} поставлен на несколько занятий одновременно: ${list.map((o) => o.label).join('; ')}`,
          details: { lessonIds: list.map((o) => o.id) },
        });
      }
    }
    for (const [key, list] of roomSlots) {
      if (units(list) > 1 && list.some((o) => o.own)) {
        const room = lessons.find((l) => l.id === list.find((o) => o.own)?.id)?.classroom;
        add({
          severity: Severity.ERROR,
          validationType: 'CLASSROOM_CONFLICT',
          entityType: 'Classroom',
          entityId: key.split('#')[0],
          message: `Аудитория ${room?.code ?? ''} используется дважды: ${list.map((o) => o.label).join('; ')}`,
          details: { lessonIds: list.map((o) => o.id) },
        });
      }
    }
    for (const [key, list] of groupSlots) {
      if (list.length < 2 || !list.some((o) => o.own)) continue;
      let conflict = false;
      for (let i = 0; i < list.length && !conflict; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          if (a.subgroup === null || b.subgroup === null || a.subgroup === b.subgroup) {
            conflict = true;
            break;
          }
        }
      }
      if (conflict) {
        add({
          severity: Severity.ERROR,
          validationType: 'GROUP_CONFLICT',
          entityType: 'StudentGroup',
          entityId: key.split('#')[0],
          message: `Группа поставлена на несколько занятий одновременно: ${list.map((o) => o.label).join('; ')}`,
          details: { lessonIds: list.map((o) => o.id) },
        });
      }
    }

    // Вместимость (для потоков — суммарная численность)
    const byRoomSlot = new Map<string, LessonFull[]>();
    for (const l of lessons) {
      if (!l.classroomId) continue;
      pushTo(byRoomSlot, `${l.classroomId}#${slotKey(l.date, l.lessonNumber)}#${l.streamKey ?? l.id}`, l);
    }
    for (const list of byRoomSlot.values()) {
      const room = list[0].classroom;
      if (!room || room.classroomType === ClassroomType.ONLINE) continue;
      const size = list.reduce((a, l) => {
        const g = l.studentGroup;
        if (!l.subgroupNumber) return a + g.studentCount;
        const sg = g.subgroups.find((s) => s.number === l.subgroupNumber);
        return a + (sg && sg.studentCount > 0 ? sg.studentCount : Math.ceil(g.studentCount / Math.max(1, g.subgroupCount)));
      }, 0);
      if (room.capacity < size) {
        add({
          severity: Severity.ERROR,
          validationType: 'CAPACITY_EXCEEDED',
          entityType: 'ScheduleLesson',
          entityId: list[0].id,
          message: `Вместимость аудитории ${room.code} (${room.capacity}) меньше численности (${size}): ${describe(list[0])}`,
        });
      }
    }

    // ------------------------------------------------------------ нагрузка по дням / неделям
    const groupDay = new Map<string, Set<number>>();
    const groupWeek = new Map<string, Map<string, Set<number>>>();
    const teacherDay = new Map<string, Set<string>>();
    const teacherWeek = new Map<string, Set<string>>();
    const teacherDayLessons = new Map<string, Set<number>>();
    const groupDayBuildings = new Map<string, Set<string>>();
    const lateByGroup = new Map<string, number>();
    for (const l of lessons) {
      const date = toDateStr(l.date);
      const perspectives = l.subgroupNumber
        ? [l.subgroupNumber]
        : l.studentGroup.subgroups.length
          ? l.studentGroup.subgroups.map((s) => s.number)
          : [0];
      for (const p of perspectives) {
        const key = `${l.studentGroupId}#${p}#${date}`;
        const set = groupDay.get(key) ?? new Set<number>();
        set.add(l.lessonNumber);
        groupDay.set(key, set);
        const wk = `${l.studentGroupId}#${weekStart(date)}`;
        const map = groupWeek.get(wk) ?? new Map<string, Set<number>>();
        map.set(key, set);
        groupWeek.set(wk, map);
      }
      if (l.teacherId) {
        const unit = l.streamKey ? `${l.streamKey}#${date}#${l.lessonNumber}` : l.id;
        const dk = `${l.teacherId}#${date}`;
        const set = teacherDay.get(dk) ?? new Set<string>();
        set.add(unit);
        teacherDay.set(dk, set);
        const wk = `${l.teacherId}#${weekStart(date)}`;
        const ws = teacherWeek.get(wk) ?? new Set<string>();
        ws.add(unit);
        teacherWeek.set(wk, ws);
        const tl = teacherDayLessons.get(dk) ?? new Set<number>();
        tl.add(l.lessonNumber);
        teacherDayLessons.set(dk, tl);
      }
      if (l.classroom?.building) {
        const bk = `${l.studentGroupId}#${date}`;
        const bs = groupDayBuildings.get(bk) ?? new Set<string>();
        bs.add(l.classroom.building);
        groupDayBuildings.set(bk, bs);
      }
      if (l.lessonNumber >= settings.lateLessonNumber) {
        lateByGroup.set(l.studentGroupId, (lateByGroup.get(l.studentGroupId) ?? 0) + 1);
      }
    }
    const groupCode = new Map(lessons.map((l) => [l.studentGroupId, l.studentGroup.code]));
    const teacherInfo = new Map(lessons.filter((l) => l.teacher).map((l) => [l.teacherId!, l.teacher!]));

    const reportedGroupDays = new Set<string>();
    for (const [key, set] of groupDay) {
      const [groupId, , date] = key.split('#');
      if (set.size > settings.maxGroupLessonsPerDay && !reportedGroupDays.has(`${groupId}#${date}`)) {
        reportedGroupDays.add(`${groupId}#${date}`);
        add({
          severity: Severity.WARNING,
          validationType: 'GROUP_DAILY_LIMIT',
          entityType: 'StudentGroup',
          entityId: groupId,
          message: `${groupCode.get(groupId)}: ${set.size} пар ${formatDateRu(date)} (рекомендуется не более ${settings.maxGroupLessonsPerDay})`,
        });
      }
    }
    for (const [wk, map] of groupWeek) {
      const [groupId, week] = wk.split('#');
      const perPerspective = new Map<string, number>();
      for (const [key, set] of map) {
        const persp = key.split('#')[1];
        perPerspective.set(persp, (perPerspective.get(persp) ?? 0) + gapsOf(set));
      }
      const worst = Math.max(0, ...perPerspective.values());
      if (worst > settings.maxGroupWindowsPerWeek) {
        add({
          severity: Severity.WARNING,
          validationType: 'GROUP_WINDOWS',
          entityType: 'StudentGroup',
          entityId: groupId,
          message: `${groupCode.get(groupId)}: ${worst} окон(а) на неделе с ${formatDateRu(week)} (допустимо ${settings.maxGroupWindowsPerWeek})`,
        });
      }
    }
    for (const [dk, set] of teacherDay) {
      const [teacherId, date] = dk.split('#');
      const t = teacherInfo.get(teacherId);
      if (t && set.size > t.maxDailyLessons) {
        add({
          severity: Severity.WARNING,
          validationType: 'TEACHER_OVERLOAD',
          entityType: 'Teacher',
          entityId: teacherId,
          message: `${t.fullName}: ${set.size} пар ${formatDateRu(date)} (лимит ${t.maxDailyLessons})`,
        });
      }
    }
    const teacherWeekWindows = new Map<string, number>();
    for (const [dk, set] of teacherDayLessons) {
      const [teacherId, date] = dk.split('#');
      const wk = `${teacherId}#${weekStart(date)}`;
      teacherWeekWindows.set(wk, (teacherWeekWindows.get(wk) ?? 0) + gapsOf(set));
    }
    for (const [wk, set] of teacherWeek) {
      const [teacherId, week] = wk.split('#');
      const t = teacherInfo.get(teacherId);
      if (t && set.size > t.maxWeeklyLessons) {
        add({
          severity: Severity.WARNING,
          validationType: 'TEACHER_OVERLOAD',
          entityType: 'Teacher',
          entityId: teacherId,
          message: `${t.fullName}: ${set.size} пар на неделе с ${formatDateRu(week)} (лимит ${t.maxWeeklyLessons})`,
        });
      }
      const windows = teacherWeekWindows.get(wk) ?? 0;
      if (t && windows > settings.maxTeacherWindowsPerWeek) {
        add({
          severity: Severity.WARNING,
          validationType: 'TEACHER_WINDOWS',
          entityType: 'Teacher',
          entityId: teacherId,
          message: `${t.fullName}: ${windows} окон на неделе с ${formatDateRu(week)} (допустимо ${settings.maxTeacherWindowsPerWeek})`,
        });
      }
    }
    for (const [bk, set] of groupDayBuildings) {
      const [groupId, date] = bk.split('#');
      if (set.size - 1 > settings.maxBuildingChangesPerDay) {
        add({
          severity: Severity.WARNING,
          validationType: 'BUILDING_CHANGES',
          entityType: 'StudentGroup',
          entityId: groupId,
          message: `${groupCode.get(groupId)}: ${set.size} корпуса за день ${formatDateRu(date)} (${[...set].join(', ')})`,
        });
      }
    }
    for (const [groupId, count] of lateByGroup) {
      add({
        severity: Severity.WARNING,
        validationType: 'LATE_LESSONS',
        entityType: 'StudentGroup',
        entityId: groupId,
        message: `${groupCode.get(groupId)}: ${count} поздних пар (с ${settings.lateLessonNumber}-й)`,
      });
    }

    // ------------------------------------------------------------ часы учебного плана
    const periodGroupIds = groupIds.length
      ? groupIds
      : (
          await this.prisma.studentGroup.findMany({
            where: { educationalProgramId: period.semester.educationalProgramId, isActive: true },
            select: { id: true },
          })
        ).map((g) => g.id);
    const streams = await this.planning.getStreams({
      organizationId,
      semesterIds: [period.semesterId],
      groupIds: periodGroupIds,
    });
    const semesterLessons = await this.prisma.scheduleLesson.findMany({
      where: { studentGroupId: { in: periodGroupIds }, semesterItem: { semesterId: period.semesterId } },
      include: { conducted: true },
    });
    const forHours: LessonForHours[] = semesterLessons.map((l) => ({
      id: l.id,
      studentGroupId: l.studentGroupId,
      semesterCurriculumItemId: l.semesterCurriculumItemId,
      lessonType: l.lessonType,
      subgroupNumber: l.subgroupNumber,
      status: l.status,
      academicHours: l.academicHours,
      date: toDateStr(l.date),
      teacherId: l.teacherId,
      allowHoursExcess: l.allowHoursExcess,
      conducted: l.conducted,
    }));
    const { matched } = matchLessonsToStreams(streams, forHours);
    const semesterEnd = toDateStr(period.semester.endDate);
    const allowedDaysCache = new Map<string, string[]>();
    for (const s of streams) {
      const label = `${s.groupCode}${s.subgroupNumber ? ` (п/г ${s.subgroupNumber})` : ''}, ${s.itemCode} ${s.itemName}, ${LESSON_TYPE_LABELS[s.lessonType].toLowerCase()}`;
      const list = matched.get(s.key) ?? [];
      const h = computeStreamHours(s, list, today);
      const base = { entityType: 'SemesterCurriculumItem', entityId: s.semesterItemId };
      if (!s.teacherId) {
        add({ ...base, severity: Severity.WARNING, validationType: 'UNASSIGNED_TEACHER', message: `Не назначен преподаватель: ${label}` });
      }
      if (h.excess > 0) {
        add({
          ...base,
          severity: h.excessApproved ? Severity.WARNING : Severity.ERROR,
          validationType: h.excessApproved ? 'HOURS_EXCESS_APPROVED' : 'HOURS_EXCEEDED',
          message: `Превышение часов: ${label} — в расписании ${h.scheduled} ч при плане ${h.planned} ч${h.excessApproved ? ' (разрешено вручную)' : ''}`,
          details: { streamKey: s.key, planned: h.planned, scheduled: h.scheduled },
        });
      } else if (h.scheduleDeficit > 0) {
        add({
          ...base,
          severity: Severity.WARNING,
          validationType: 'HOURS_DEFICIT',
          message: `Дефицит часов: ${label} — в расписании ${h.scheduled} ч из ${h.planned} ч (не хватает ${h.scheduleDeficit} ч)`,
          details: { streamKey: s.key, planned: h.planned, scheduled: h.scheduled },
        });
      }

      // Равномерность по неделям
      const own = list.filter((l) => ACTIVE_STATUSES.includes(l.status)).map((l) => l.date).sort();
      if (own.length >= 8) {
        const cacheKey = s.groupId;
        let allowedDays = allowedDaysCache.get(cacheKey);
        if (!allowedDays) {
          allowedDays = eachDay(maxStr(from, s.semesterStart), minStr(to, s.semesterEnd)).filter((d) =>
            ctx.groups.has(s.groupId) ? ctx.isRegularAllowed(s.groupId, d) : true,
          );
          allowedDaysCache.set(cacheKey, allowedDays);
        }
        const weeks = Array.from(new Set(allowedDays.map((d) => weekStart(d)))).sort();
        const counts = weeks.map((w) => own.filter((d) => weekStart(d) === w).length);
        const firstIdx = counts.findIndex((c) => c > 0);
        const lastIdx = counts.length - 1 - [...counts].reverse().findIndex((c) => c > 0);
        let longestGap = 0;
        let gap = 0;
        for (let i = firstIdx; i <= lastIdx && i >= 0; i++) {
          gap = counts[i] === 0 ? gap + 1 : 0;
          longestGap = Math.max(longestGap, gap);
        }
        const avg = own.length / Math.max(1, weeks.length);
        const maxWeek = Math.max(...counts);
        if (longestGap >= 3 || (maxWeek >= 4 && maxWeek > avg * 2.5)) {
          add({
            ...base,
            severity: Severity.WARNING,
            validationType: 'UNEVEN_DISTRIBUTION',
            message: `Неравномерное распределение: ${label} — ${longestGap >= 3 ? `перерыв ${longestGap} недель` : `до ${maxWeek} пар в неделю при среднем ${avg.toFixed(1)}`}`,
          });
        }
      }

      // Хватит ли недель до конца семестра
      if (today < semesterEnd && h.remaining > 0) {
        const start = today > s.semesterStart ? today : s.semesterStart;
        const days = eachDay(start, semesterEnd).filter((d) => (ctx.groups.has(s.groupId) ? ctx.isRegularAllowed(s.groupId, d) : true));
        const weeksLeft = new Set(days.map((d) => weekStart(d))).size;
        const lessonsLeft = Math.ceil(h.remaining / settings.academicHoursPerLesson);
        if (weeksLeft === 0 || lessonsLeft / weeksLeft > settings.maxSameDisciplinePerWeek * 1.5) {
          add({
            ...base,
            severity: Severity.WARNING,
            validationType: 'NOT_ENOUGH_WEEKS',
            message: `Мало учебных недель: ${label} — осталось провести ${h.remaining} ч за ${weeksLeft} нед.`,
          });
        }
      }
    }

    // ------------------------------------------------------------ экзамены
    const assessments = await this.prisma.assessmentEvent.findMany({
      where: {
        studentGroupId: { in: periodGroupIds },
        date: { gte: parseDate(from), lte: parseDate(addDaysStr(to, 21)) },
        controlForm: { in: [ControlForm.EXAM, ControlForm.QUALIFICATION_EXAM] },
      },
      include: { group: { select: { code: true } } },
    });
    const examsByWeek = new Map<string, number>();
    for (const a of assessments) {
      const key = `${a.studentGroupId}#${weekStart(toDateStr(a.date))}#${a.group.code}`;
      examsByWeek.set(key, (examsByWeek.get(key) ?? 0) + 1);
    }
    for (const [key, count] of examsByWeek) {
      const [groupId, week, code] = key.split('#');
      if (count > settings.maxExamsPerWeek) {
        add({
          severity: Severity.WARNING,
          validationType: 'TOO_MANY_EXAMS',
          entityType: 'StudentGroup',
          entityId: groupId,
          message: `${code}: ${count} экзамена(ов) на неделе с ${formatDateRu(week)} (рекомендуется не более ${settings.maxExamsPerWeek})`,
        });
      }
    }

    const summary = this.summarize(issues);
    if (persist) {
      await this.prisma.$transaction([
        this.prisma.validationResult.deleteMany({ where: { schedulePeriodId: periodId } }),
        this.prisma.validationResult.createMany({
          data: issues.map((i) => ({
            schedulePeriodId: periodId,
            educationalProgramId: period.semester.educationalProgramId,
            severity: i.severity,
            validationType: i.validationType,
            entityType: i.entityType,
            entityId: i.entityId,
            message: i.message,
            detailsJson: (i.details ?? undefined) as Prisma.InputJsonValue | undefined,
          })),
        }),
      ]);
    }
    return summary;
  }

  summarize(issues: ValidationIssue[]): ValidationSummary {
    const byType: Record<string, number> = {};
    for (const i of issues) byType[i.validationType] = (byType[i.validationType] ?? 0) + 1;
    const errors = issues.filter((i) => i.severity === Severity.ERROR);
    return {
      errors: errors.length,
      warnings: issues.filter((i) => i.severity === Severity.WARNING).length,
      infos: issues.filter((i) => i.severity === Severity.INFO).length,
      canPublish: !errors.some((e) => BLOCKING_TYPES.has(e.validationType)),
      byType,
      items: [...issues].sort((a, b) => sevRank(a.severity) - sevRank(b.severity)),
    };
  }

  async storedResults(periodId: string, organizationId: string, severity?: Severity) {
    const period = await this.prisma.schedulePeriod.findFirst({ where: { id: periodId, organizationId } });
    if (!period) throw new NotFoundException('Период расписания не найден');
    return this.prisma.validationResult.findMany({
      where: { schedulePeriodId: periodId, severity: severity || undefined },
      orderBy: [{ severity: 'asc' }, { validationType: 'asc' }, { createdAt: 'asc' }],
    });
  }
}

function sevRank(s: Severity): number {
  return s === Severity.ERROR ? 0 : s === Severity.WARNING ? 1 : 2;
}

function maxStr(a: string, b: string) {
  return a > b ? a : b;
}

function minStr(a: string, b: string) {
  return a < b ? a : b;
}
