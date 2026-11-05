import { Injectable } from '@nestjs/common';
import {
  CurriculumItemType,
  GroupCurriculumAssignment,
  LessonType,
  Prisma,
  SemesterCurriculumItem,
} from '@prisma/client';
import { toDateStr } from '../common/utils/dates';
import { hoursForType, hoursToLessons } from '../common/utils/hours';
import { effectiveRoomTypes } from '../common/utils/rooms';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CalendarContext, ContextGroup, normalizeEvent } from './calendar-context';
import { DemandStream, StreamFilter } from './planning.types';

const NON_SCHEDULED_ITEM_TYPES: CurriculumItemType[] = [
  CurriculumItemType.MODULE,
  CurriculumItemType.FINAL_ATTESTATION,
];
const PRACTICE_ITEM_TYPES: CurriculumItemType[] = [
  CurriculumItemType.EDUCATIONAL_PRACTICE,
  CurriculumItemType.INDUSTRIAL_PRACTICE,
  CurriculumItemType.PRE_DIPLOMA_PRACTICE,
];

type AssignmentWithTeacher = GroupCurriculumAssignment & { teacher: { id: string; fullName: string } | null };

export function streamKeyOf(
  groupId: string,
  semesterItemId: string,
  lessonType: LessonType,
  subgroup: number | null,
) {
  return `${groupId}|${semesterItemId}|${lessonType}|${subgroup ?? 0}`;
}

/**
 * Планирование: календарный контекст и потоки спроса (сколько пар каждого вида
 * нужно поставить каждой группе/подгруппе по каждой дисциплине).
 */
@Injectable()
export class PlanningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Какие виды занятий строки плана ставятся в расписание и сколько в них часов */
  schedulableTypes(
    item: SemesterCurriculumItem & { curriculumItem: { itemType: CurriculumItemType } },
    scheduleConsultationsGlobal: boolean,
  ): Array<{ type: LessonType; hours: number }> {
    const itemType = item.curriculumItem.itemType;
    if (NON_SCHEDULED_ITEM_TYPES.includes(itemType)) return [];
    const result: Array<{ type: LessonType; hours: number }> = [];
    if (PRACTICE_ITEM_TYPES.includes(itemType)) {
      // Практика ставится только если проводится на базе организации; вне её — только период в календаре
      if (item.practiceAtCollege && item.practiceHours > 0) {
        result.push({ type: LessonType.PRACTICE, hours: item.practiceHours });
      }
      return result;
    }
    for (const type of [LessonType.LECTURE, LessonType.PRACTICAL, LessonType.LABORATORY] as LessonType[]) {
      const hours = hoursForType(item, type);
      if (hours > 0) result.push({ type, hours });
    }
    if (item.consultationHours > 0 && item.scheduleConsultations && scheduleConsultationsGlobal) {
      result.push({ type: LessonType.CONSULTATION, hours: item.consultationHours });
    }
    return result;
  }

  async getStreams(filter: StreamFilter): Promise<DemandStream[]> {
    const settings = await this.settings.getEffective(filter.organizationId);
    const semesterWhere: Prisma.SemesterWhereInput = {
      program: { organizationId: filter.organizationId },
      id: filter.semesterIds?.length ? { in: filter.semesterIds } : undefined,
      educationalProgramId: filter.programId || undefined,
    };
    // Потоки одного преподавателя: сначала его назначения, и дальше читаются только эти группы и строки
    // плана. Без этого на каждый запрос «моя нагрузка» читалась нагрузка всей организации.
    let groupIds = filter.groupIds?.length ? filter.groupIds : undefined;
    let itemIds: string[] | undefined = filter.semesterItemId ? [filter.semesterItemId] : undefined;
    if (filter.teacherId) {
      const own = await this.prisma.groupCurriculumAssignment.findMany({
        where: {
          teacherId: filter.teacherId,
          studentGroupId: groupIds ? { in: groupIds } : undefined,
          semesterCurriculumItemId: itemIds ? { in: itemIds } : undefined,
          semesterItem: { semester: semesterWhere },
        },
        select: { studentGroupId: true, semesterCurriculumItemId: true },
      });
      if (own.length === 0) return [];
      groupIds = [...new Set(own.map((a) => a.studentGroupId))];
      itemIds = [...new Set(own.map((a) => a.semesterCurriculumItemId))];
    }
    // Строки плана, их дисциплины, семестры и назначения — отдельными параллельными запросами.
    // Вложенные include в Prisma превращаются в IN-списки на тысячи id и на большой базе
    // читаются втрое дольше
    const itemWhere: Prisma.SemesterCurriculumItemWhereInput = {
      semester: semesterWhere,
      id: itemIds ? { in: itemIds } : undefined,
    };
    const [rawItems, curriculumItems, semesters, rawAssignments, orgTeachers] = await Promise.all([
      this.prisma.semesterCurriculumItem.findMany({ where: itemWhere }),
      this.prisma.curriculumItem.findMany({
        where: itemIds
          ? { semesterItems: { some: { id: { in: itemIds } } } }
          : {
              program: { organizationId: filter.organizationId },
              educationalProgramId: filter.programId || undefined,
            },
      }),
      this.prisma.semester.findMany({ where: semesterWhere }),
      this.prisma.groupCurriculumAssignment.findMany({
        where: {
          semesterItem: itemWhere,
          studentGroupId: groupIds ? { in: groupIds } : undefined,
        },
      }),
      // Имена преподавателей — одним списком организации, а не связью на каждое назначение.
      // Для выборки по группам или строкам плана (нагрузка одного преподавателя) — дочитываются ниже
      groupIds || itemIds
        ? Promise.resolve(null)
        : this.prisma.teacher.findMany({
            where: { organizationId: filter.organizationId },
            select: { id: true, fullName: true },
          }),
    ]);
    const teachers =
      orgTeachers ??
      (await this.prisma.teacher.findMany({
        where: { id: { in: [...new Set(rawAssignments.map((a) => a.teacherId).filter((x) => x !== null))] } },
        select: { id: true, fullName: true },
      }));
    const teacherById = new Map(teachers.map((t) => [t.id, t]));
    const assignments: AssignmentWithTeacher[] = rawAssignments.map((a) => ({
      ...a,
      teacher: a.teacherId ? (teacherById.get(a.teacherId) ?? null) : null,
    }));
    const curriculumById = new Map(curriculumItems.map((c) => [c.id, c]));
    const semesterById = new Map(semesters.map((x) => [x.id, x]));
    const assignmentsByItem = new Map<string, AssignmentWithTeacher[]>();
    for (const a of assignments) {
      const list = assignmentsByItem.get(a.semesterCurriculumItemId);
      if (list) list.push(a);
      else assignmentsByItem.set(a.semesterCurriculumItemId, [a]);
    }
    const items = rawItems.map((item) => ({
      ...item,
      curriculumItem: curriculumById.get(item.curriculumItemId)!,
      semester: semesterById.get(item.semesterId)!,
      assignments: assignmentsByItem.get(item.id) ?? [],
    }));
    if (items.length === 0) return [];
    const programIds = Array.from(new Set(items.map((i) => i.semester.educationalProgramId)));
    const groups = await this.prisma.studentGroup.findMany({
      where: {
        educationalProgramId: { in: programIds },
        id: groupIds ? { in: groupIds } : undefined,
        isActive: filter.includeInactiveGroups || filter.groupIds?.length ? undefined : true,
      },
      include: { subgroups: true },
      orderBy: { code: 'asc' },
    });

    // Индексы вместо перебора: строки плана по программе, назначения по строке и группе
    const itemsByProgram = new Map<string, typeof items>();
    const assignmentsOf = new Map<string, AssignmentWithTeacher[]>();
    for (const item of items) {
      const list = itemsByProgram.get(item.semester.educationalProgramId);
      if (list) list.push(item);
      else itemsByProgram.set(item.semester.educationalProgramId, [item]);
      for (const a of item.assignments as AssignmentWithTeacher[]) {
        const key = `${item.id}|${a.studentGroupId}`;
        const arr = assignmentsOf.get(key);
        if (arr) arr.push(a);
        else assignmentsOf.set(key, [a]);
      }
    }
    const streams: DemandStream[] = [];
    for (const group of groups) {
      const groupItems = itemsByProgram.get(group.educationalProgramId) ?? [];
      for (const item of groupItems) {
        const assignments = assignmentsOf.get(`${item.id}|${group.id}`) ?? [];
        // Дисциплины по выбору и факультативы ставятся только группам, которые их выбрали (есть нагрузка)
        if (!item.curriculumItem.isRequired && assignments.length === 0) continue;
        for (const { type, hours } of this.schedulableTypes(item, settings.scheduleConsultations)) {
          const specific = assignments.filter((a) => a.lessonType === type);
          const general = assignments.filter((a) => a.lessonType === null);
          const used: Array<AssignmentWithTeacher | null> =
            specific.length > 0 ? specific : general.length > 0 ? general : [null];
          for (const a of used) {
            const subgroup = a?.subgroupNumber ?? null;
            const sg = subgroup ? group.subgroups.find((s) => s.number === subgroup) : undefined;
            const size = subgroup
              ? sg && sg.studentCount > 0
                ? sg.studentCount
                : Math.ceil(group.studentCount / Math.max(1, group.subgroupCount))
              : group.studentCount;
            const planned = a?.plannedHours ?? hours;
            const split = hoursToLessons(planned, settings.academicHoursPerLesson);
            const stream: DemandStream = {
              key: streamKeyOf(group.id, item.id, type, subgroup),
              groupId: group.id,
              groupCode: group.code,
              programId: group.educationalProgramId,
              subgroupNumber: subgroup,
              size,
              semesterId: item.semesterId,
              semesterNumber: item.semester.number,
              semesterStart: toDateStr(item.semester.startDate),
              semesterEnd: toDateStr(item.semester.endDate),
              semesterItemId: item.id,
              curriculumItemId: item.curriculumItemId,
              itemCode: item.curriculumItem.code,
              itemName: item.curriculumItem.name,
              itemType: item.curriculumItem.itemType,
              isDifficult: item.curriculumItem.isDifficult,
              controlForm: item.controlForm,
              lessonType: type,
              assignmentId: a?.id ?? null,
              teacherId: a?.teacherId ?? null,
              teacherName: a?.teacher?.fullName ?? null,
              plannedHours: planned,
              plannedLessons: split.lessons,
              partialHours: split.partialHours,
              weeklyTarget: a?.weeklyLessonTarget ?? null,
              priority: a?.priority ?? 5,
              roomTypes: effectiveRoomTypes(type, item, a?.classroomTypes),
              preferredClassroomId: a?.preferredClassroomId ?? null,
              streamKey: a?.streamKey ?? null,
              allowHoursExcess: a?.allowHoursExcess ?? false,
            };
            if (filter.teacherId && stream.teacherId !== filter.teacherId) continue;
            streams.push(stream);
          }
        }
      }
    }
    return streams;
  }

  /** Календарный контекст для групп на интервал дат */
  async buildCalendarContext(
    organizationId: string,
    from: string,
    to: string,
    groupIds?: string[],
  ): Promise<CalendarContext> {
    const settings = await this.settings.getEffective(organizationId);
    const [events, groups] = await Promise.all([
      this.prisma.calendarEvent.findMany({
        where: {
          organizationId,
          startDate: { lte: new Date(`${to}T00:00:00.000Z`) },
          endDate: { gte: new Date(`${from}T00:00:00.000Z`) },
        },
      }),
      this.prisma.studentGroup.findMany({
        where: {
          program: { organizationId },
          id: groupIds?.length ? { in: groupIds } : undefined,
        },
        include: { program: { include: { academicYears: true } } },
      }),
    ]);
    const contextGroups = new Map<string, ContextGroup>(
      groups.map((g) => [
        g.id,
        {
          id: g.id,
          code: g.code,
          programId: g.educationalProgramId,
          courseNumber: g.courseNumber,
          academicYears: g.program.academicYears.map((y) => ({
            start: toDateStr(y.startDate),
            end: toDateStr(y.endDate),
            courseNumber: y.courseNumber,
          })),
        },
      ]),
    );
    return new CalendarContext(events.map(normalizeEvent), settings.workingDays, contextGroups);
  }
}
