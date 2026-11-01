import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ClassroomType, GenerationJobStatus, Prisma, WeekParity } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { formatDateRu, toDateStr } from '../common/utils/dates';
import { PrismaService } from '../prisma/prisma.service';
import { GenerationService } from '../scheduler/generation.service';
import { solveHeuristicInThread } from '../scheduler/heuristic-thread';
import { BuiltProblem, ProblemBuilderService } from '../scheduler/problem-builder.service';
import { SolverResult } from '../scheduler/solver.types';
import { SettingsService } from '../settings/settings.service';
import {
  CreatePermanentScheduleDto,
  GeneratePermanentDto,
  UpdatePermanentLessonDto,
  UpdatePermanentScheduleDto,
} from './dto/permanent-schedule.dto';
import { PermanentResultJson, PermanentUnplaced, parityOverlaps } from './permanent-schedule.types';

const RUNNING: GenerationJobStatus[] = [GenerationJobStatus.QUEUED, GenerationJobStatus.GENERATING];

const lessonInclude = {
  studentGroup: { select: { id: true, code: true } },
  semesterItem: { select: { id: true, curriculumItem: { select: { code: true, name: true } } } },
  teacher: { select: { id: true, fullName: true } },
  classroom: { select: { id: true, code: true, classroomType: true } },
} satisfies Prisma.PermanentLessonInclude;

type LessonRow = Prisma.PermanentLessonGetPayload<{ include: typeof lessonInclude }>;

/**
 * Постоянное расписание для руководства: типовая неделя (день × пара, числитель/знаменатель),
 * равномерно распределяющая нагрузку семестра. Недоступность, пожелания и лимиты преподавателей
 * не учитываются; запрещены только накладки — преподаватель, группа или аудитория в двух местах сразу.
 * Хранится отдельно от рабочего (внутреннего) расписания по датам и никак на него не влияет.
 */
@Injectable()
export class PermanentScheduleService implements OnModuleInit {
  private readonly logger = new Logger(PermanentScheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly builder: ProblemBuilderService,
    private readonly generation: GenerationService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /** Формирование, прерванное перезапуском сервера, помечается ошибкой */
  async onModuleInit() {
    await this.prisma.permanentSchedule
      .updateMany({
        where: { jobStatus: { in: RUNNING } },
        data: {
          jobStatus: GenerationJobStatus.FAILED,
          message: 'Формирование прервано перезапуском сервера — запустите его снова',
        },
      })
      .catch(() => undefined);
  }

  list(actor: AuthUser) {
    return this.prisma.permanentSchedule
      .findMany({
        where: { organizationId: actor.organizationId },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        include: { _count: { select: { lessons: true } } },
      })
      .then((rows) =>
        rows.map(({ _count, resultJson, ...r }) => ({
          ...r,
          date: toDateStr(r.date),
          lessonCount: _count.lessons,
          stats: (resultJson as PermanentResultJson | null)?.stats ?? null,
        })),
      );
  }

  private async find(id: string, actor: AuthUser) {
    const schedule = await this.prisma.permanentSchedule.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!schedule) throw new NotFoundException('Постоянное расписание не найдено');
    return schedule;
  }

  async get(id: string, actor: AuthUser) {
    const schedule = await this.find(id, actor);
    const lessons = await this.prisma.permanentLesson.findMany({
      where: { permanentScheduleId: id },
      include: lessonInclude,
      orderBy: [{ weekday: 'asc' }, { lessonNumber: 'asc' }],
    });
    const settings = await this.settings.getEffective(actor.organizationId);
    return {
      ...schedule,
      date: toDateStr(schedule.date),
      result: schedule.resultJson as PermanentResultJson | null,
      resultJson: undefined,
      workingDays: [...settings.workingDays].sort((a, b) => a - b),
      lessonsPerDay: settings.lessonsPerDay,
      lessonTimes: settings.lessonTimes.map((t) => ({
        lessonNumber: t.lessonNumber,
        startTime: t.startTime,
        endTime: t.endTime,
      })),
      lessons: lessons.map((l) => this.present(l)),
    };
  }

  private present(l: LessonRow) {
    return {
      id: l.id,
      weekday: l.weekday,
      lessonNumber: l.lessonNumber,
      weekParity: l.weekParity,
      groupId: l.studentGroupId,
      groupCode: l.studentGroup.code,
      subgroupNumber: l.subgroupNumber,
      semesterItemId: l.semesterCurriculumItemId,
      itemCode: l.semesterItem.curriculumItem.code,
      itemName: l.semesterItem.curriculumItem.name,
      lessonType: l.lessonType,
      teacherId: l.teacherId,
      teacherName: l.teacher?.fullName ?? null,
      classroomId: l.classroomId,
      classroomCode: l.classroom?.code ?? null,
      streamKey: l.streamKey,
      isManual: l.isManual,
    };
  }

  async create(dto: CreatePermanentScheduleDto, actor: AuthUser) {
    const plan = await this.generation.planAll(actor, dto);
    if (!plan.groups.some((g) => g.included)) {
      throw new BadRequestException(
        `На ${formatDateRu(dto.date)} нет активных групп с текущим семестром — выберите другую дату`,
      );
    }
    const schedule = await this.prisma.permanentSchedule.create({
      data: {
        organizationId: actor.organizationId,
        title: dto.title.trim(),
        date: new Date(`${dto.date}T00:00:00.000Z`),
        educationLevels: dto.educationLevels ?? [],
        programIds: dto.programIds ?? [],
      },
    });
    await this.audit.log(actor.id, 'CREATE', 'PermanentSchedule', schedule.id, null, dto);
    if (dto.generate !== false) await this.generate(schedule.id, {}, actor);
    return this.get(schedule.id, actor);
  }

  async update(id: string, dto: UpdatePermanentScheduleDto, actor: AuthUser) {
    const old = await this.find(id, actor);
    await this.prisma.permanentSchedule.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        notes: dto.notes === undefined ? undefined : dto.notes?.trim() || null,
      },
    });
    await this.audit.log(actor.id, 'UPDATE', 'PermanentSchedule', id, { title: old.title }, dto);
    return this.get(id, actor);
  }

  async remove(id: string, actor: AuthUser) {
    const old = await this.find(id, actor);
    if (old.approvedAt)
      throw new ConflictException('Утверждённое расписание нельзя удалить — сначала снимите утверждение');
    await this.prisma.permanentSchedule.delete({ where: { id } });
    await this.audit.log(actor.id, 'DELETE', 'PermanentSchedule', id, { title: old.title }, null);
    return { ok: true };
  }

  async approve(id: string, approved: boolean, actor: AuthUser) {
    const schedule = await this.find(id, actor);
    if (approved && schedule.jobStatus && RUNNING.includes(schedule.jobStatus)) {
      throw new ConflictException('Дождитесь окончания формирования');
    }
    await this.prisma.permanentSchedule.update({
      where: { id },
      data: approved
        ? { approvedAt: new Date(), approvedById: actor.id }
        : { approvedAt: null, approvedById: null },
    });
    await this.audit.log(actor.id, approved ? 'APPROVE' : 'UNAPPROVE', 'PermanentSchedule', id);
    return this.get(id, actor);
  }

  private ensureEditable(schedule: { approvedAt: Date | null; jobStatus: GenerationJobStatus | null }) {
    if (schedule.approvedAt) {
      throw new ConflictException('Расписание утверждено — чтобы изменить его, снимите утверждение');
    }
    if (schedule.jobStatus && RUNNING.includes(schedule.jobStatus)) {
      throw new ConflictException('Идёт формирование сетки — дождитесь его окончания');
    }
  }

  // ------------------------------------------------------------------ формирование

  async generate(id: string, dto: GeneratePermanentDto, actor: AuthUser) {
    const schedule = await this.find(id, actor);
    this.ensureEditable(schedule);
    await this.prisma.permanentSchedule.update({
      where: { id },
      data: {
        jobStatus: GenerationJobStatus.GENERATING,
        progress: 5,
        message: 'Подготовка данных: нагрузка, учебные планы, календарный график',
      },
    });
    await this.audit.log(actor.id, 'GENERATE', 'PermanentSchedule', id, null, dto);
    void this.run(id, dto, actor).catch((e: Error) => this.logger.error(e.stack ?? e.message));
    return { id, jobStatus: GenerationJobStatus.GENERATING };
  }

  private async run(id: string, dto: GeneratePermanentDto, actor: AuthUser) {
    const setState = (data: Prisma.PermanentScheduleUpdateInput) =>
      this.prisma.permanentSchedule.update({ where: { id }, data });
    try {
      const schedule = await this.find(id, actor);
      const plan = await this.generation.planAll(actor, {
        date: toDateStr(schedule.date),
        educationLevels: schedule.educationLevels,
        programIds: schedule.programIds,
      });
      const included = plan.groups.filter((g) => g.included && g.semesterId);
      if (included.length === 0) {
        throw new BadRequestException(
          `На ${formatDateRu(toDateStr(schedule.date))} нет групп с текущим семестром`,
        );
      }
      const semesterIds = [...new Set(included.map((g) => g.semesterId!))];
      const semesters = await this.prisma.semester.findMany({ where: { id: { in: semesterIds } } });
      const settings = await this.settings.getEffective(actor.organizationId);
      const built = await this.builder.buildPermanent(actor.organizationId, semesters, {
        groupIds: included.map((g) => g.groupId),
        maximizePlacement: dto.maximizePlacement !== false,
        avoidWindows: dto.avoidWindows !== false,
        allowLateLessons: dto.allowLateLessons !== false,
        // Учитываются только пожелания по номерам пар, недоступность и лимиты — нет
        respectTeacherPreferences: false,
        timeLimitSeconds: dto.timeLimitSeconds ?? Math.min(60, settings.solverTimeLimitSeconds),
      });
      await setState({
        progress: 20,
        message: `Составление типовой недели: ${built.problem.demands.length} дисциплин, ${built.groupIds.length} групп`,
      });
      let last = 0;
      const result = await solveHeuristicInThread(built.problem, {
        templateOnly: true,
        onProgress: (fraction, message) => {
          if (Date.now() - last < 1000) return;
          last = Date.now();
          void setState({ progress: Math.round(20 + fraction * 70), message }).catch(() => undefined);
        },
      });
      const { rows, summary } = this.compose(built, result, semesters);
      await this.prisma.$transaction([
        this.prisma.permanentLesson.deleteMany({ where: { permanentScheduleId: id } }),
        this.prisma.permanentLesson.createMany({
          data: rows.map((r) => ({ ...r, permanentScheduleId: id })),
        }),
        this.prisma.permanentSchedule.update({
          where: { id },
          data: {
            semesterIds,
            jobStatus:
              summary.unplaced.length > 0
                ? GenerationJobStatus.COMPLETED_WITH_CONFLICTS
                : GenerationJobStatus.COMPLETED,
            progress: 100,
            generatedAt: new Date(),
            message:
              summary.unplaced.length > 0
                ? `Готово с замечаниями: поставлено ${summary.stats.placedWeekly} из ${summary.stats.requiredWeekly} пар недели`
                : `Готово: ${summary.stats.placedWeekly} пар в типовой неделе`,
            resultJson: summary as unknown as Prisma.InputJsonValue,
          },
        }),
      ]);
    } catch (e) {
      this.logger.error(`Постоянное расписание ${id}: ${(e as Error).stack}`);
      await setState({
        jobStatus: GenerationJobStatus.FAILED,
        progress: 100,
        message: `Ошибка: ${(e as Error).message}`,
      }).catch(() => undefined);
    }
  }

  /** Размещения типовой недели → пары постоянного расписания по группам + итоги */
  private compose(
    built: BuiltProblem,
    result: SolverResult,
    semesters: Array<{ id: string; number: number }>,
  ): {
    rows: Prisma.PermanentLessonCreateManyInput[];
    summary: PermanentResultJson;
  } {
    const demandById = new Map(built.problem.demands.map((d) => [d.id, d]));
    const rows: Omit<Prisma.PermanentLessonCreateManyInput, 'permanentScheduleId'>[] = [];
    const placedByDemand = new Map<string, number>();
    for (const p of result.placements) {
      const meta = built.demandMeta[p.demandId];
      const demand = demandById.get(p.demandId);
      if (!meta || !demand || !p.date.startsWith('T')) continue;
      placedByDemand.set(p.demandId, (placedByDemand.get(p.demandId) ?? 0) + (p.parity ? 0.5 : 1));
      for (const s of meta.streams) {
        rows.push({
          weekday: Number(p.date.slice(1)),
          lessonNumber: p.lessonNumber,
          weekParity: (p.parity as WeekParity | undefined) ?? WeekParity.ANY,
          studentGroupId: s.groupId,
          subgroupNumber: demand.subgroupNumber,
          semesterCurriculumItemId: s.semesterItemId,
          assignmentId: s.assignmentId,
          teacherId: meta.teacherId,
          classroomId: p.roomId,
          lessonType: meta.lessonType as Prisma.PermanentLessonCreateManyInput['lessonType'],
          streamKey: meta.streams.length > 1 ? s.streamGroupKey : null,
        });
      }
    }

    const unplaced: PermanentUnplaced[] = [];
    for (const u of result.unplaced) {
      const meta = built.demandMeta[u.demandId];
      if (!meta || u.count <= 0) continue;
      unplaced.push({
        groupCodes: meta.groupCodes,
        subgroupNumber: meta.subgroupNumber,
        itemCode: meta.itemCode,
        itemName: meta.itemName,
        lessonType: meta.lessonType,
        teacherName: meta.teacherName,
        lessonsPerWeek: placedByDemand.get(u.demandId) ?? 0,
        missingPerWeek: u.count,
        reason:
          'В типовой неделе не нашлось свободного времени: у группы, преподавателя или подходящих аудиторий все пары заняты',
      });
    }
    // Не вошли в сетку ещё до составления: нет преподавателя, нет аудиторий нужного типа и т. п.
    for (const u of built.preUnplaced) {
      unplaced.push({
        groupCodes: u.groupCodes,
        subgroupNumber: u.subgroupNumber,
        itemCode: u.itemCode,
        itemName: u.disciplineName,
        lessonType: u.lessonType,
        teacherName: u.teacherName,
        lessonsPerWeek: 0,
        missingPerWeek: null,
        reason: u.reasons.map((r) => r.message).join('; '),
      });
    }

    const groups = built.problem.groups.map((g) => {
      const own = rows.filter((r) => r.studentGroupId === g.id);
      const weekly = own.reduce((a, r) => a + (r.weekParity === WeekParity.ANY ? 1 : 0.5), 0);
      return { groupId: g.id, groupCode: g.code, lessonsPerWeek: weekly };
    });
    const requiredWeekly = result.stats.requiredLessons;
    return {
      rows: rows as Prisma.PermanentLessonCreateManyInput[],
      summary: {
        stats: {
          requiredWeekly,
          placedWeekly: result.stats.placedLessons,
          groups: groups.length,
          teachers: new Set(rows.map((r) => r.teacherId).filter(Boolean)).size,
          unplaced: unplaced.length,
          biweekly: result.placements.filter((p) => p.parity).length,
          withoutRoom: result.placements.filter((p) => !p.roomId).length,
          weeks: result.stats.weeks,
          durationMs: result.stats.durationMs,
        },
        semesters: semesters.map((s) => ({ id: s.id, number: s.number })),
        range: built.range,
        groupLoad: groups.sort((a, b) => a.groupCode.localeCompare(b.groupCode, 'ru')),
        unplaced,
        warnings: built.warnings.filter((w) => !w.startsWith('Поток')),
        log: result.log,
      },
    };
  }

  // ------------------------------------------------------------------ ручная правка

  async updateLesson(id: string, lessonId: string, dto: UpdatePermanentLessonDto, actor: AuthUser) {
    const schedule = await this.find(id, actor);
    this.ensureEditable(schedule);
    const lesson = await this.prisma.permanentLesson.findFirst({
      where: { id: lessonId, permanentScheduleId: id },
    });
    if (!lesson) throw new NotFoundException('Пара не найдена');
    // Пара потока переносится у всех групп потока
    const siblings = lesson.streamKey
      ? await this.prisma.permanentLesson.findMany({
          where: {
            permanentScheduleId: id,
            streamKey: lesson.streamKey,
            weekday: lesson.weekday,
            lessonNumber: lesson.lessonNumber,
            weekParity: lesson.weekParity,
            lessonType: lesson.lessonType,
            teacherId: lesson.teacherId,
          },
        })
      : [lesson];
    const target = {
      weekday: dto.weekday ?? lesson.weekday,
      lessonNumber: dto.lessonNumber ?? lesson.lessonNumber,
      weekParity: dto.weekParity ?? lesson.weekParity,
      teacherId: dto.teacherId === undefined ? lesson.teacherId : dto.teacherId,
      classroomId: dto.classroomId === undefined ? lesson.classroomId : dto.classroomId,
    };
    const settings = await this.settings.getEffective(actor.organizationId);
    if (!settings.workingDays.includes(target.weekday))
      throw new BadRequestException('Этот день недели — нерабочий');
    if (target.lessonNumber > settings.lessonsPerDay) {
      throw new BadRequestException(`В день не более ${settings.lessonsPerDay} пар`);
    }
    if (target.teacherId) {
      const t = await this.prisma.teacher.findFirst({
        where: { id: target.teacherId, organizationId: actor.organizationId },
      });
      if (!t) throw new BadRequestException('Преподаватель не найден');
    }
    let room: { id: string; code: string; classroomType: ClassroomType } | null = null;
    if (target.classroomId) {
      room = await this.prisma.classroom.findFirst({
        where: { id: target.classroomId, organizationId: actor.organizationId },
        select: { id: true, code: true, classroomType: true },
      });
      if (!room) throw new BadRequestException('Аудитория не найдена');
    }

    const ids = new Set(siblings.map((s) => s.id));
    const others = await this.prisma.permanentLesson.findMany({
      where: {
        permanentScheduleId: id,
        weekday: target.weekday,
        lessonNumber: target.lessonNumber,
        id: { notIn: [...ids] },
      },
      include: lessonInclude,
    });
    const clashes: string[] = [];
    for (const o of others) {
      if (!parityOverlaps(o.weekParity, target.weekParity)) continue;
      const label = `${o.studentGroup.code}: ${o.semesterItem.curriculumItem.name}`;
      for (const s of siblings) {
        if (
          o.studentGroupId === s.studentGroupId &&
          (o.subgroupNumber === null || s.subgroupNumber === null || o.subgroupNumber === s.subgroupNumber)
        ) {
          clashes.push(`у группы уже стоит «${label}»`);
        }
      }
      // Пары одного потока у одного преподавателя — не накладка
      const sameStream = !!o.streamKey && o.streamKey === lesson.streamKey;
      if (target.teacherId && o.teacherId === target.teacherId && !sameStream) {
        clashes.push(`преподаватель ${o.teacher?.fullName ?? ''} ведёт «${label}»`);
      }
      if (room && room.classroomType !== ClassroomType.ONLINE && o.classroomId === room.id && !sameStream) {
        clashes.push(`аудитория ${room.code} занята: «${label}»`);
      }
    }
    if (clashes.length > 0) {
      throw new ConflictException(`Нельзя поставить пару: ${[...new Set(clashes)].join('; ')}`);
    }
    await this.prisma.permanentLesson.updateMany({
      where: { id: { in: [...ids] } },
      data: { ...target, isManual: true },
    });
    await this.audit.log(actor.id, 'UPDATE', 'PermanentLesson', lessonId, lesson, target);
    const updated = await this.prisma.permanentLesson.findMany({
      where: { id: { in: [...ids] } },
      include: lessonInclude,
    });
    return updated.map((l) => this.present(l));
  }

  async removeLesson(id: string, lessonId: string, actor: AuthUser) {
    const schedule = await this.find(id, actor);
    this.ensureEditable(schedule);
    const lesson = await this.prisma.permanentLesson.findFirst({
      where: { id: lessonId, permanentScheduleId: id },
    });
    if (!lesson) throw new NotFoundException('Пара не найдена');
    await this.prisma.permanentLesson.deleteMany({
      where: lesson.streamKey
        ? {
            permanentScheduleId: id,
            streamKey: lesson.streamKey,
            weekday: lesson.weekday,
            lessonNumber: lesson.lessonNumber,
            weekParity: lesson.weekParity,
            lessonType: lesson.lessonType,
            teacherId: lesson.teacherId,
          }
        : { id: lessonId },
    });
    await this.audit.log(actor.id, 'DELETE', 'PermanentLesson', lessonId, lesson, null);
    return { ok: true };
  }
}
