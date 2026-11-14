import { Injectable, Logger } from '@nestjs/common';
import { loadConfig } from '../config/configuration';
import { EngineService } from '../engine/engine.service';
import { solveHeuristicInThread } from './heuristic-thread';
import { rebalanceRooms } from './room-balance';
import { describeQuality, qualityOf } from './quality';
import { SolverPlacement, SolverProblem, SolverResult } from './solver.types';

export type SolverPreference = 'auto' | 'cp-sat' | 'heuristic';

/**
 * Выбор решателя: OR-Tools CP-SAT (Python-модуль, запускается подпроцессом) — предпочтительно;
 * при недоступности (режим auto) — встроенный эвристический алгоритм.
 */
@Injectable()
export class SolverClientService {
  private readonly logger = new Logger(SolverClientService.name);
  private readonly config = loadConfig().solver;

  constructor(private readonly engine: EngineService) {}

  async status(): Promise<{
    mode: string;
    cpSatAvailable: boolean;
    version?: string;
    ocrAvailable: boolean;
    error?: string;
  }> {
    const info = await this.engine.info();
    return {
      mode: this.config.mode,
      cpSatAvailable: info.available && Boolean(info.ortools),
      version: info.ortools ?? undefined,
      ocrAvailable: Boolean(info.ocr?.ready),
      error: info.error ?? (info.available && !info.ortools ? 'OR-Tools не установлен' : undefined),
    };
  }

  async solve(
    problem: SolverProblem,
    preference: SolverPreference = 'auto',
    onProgress?: (fraction: number, message: string) => void,
    initial?: SolverPlacement[],
  ): Promise<SolverResult & { fallbackReason?: string }> {
    const mode = preference === 'auto' ? this.config.mode : preference;
    if (initial) return this.improve(problem, mode, initial, onProgress);
    if (mode !== 'heuristic') {
      // Быстрое эвристическое решение: стартовая точка для CP-SAT и запасной вариант
      const quick = await solveHeuristicInThread(problem);
      try {
        onProgress?.(0.05, 'Решение модели CP-SAT');
        const timeoutMs = Math.min(this.config.timeoutMs, (problem.timeLimitSeconds + 120) * 1000);
        const raw = await this.engine.run<SolverResult>(['solve'], {
          input: JSON.stringify({ ...problem, hints: quick.placements }),
          timeoutMs,
          onProgress: (fraction, message) => onProgress?.(0.05 + fraction * 0.95, message),
        });
        // Аудитории решения CP-SAT — с учётом меток и равномерной загрузки (время пар не меняется)
        const exact: SolverResult = {
          ...raw,
          placements: rebalanceRooms(problem, raw.placements).placements,
        };
        // Доработка решения CP-SAT: недопоставленные пары по оставшимся неделям и доводка окон
        onProgress?.(0.97, 'Доводка расписания: окна и недопоставленные пары');
        const polished = await solveHeuristicInThread(problem, { initial: exact.placements });
        const refined: SolverResult = {
          ...polished,
          solver: exact.solver,
          stats: {
            ...polished.stats,
            durationMs: exact.stats.durationMs + polished.stats.durationMs,
            objective: exact.stats.objective,
          },
          log: [...exact.log, ...polished.log],
        };
        // Выбирается лучший вариант по числу пар и мягким ограничениям — и в режиме CP-SAT:
        // при нехватке времени он может поставить меньше, чем быстрая эвристика
        const options = [
          { result: refined, q: qualityOf(problem, refined), name: 'CP-SAT с доводкой' },
          { result: exact, q: qualityOf(problem, exact), name: 'CP-SAT' },
          { result: quick, q: qualityOf(problem, quick), name: 'эвристика' },
        ];
        const best = options.reduce((a, b) => (b.q.score > a.q.score ? b : a));
        const others = options.filter((o) => o !== best).map((o) => `${o.name} — ${describeQuality(o.q)}`);
        return {
          ...best.result,
          log: [
            ...best.result.log,
            `Выбран вариант «${best.name}»: ${describeQuality(best.q)}; ${others.join('; ')}`,
          ],
        };
      } catch (e) {
        const message = (e as Error).message;
        if (mode === 'cp-sat') {
          throw new Error(`Решатель OR-Tools CP-SAT недоступен: ${message}`, { cause: e });
        }
        this.logger.warn(`CP-SAT недоступен (${message}), используется эвристический генератор`);
        return { ...quick, fallbackReason: `CP-SAT недоступен: ${message}` };
      }
    }
    return solveHeuristicInThread(problem, { onProgress });
  }

  /**
   * Улучшение текущего расписания: занятия остаются на местах, если не нарушают ограничений, —
   * нарушившие и недостающие пары ставятся заново, затем сокращаются окна. Перестроить всё с нуля
   * может только явно выбранный CP-SAT (стартуя с улучшенного варианта); берётся лучший результат.
   */
  private async improve(
    problem: SolverProblem,
    mode: string,
    initial: SolverPlacement[],
    onProgress?: (fraction: number, message: string) => void,
  ): Promise<SolverResult & { fallbackReason?: string }> {
    onProgress?.(0.05, 'Проверка текущего расписания и доработка');
    const refined = await solveHeuristicInThread(problem, {
      initial,
      onProgress: (fraction, message) =>
        onProgress?.(0.05 + fraction * (mode === 'cp-sat' ? 0.3 : 0.9), message),
    });
    const start = qualityOf(problem, { ...refined, placements: initial });
    const log = [
      `Текущее расписание: ${describeQuality(start)}`,
      ...refined.log,
      `После улучшения: ${describeQuality(qualityOf(problem, refined))}`,
    ];
    if (mode !== 'cp-sat') return { ...refined, log };
    try {
      onProgress?.(0.4, 'Решение модели CP-SAT с текущим расписанием как подсказкой');
      const timeoutMs = Math.min(this.config.timeoutMs, (problem.timeLimitSeconds + 120) * 1000);
      const raw = await this.engine.run<SolverResult>(['solve'], {
        input: JSON.stringify({ ...problem, hints: refined.placements }),
        timeoutMs,
        onProgress: (fraction, message) => onProgress?.(0.4 + fraction * 0.55, message),
      });
      const exact: SolverResult = { ...raw, placements: rebalanceRooms(problem, raw.placements).placements };
      const a = qualityOf(problem, refined);
      const b = qualityOf(problem, exact);
      return b.score > a.score
        ? { ...exact, log: [...log, ...exact.log, `Выбран вариант CP-SAT: ${describeQuality(b)}`] }
        : {
            ...refined,
            log: [...log, `CP-SAT не лучше (${describeQuality(b)}) — оставлено улучшенное текущее`],
          };
    } catch (e) {
      throw new Error(`Решатель OR-Tools CP-SAT недоступен: ${(e as Error).message}`, { cause: e });
    }
  }

  /**
   * Постоянное расписание (типовая неделя): CP-SAT решает неделю целиком — с парами через неделю
   * (числитель/знаменатель); быстрая эвристика даёт ему стартовую точку и служит запасным вариантом.
   * Возвращается лучший из двух вариантов.
   */
  async solveTemplate(
    problem: SolverProblem,
    preference: SolverPreference = 'auto',
    onProgress?: (fraction: number, message: string) => void,
  ): Promise<SolverResult & { fallbackReason?: string }> {
    const mode = preference === 'auto' ? this.config.mode : preference;
    const quick = await solveHeuristicInThread(problem, {
      templateOnly: true,
      onProgress: (fraction, message) => onProgress?.(fraction * (mode === 'heuristic' ? 1 : 0.2), message),
    });
    if (mode === 'heuristic') return quick;
    try {
      onProgress?.(0.2, 'Решение модели CP-SAT: типовая неделя');
      const timeoutMs = Math.min(this.config.timeoutMs, (problem.timeLimitSeconds + 120) * 1000);
      const raw = await this.engine.run<SolverResult>(['solve'], {
        input: JSON.stringify({ ...problem, templateOnly: true, hints: quick.placements }),
        timeoutMs,
        onProgress: (fraction, message) => onProgress?.(0.2 + fraction * 0.75, message),
      });
      const placements = raw.placements.map(({ parity, ...p }) => ({ ...p, ...(parity ? { parity } : {}) }));
      const balanced = rebalanceRooms(problem, placements);
      const exact: SolverResult = {
        ...raw,
        placements: balanced.placements,
        log: [
          ...raw.log,
          ...(balanced.changed > 0
            ? [`Аудитории: ${balanced.changed} пар перенесены в другие аудитории для равномерной загрузки`]
            : []),
        ],
      };
      const options = [
        { result: exact, q: qualityOf(problem, exact), name: 'CP-SAT' },
        { result: quick, q: qualityOf(problem, quick), name: 'эвристика' },
      ];
      // При равном качестве — CP-SAT
      const best = options[1].q.score > options[0].q.score ? options[1] : options[0];
      const other = options.find((o) => o !== best)!;
      return {
        ...best.result,
        log: [
          ...best.result.log,
          `Выбран вариант «${best.name}»: ${describeQuality(best.q)}; ${other.name} — ${describeQuality(other.q)}`,
        ],
      };
    } catch (e) {
      const message = (e as Error).message;
      if (mode === 'cp-sat') {
        throw new Error(`Решатель OR-Tools CP-SAT недоступен: ${message}`, { cause: e });
      }
      this.logger.warn(`CP-SAT недоступен (${message}), постоянное расписание составлено эвристикой`);
      return { ...quick, fallbackReason: `CP-SAT недоступен: ${message}` };
    }
  }
}
