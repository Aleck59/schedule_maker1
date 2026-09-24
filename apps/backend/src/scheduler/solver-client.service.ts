import { Injectable, Logger } from '@nestjs/common';
import { loadConfig } from '../config/configuration';
import { solveHeuristic } from './heuristic-solver';
import { SolverProblem, SolverResult } from './solver.types';

export type SolverPreference = 'auto' | 'cp-sat' | 'heuristic';

/**
 * Выбор решателя: сервис OR-Tools CP-SAT (Python/FastAPI) — предпочтительно;
 * при недоступности (режим auto) — встроенный эвристический алгоритм.
 */
@Injectable()
export class SolverClientService {
  private readonly logger = new Logger(SolverClientService.name);
  private readonly config = loadConfig().solver;

  async status(): Promise<{
    mode: string;
    url: string | null;
    cpSatAvailable: boolean;
    version?: string;
    error?: string;
  }> {
    if (!this.config.url) {
      return { mode: this.config.mode, url: null, cpSatAvailable: false, error: 'SOLVER_URL не задан' };
    }
    try {
      const res = await fetch(`${this.config.url}/health`, { signal: AbortSignal.timeout(3000) });
      const body = (await res.json()) as { status?: string; ortools?: string };
      return { mode: this.config.mode, url: this.config.url, cpSatAvailable: res.ok, version: body.ortools };
    } catch (e) {
      return {
        mode: this.config.mode,
        url: this.config.url,
        cpSatAvailable: false,
        error: (e as Error).message,
      };
    }
  }

  async solve(
    problem: SolverProblem,
    preference: SolverPreference = 'auto',
    onProgress?: (fraction: number, message: string) => void,
  ): Promise<SolverResult & { fallbackReason?: string }> {
    const mode = preference === 'auto' ? this.config.mode : preference;
    if (mode !== 'heuristic') {
      if (!this.config.url) {
        if (mode === 'cp-sat') {
          throw new Error('Сервис OR-Tools CP-SAT не настроен (переменная SOLVER_URL)');
        }
      } else {
        try {
          onProgress?.(0.05, 'Решение модели CP-SAT');
          return await this.solveRemote(problem);
        } catch (e) {
          const message = (e as Error).message;
          if (mode === 'cp-sat') {
            throw new Error(`Сервис OR-Tools CP-SAT недоступен: ${message}`, { cause: e });
          }
          this.logger.warn(`CP-SAT недоступен (${message}), используется эвристический генератор`);
          const result = solveHeuristic(problem, { onProgress });
          return { ...result, fallbackReason: `CP-SAT недоступен: ${message}` };
        }
      }
    }
    return solveHeuristic(problem, { onProgress });
  }

  private async solveRemote(problem: SolverProblem): Promise<SolverResult> {
    const timeoutMs = Math.min(this.config.timeoutMs, (problem.timeLimitSeconds + 120) * 1000);
    const res = await fetch(`${this.config.url}/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(problem),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return (await res.json()) as SolverResult;
  }
}
