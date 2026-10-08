import { Injectable, Logger } from '@nestjs/common';
import { loadConfig } from '../config/configuration';
import { EngineService } from '../engine/engine.service';
import { solveHeuristic } from './heuristic-solver';
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
      try {
        onProgress?.(0.05, 'Решение модели CP-SAT');
        const timeoutMs = Math.min(this.config.timeoutMs, (problem.timeLimitSeconds + 120) * 1000);
        return await this.engine.run<SolverResult>(['solve'], { input: JSON.stringify(problem), timeoutMs });
      } catch (e) {
        const message = (e as Error).message;
        if (mode === 'cp-sat') {
          throw new Error(`Решатель OR-Tools CP-SAT недоступен: ${message}`, { cause: e });
        }
        this.logger.warn(`CP-SAT недоступен (${message}), используется эвристический генератор`);
        const result = solveHeuristic(problem, { onProgress });
        return { ...result, fallbackReason: `CP-SAT недоступен: ${message}` };
      }
    }
    return solveHeuristic(problem, { onProgress });
  }
}
