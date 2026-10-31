import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { HeuristicOptions, solveHeuristic } from './heuristic-solver';
import type { HeuristicWorkerMessage } from './heuristic-worker';
import { SolverProblem, SolverResult } from './solver.types';

const WORKER_FILE = join(__dirname, 'heuristic-worker.js');

/**
 * Эвристический генератор в отдельном потоке, чтобы API продолжал отвечать во время генерации.
 * Без собранного файла потока (запуск из исходников .ts, юнит-тесты) — расчёт в текущем потоке.
 */
export function solveHeuristicInThread(
  problem: SolverProblem,
  options: HeuristicOptions = {},
): Promise<SolverResult> {
  const { onProgress, ...rest } = options;
  if (!existsSync(WORKER_FILE)) {
    return new Promise((resolve, reject) =>
      setImmediate(() => {
        try {
          resolve(solveHeuristic(problem, options));
        } catch (e) {
          reject(e as Error);
        }
      }),
    );
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(WORKER_FILE, { workerData: { problem, options: rest } });
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
      void worker.terminate();
    };
    worker.on('message', (msg: HeuristicWorkerMessage) => {
      if (msg.type === 'progress') onProgress?.(msg.fraction, msg.message);
      else if (msg.type === 'result') finish(() => resolve(msg.result));
      else {
        const err = new Error(msg.message);
        if (msg.stack) err.stack = msg.stack;
        finish(() => reject(err));
      }
    });
    worker.on('error', (err) => finish(() => reject(err)));
    worker.on('exit', (code) =>
      finish(() => reject(new Error(`Поток эвристического генератора завершился с кодом ${code}`))),
    );
  });
}
