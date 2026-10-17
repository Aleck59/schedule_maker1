import { Injectable, Logger } from '@nestjs/common';
import { loadConfig } from '../config/configuration';
import { EngineService } from '../engine/engine.service';
import { solveHeuristic } from './heuristic-solver';
import { describeQuality, qualityOf } from './quality';
import { SolverProblem, SolverResult } from './solver.types';

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
  ): Promise<SolverResult & { fallbackReason?: string }> {
    const mode = preference === 'auto' ? this.config.mode : preference;
    if (mode !== 'heuristic') {
      // Быстрое эвристическое решение: стартовая точка для CP-SAT и запасной вариант
      const quick = solveHeuristic(problem);
      try {
        onProgress?.(0.05, 'Решение модели CP-SAT');
        const timeoutMs = Math.min(this.config.timeoutMs, (problem.timeLimitSeconds + 120) * 1000);
        const exact = await this.engine.run<SolverResult>(['solve'], {
          input: JSON.stringify({ ...problem, hints: quick.placements }),
          timeoutMs,
          onProgress: (fraction, message) => onProgress?.(0.05 + fraction * 0.95, message),
        });
        // Доработка решения CP-SAT: недопоставленные пары по оставшимся неделям и доводка окон
        onProgress?.(0.97, 'Доводка расписания: окна и недопоставленные пары');
        const polished = solveHeuristic(problem, { initial: exact.placements });
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
    return solveHeuristic(problem, { onProgress });
  }
}
