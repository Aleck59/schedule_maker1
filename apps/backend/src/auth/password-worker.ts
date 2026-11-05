import * as bcrypt from 'bcryptjs';
import { parentPort } from 'node:worker_threads';

/**
 * Поток проверки паролей. bcryptjs написан на JavaScript: одна проверка — ~85 мс процессора,
 * и в основном потоке API на это время замирали все запросы (при массовом входе — минутами).
 */
export type PasswordTask =
  | { id: number; op: 'compare'; password: string; hash: string }
  | { id: number; op: 'hash'; password: string; rounds: number };
export type PasswordReply =
  { id: number; ok: true; value: boolean | string } | { id: number; ok: false; error: string };

if (parentPort) {
  const port = parentPort;
  port.on('message', (task: PasswordTask) => {
    const run =
      task.op === 'compare'
        ? bcrypt.compare(task.password, task.hash)
        : bcrypt.hash(task.password, task.rounds);
    run.then(
      (value) => port.postMessage({ id: task.id, ok: true, value } satisfies PasswordReply),
      (e: Error) => port.postMessage({ id: task.id, ok: false, error: e.message } satisfies PasswordReply),
    );
  });
}
