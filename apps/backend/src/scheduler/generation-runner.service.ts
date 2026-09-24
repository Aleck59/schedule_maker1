import { Injectable, Logger } from '@nestjs/common';
import { GenerationJobStatus, Prisma } from '@prisma/client';
import { isoWeekday } from '../common/utils/dates';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { diagnoseDemand, suggestionsFor } from './diagnostics';
import { GenerationParams, GenerationResultJson, PreviewLesson } from './generation.types';
import { BuiltProblem, ProblemBuilderService } from './problem-builder.service';
import { SolverClientService } from './solver-client.service';
import { SolverResult, UnplacedItem } from './solver.types';

/** Выполнение задания генерации (вызывается воркером очереди) */
@Injectable()
export class GenerationRunnerService {
  private readonly logger = new Logger(GenerationRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly builder: ProblemBuilderService,
    private readonly solver: SolverClientService,
    private readonly settings: SettingsService,
  ) {}

  private async update(jobId: string, data: Prisma.ScheduleGenerationJobUpdateInput) {
    await this.prisma.scheduleGenerationJob.update({ where: { id: jobId }, data });
  }

  async run(jobId: string): Promise<void> {
    const job = await this.prisma.scheduleGenerationJob.findUnique({
      where: { id: jobId },
      include: { schedulePeriod: true },
    });
    if (!job || job.status !== GenerationJobStatus.QUEUED) return;
    const params = job.paramsJson as unknown as GenerationParams;
    try {
      await this.update(jobId, {
        status: GenerationJobStatus.GENERATING,
        startedAt: new Date(),
        progress: 5,
        message: 'Подготовка данных: учебный план, нагрузка, календарный график',
      });
      const built = await this.builder.build(job.schedulePeriodId, job.schedulePeriod.organizationId, params);
      const required = built.problem.demands.reduce((a, d) => a + d.lessonsRequired, 0);
      await this.update(jobId, {
        progress: 15,
        message: `Генерация: ${required} пар, ${built.groupIds.length} групп(ы), ${built.problem.days.length} учебных дней`,
      });

      let lastUpdate = 0;
      const result = await this.solver.solve(built.problem, params.solver ?? 'auto', (fraction, message) => {
        const now = Date.now();
        if (now - lastUpdate < 1000) return;
        lastUpdate = now;
        void this.update(jobId, { progress: Math.round(15 + fraction * 70), message: `Генерация: ${message}` }).catch(
          () => undefined,
        );
      });

      await this.update(jobId, {
        status: GenerationJobStatus.VALIDATING,
        progress: 88,
        message: 'Проверка результата и анализ нераспределённых занятий',
      });
      const composed = await this.compose(built, result, params);
      if (result.fallbackReason) composed.warnings.unshift(result.fallbackReason);
      const hasProblems = composed.unplaced.length > 0;
      await this.update(jobId, {
        status: hasProblems ? GenerationJobStatus.COMPLETED_WITH_CONFLICTS : GenerationJobStatus.COMPLETED,
        progress: 100,
        solver: result.solver,
        finishedAt: new Date(),
        message: hasProblems
          ? `Готово с замечаниями: поставлено ${composed.stats.placedLessons} из ${composed.stats.requiredLessons} пар`
          : `Готово: поставлено ${composed.stats.placedLessons} пар`,
        resultJson: composed as unknown as Prisma.InputJsonValue,
        statsJson: composed.stats as unknown as Prisma.InputJsonValue,
      });
    } catch (e) {
      this.logger.error(`Ошибка генерации ${jobId}: ${(e as Error).stack}`);
      await this.update(jobId, {
        status: GenerationJobStatus.FAILED,
        finishedAt: new Date(),
        error: (e as Error).message,
        message: `Ошибка: ${(e as Error).message}`,
      }).catch(() => undefined);
    }
  }

  /** Результат для предпросмотра: занятия, нераспределённые пары с причинами, статистика */
  async compose(
    built: BuiltProblem,
    result: SolverResult,
    params: GenerationParams,
  ): Promise<GenerationResultJson> {
    const settings = built.settings;
    const h = settings.academicHoursPerLesson;
    const rooms = new Map(built.problem.rooms.map((r) => [r.id, r]));
    const demandById = new Map(built.problem.demands.map((d) => [d.id, d]));

    // Неполные пары: последняя по времени пара потока получает остаток часов
    const placementsByStream = new Map<string, number[]>();
    result.placements.forEach((p, idx) => {
      const meta = built.demandMeta[p.demandId];
      if (!meta) return;
      for (const s of meta.streams) {
        const list = placementsByStream.get(s.streamKey) ?? [];
        list.push(idx);
        placementsByStream.set(s.streamKey, list);
      }
    });
    const partialByPlacement = new Map<number, number[]>();
    for (const meta of Object.values(built.demandMeta)) {
      for (const s of meta.streams) {
        const list = placementsByStream.get(s.streamKey) ?? [];
        if (s.partialHours > 0 && list.length >= s.lessonsRequired && list.length > 0) {
          const sorted = [...list].sort((a, b) => {
            const pa = result.placements[a];
            const pb = result.placements[b];
            return pa.date.localeCompare(pb.date) || pa.lessonNumber - pb.lessonNumber;
          });
          const last = sorted[sorted.length - 1];
          const arr = partialByPlacement.get(last) ?? [];
          arr.push(s.partialHours);
          partialByPlacement.set(last, arr);
        }
      }
    }

    const lessons: PreviewLesson[] = [];
    result.placements.forEach((p, idx) => {
      const meta = built.demandMeta[p.demandId];
      const demand = demandById.get(p.demandId);
      if (!meta || !demand) return;
      const time = this.settings.lessonTime(settings, p.lessonNumber);
      const partial = partialByPlacement.get(idx);
      const academicHours =
        partial && partial.length === meta.streams.length && partial.every((x) => x === partial[0]) ? partial[0] : h;
      lessons.push({
        demandId: p.demandId,
        date: p.date,
        weekday: isoWeekday(p.date),
        lessonNumber: p.lessonNumber,
        startTime: time.startTime,
        endTime: time.endTime,
        groupIds: demand.groupIds,
        groupCodes: meta.groupCodes,
        assignmentIds: demand.groupIds.map((g) => meta.streams.find((s) => s.groupId === g)?.assignmentId ?? null),
        streamKey: meta.streams.length > 1 ? (meta.streams[0].streamGroupKey ?? null) : null,
        subgroupNumber: demand.subgroupNumber,
        semesterItemId: demand.semesterItemId,
        itemCode: meta.itemCode,
        itemName: meta.itemName,
        lessonType: meta.lessonType,
        teacherId: meta.teacherId,
        teacherName: meta.teacherName,
        roomId: p.roomId,
        roomCode: p.roomId ? (rooms.get(p.roomId)?.code ?? null) : null,
        academicHours,
      });
    });

    const unplaced: UnplacedItem[] = [...built.preUnplaced];
    for (const u of result.unplaced) {
      const meta = built.demandMeta[u.demandId];
      const demand = demandById.get(u.demandId);
      if (!meta || !demand || u.count <= 0) continue;
      const { reasons } = diagnoseDemand(built.problem, result, demand, u.count);
      const partial = meta.streams[0]?.partialHours ?? 0;
      unplaced.push({
        demandId: u.demandId,
        streamKeys: meta.streams.map((s) => s.streamKey),
        groupCodes: meta.groupCodes,
        subgroupNumber: meta.subgroupNumber,
        semesterItemId: demand.semesterItemId,
        disciplineName: meta.itemName,
        itemCode: meta.itemCode,
        lessonType: meta.lessonType,
        teacherId: meta.teacherId,
        teacherName: meta.teacherName,
        lessonsRequired: meta.lessonsRequired,
        lessonsUnplaced: u.count,
        hoursUnplaced: u.count * h - (partial > 0 ? h - partial : 0),
        reasons,
        suggestions: suggestionsFor(reasons.map((r) => r.code)),
      });
    }

    // Статистика по группам
    const groupStats = new Map<string, { groupId: string; groupCode: string; required: number; placed: number }>();
    for (const g of built.problem.groups) {
      groupStats.set(g.id, { groupId: g.id, groupCode: g.code, required: 0, placed: 0 });
    }
    for (const d of built.problem.demands) {
      for (const g of d.groupIds) {
        const s = groupStats.get(g);
        if (s) s.required += d.lessonsRequired;
      }
    }
    for (const u of built.preUnplaced) {
      for (const code of u.groupCodes) {
        const s = [...groupStats.values()].find((x) => x.groupCode === code);
        if (s) s.required += u.lessonsUnplaced;
      }
    }
    for (const l of lessons) {
      for (const g of l.groupIds) {
        const s = groupStats.get(g);
        if (s) s.placed++;
      }
    }

    const requiredLessons =
      built.problem.demands.reduce((a, d) => a + d.lessonsRequired, 0) +
      built.preUnplaced.reduce((a, u) => a + u.lessonsUnplaced, 0);
    const unplacedLessons = unplaced.reduce((a, u) => a + u.lessonsUnplaced, 0);
    const placedHours = lessons.reduce((a, l) => a + l.academicHours * l.groupIds.length, 0);
    const requiredHours = placedHours + unplaced.reduce((a, u) => a + u.hoursUnplaced * u.groupCodes.length, 0);

    return {
      period: { id: built.period.id, title: built.period.title },
      range: built.range,
      mode: params.mode,
      solver: result.solver,
      status: result.status,
      lessons,
      unplaced,
      replaceLessonIds: built.replaceLessonIds,
      stats: {
        requiredLessons,
        placedLessons: lessons.length,
        unplacedLessons,
        requiredHours,
        placedHours,
        groups: [...groupStats.values()],
        durationMs: result.stats.durationMs,
        weeks: result.stats.weeks,
        softViolations: this.softViolations(lessons, built),
      },
      warnings: [...built.warnings],
      log: result.log ?? [],
    };
  }

  /** Подсчёт нарушений мягких ограничений в результате */
  private softViolations(lessons: PreviewLesson[], built: BuiltProblem): Record<string, number> {
    const settings = built.problem.settings;
    const byGroupDay = new Map<string, Set<number>>();
    const byTeacherDay = new Map<string, Set<number>>();
    const buildings = new Map<string, Set<string>>();
    const rooms = new Map(built.problem.rooms.map((r) => [r.id, r]));
    let lateLessons = 0;
    for (const l of lessons) {
      if (l.lessonNumber >= settings.lateLessonNumber) lateLessons++;
      for (const g of l.groupIds) {
        const key = `${g}#${l.subgroupNumber ?? 0}#${l.date}`;
        const set = byGroupDay.get(key) ?? new Set<number>();
        set.add(l.lessonNumber);
        byGroupDay.set(key, set);
        const b = l.roomId ? rooms.get(l.roomId)?.building : null;
        if (b) {
          const bs = buildings.get(`${g}#${l.date}`) ?? new Set<string>();
          bs.add(b);
          buildings.set(`${g}#${l.date}`, bs);
        }
      }
      if (l.teacherId) {
        const key = `${l.teacherId}#${l.date}`;
        const set = byTeacherDay.get(key) ?? new Set<number>();
        set.add(l.lessonNumber);
        byTeacherDay.set(key, set);
      }
    }
    const windows = (map: Map<string, Set<number>>) => {
      let total = 0;
      for (const set of map.values()) {
        const arr = [...set];
        total += Math.max(...arr) - Math.min(...arr) + 1 - arr.length;
      }
      return total;
    };
    const maxPerDay = built.problem.groups[0]?.maxLessonsPerDay ?? 4;
    let overloadedDays = 0;
    for (const set of byGroupDay.values()) if (set.size > maxPerDay) overloadedDays++;
    let buildingChanges = 0;
    for (const set of buildings.values()) if (set.size > 1) buildingChanges += set.size - 1;
    return {
      groupWindows: windows(byGroupDay),
      teacherWindows: windows(byTeacherDay),
      lateLessons,
      overloadedDays,
      buildingChanges,
    };
  }
}
