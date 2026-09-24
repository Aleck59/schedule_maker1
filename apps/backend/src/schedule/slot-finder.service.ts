import { Injectable } from '@nestjs/common';
import { ClassroomType, LessonType } from '@prisma/client';
import {
  addDaysStr,
  eachDay,
  isoWeekday,
  maxDate,
  minDate,
  parseDate,
  toDateStr,
  todayInTimezone,
} from '../common/utils/dates';
import { effectiveRoomTypes } from '../common/utils/rooms';
import { ACTIVE_STATUSES } from '../planning/hours-calculator';
import { PlanningService } from '../planning/planning.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

export interface SlotRequest {
  organizationId: string;
  studentGroupId: string;
  subgroupNumber: number | null;
  semesterCurriculumItemId: string;
  lessonType: LessonType;
  teacherId: string | null;
  from?: string;
  to?: string;
  excludeLessonIds?: string[];
  limit?: number;
}

export interface FreeSlot {
  date: string;
  weekday: number;
  lessonNumber: number;
  startTime: string;
  endTime: string;
  classroomId: string | null;
  classroomCode: string | null;
  score: number;
  note: string;
}

/**
 * Поиск свободных слотов: для компенсации отменённых занятий, переноса,
 * постановки дополнительного занятия.
 */
@Injectable()
export class SlotFinderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planning: PlanningService,
    private readonly settings: SettingsService,
  ) {}

  async find(req: SlotRequest): Promise<FreeSlot[]> {
    const settings = await this.settings.getEffective(req.organizationId);
    const item = await this.prisma.semesterCurriculumItem.findUnique({
      where: { id: req.semesterCurriculumItemId },
      include: { semester: true },
    });
    const group = await this.prisma.studentGroup.findUnique({
      where: { id: req.studentGroupId },
      include: { subgroups: true },
    });
    if (!item || !group) return [];
    const today = todayInTimezone(settings.timezone);
    const from = maxDate(req.from ?? today, toDateStr(item.semester.startDate));
    const to = minDate(req.to ?? toDateStr(item.semester.endDate), toDateStr(item.semester.endDate));
    if (from > to) return [];
    const ctx = await this.planning.buildCalendarContext(req.organizationId, from, to, [req.studentGroupId]);
    const [lessons, teacher, rooms, assignment] = await Promise.all([
      this.prisma.scheduleLesson.findMany({
        where: {
          schedulePeriod: { organizationId: req.organizationId },
          status: { in: ACTIVE_STATUSES },
          date: { gte: parseDate(from), lte: parseDate(to) },
          id: req.excludeLessonIds?.length ? { notIn: req.excludeLessonIds } : undefined,
        },
        select: {
          date: true,
          lessonNumber: true,
          studentGroupId: true,
          subgroupNumber: true,
          teacherId: true,
          classroomId: true,
        },
      }),
      req.teacherId
        ? this.prisma.teacher.findUnique({ where: { id: req.teacherId }, include: { availability: true } })
        : Promise.resolve(null),
      this.prisma.classroom.findMany({
        where: { organizationId: req.organizationId, isActive: true },
        include: { availability: { where: { isAvailable: false } } },
      }),
      this.prisma.groupCurriculumAssignment.findFirst({
        where: {
          studentGroupId: req.studentGroupId,
          semesterCurriculumItemId: req.semesterCurriculumItemId,
          OR: [{ lessonType: req.lessonType }, { lessonType: null }],
        },
        orderBy: { lessonType: 'asc' },
      }),
    ]);
    const types = effectiveRoomTypes(req.lessonType, item, assignment?.classroomTypes);
    const sg = req.subgroupNumber ? group.subgroups.find((s) => s.number === req.subgroupNumber) : undefined;
    const size = req.subgroupNumber
      ? sg && sg.studentCount > 0
        ? sg.studentCount
        : Math.ceil(group.studentCount / Math.max(1, group.subgroupCount))
      : group.studentCount;
    const suitableRooms = rooms
      .filter(
        (r) =>
          types.includes(r.classroomType) && (r.classroomType === ClassroomType.ONLINE || r.capacity >= size),
      )
      .sort(
        (a, b) => types.indexOf(a.classroomType) - types.indexOf(b.classroomType) || a.capacity - b.capacity,
      );

    const busyTeacher = new Set<string>();
    const busyRoom = new Set<string>();
    const busyGroup = new Map<string, Set<number>>();
    const groupDayCount = new Map<string, number>();
    const teacherDayCount = new Map<string, number>();
    for (const l of lessons) {
      const d = toDateStr(l.date);
      const slot = `${d}#${l.lessonNumber}`;
      if (l.teacherId) {
        busyTeacher.add(`${l.teacherId}#${slot}`);
        teacherDayCount.set(`${l.teacherId}#${d}`, (teacherDayCount.get(`${l.teacherId}#${d}`) ?? 0) + 1);
      }
      if (l.classroomId) busyRoom.add(`${l.classroomId}#${slot}`);
      const set = busyGroup.get(`${l.studentGroupId}#${slot}`) ?? new Set<number>();
      set.add(l.subgroupNumber ?? 0);
      busyGroup.set(`${l.studentGroupId}#${slot}`, set);
      if (l.studentGroupId === req.studentGroupId) {
        groupDayCount.set(d, (groupDayCount.get(d) ?? 0) + 1);
      }
    }
    const teacherUnavailable = new Set(
      (teacher?.availability ?? [])
        .filter((a) => !a.isAvailable)
        .map((a) => `${a.weekday}#${a.lessonNumber}`),
    );

    const result: FreeSlot[] = [];
    for (const date of eachDay(from, to)) {
      const allowed =
        req.lessonType === LessonType.PRACTICE
          ? ctx.groupDay(req.studentGroupId, date).isWorkingDay
          : ctx.isRegularAllowed(req.studentGroupId, date);
      if (!allowed) continue;
      if (teacher && ctx.teacherBlocks(teacher.id, date).length > 0) continue;
      const weekday = isoWeekday(date);
      const dayCount = groupDayCount.get(date) ?? 0;
      for (let lesson = 1; lesson <= settings.lessonsPerDay; lesson++) {
        const slot = `${date}#${lesson}`;
        const gs = busyGroup.get(`${req.studentGroupId}#${slot}`);
        if (gs && (req.subgroupNumber === null || gs.has(0) || gs.has(req.subgroupNumber))) continue;
        if (teacher) {
          if (teacherUnavailable.has(`${weekday}#${lesson}`)) continue;
          if (busyTeacher.has(`${teacher.id}#${slot}`)) continue;
          if ((teacherDayCount.get(`${teacher.id}#${date}`) ?? 0) >= teacher.maxDailyLessons) continue;
        }
        const room = suitableRooms.find(
          (r) =>
            !r.availability.some((a) => a.weekday === weekday && a.lessonNumber === lesson) &&
            (r.classroomType === ClassroomType.ONLINE || !busyRoom.has(`${r.id}#${slot}`)),
        );
        if (!room && suitableRooms.length > 0) continue;
        let score = 0;
        const notes: string[] = [];
        score += (parseDate(date).getTime() - parseDate(from).getTime()) / 86400000 / 7;
        if (dayCount + 1 > settings.maxGroupLessonsPerDay) {
          score += 5;
          notes.push('перегрузка дня группы');
        }
        if (lesson >= settings.lateLessonNumber) {
          score += 3;
          notes.push('поздняя пара');
        }
        if (teacher && (lesson < teacher.preferredStartLesson || lesson > teacher.preferredEndLesson)) {
          score += 1;
          notes.push('вне предпочтений преподавателя');
        }
        // Предпочтение слотам рядом с другими занятиями группы (без окон)
        const neighbours = [lesson - 1, lesson + 1].filter((n) => {
          const s = busyGroup.get(`${req.studentGroupId}#${date}#${n}`);
          return s && s.size > 0;
        }).length;
        if (dayCount > 0 && neighbours === 0) {
          score += 2;
          notes.push('окно у группы');
        }
        const time = this.settings.lessonTime(settings, lesson);
        result.push({
          date,
          weekday,
          lessonNumber: lesson,
          startTime: time.startTime,
          endTime: time.endTime,
          classroomId: room?.id ?? null,
          classroomCode: room?.code ?? null,
          score: Math.round(score * 10) / 10,
          note: notes.length ? notes.join(', ') : 'подходит',
        });
      }
    }
    result.sort(
      (a, b) => a.score - b.score || a.date.localeCompare(b.date) || a.lessonNumber - b.lessonNumber,
    );
    return result.slice(0, req.limit ?? 10);
  }

  /** Конец поиска по умолчанию — через 6 недель */
  static defaultTo(from: string): string {
    return addDaysStr(from, 42);
  }
}
