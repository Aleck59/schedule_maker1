import { parentPort, workerData } from 'node:worker_threads';
import { HeuristicOptions, solveHeuristic } from './heuristic-solver';
import { SolverProblem } from './solver.types';

/**
 * Поток (worker thread) эвристического генератора. Алгоритм синхронный и на больших данных
 * считает десятки секунд — в основном потоке API он блокировал бы все запросы интерфейса.
 */
export type HeuristicWorkerMessage =
  | { type: 'progress'; fraction: number; message: string }
  | { type: 'result'; result: ReturnType<typeof solveHeuristic> }
  | { type: 'error'; message: string; stack?: string };

if (parentPort) {
  const port = parentPort;
  const { problem, options } = workerData as {
    problem: SolverProblem;
    options: Omit<HeuristicOptions, 'onProgress'>;
  };
  try {
    const result = solveHeuristic(problem, {
      ...options,
      onProgress: (fraction, message) => port.postMessage({ type: 'progress', fraction, message }),
    });
    port.postMessage({ type: 'result', result } satisfies HeuristicWorkerMessage);
  } catch (e) {
    const err = e as Error;
    port.postMessage({
      type: 'error',
      message: err.message,
      stack: err.stack,
    } satisfies HeuristicWorkerMessage);
  }
}
