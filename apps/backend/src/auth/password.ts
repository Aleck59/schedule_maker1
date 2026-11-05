import * as bcrypt from 'bcryptjs';
import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { PasswordReply, PasswordTask } from './password-worker';

const WORKER_FILE = join(__dirname, 'password-worker.js');
const SIZE = Math.max(1, Number(process.env.PASSWORD_WORKERS ?? availableParallelism() - 1));

type NewTask = PasswordTask extends infer T ? (T extends PasswordTask ? Omit<T, 'id'> : never) : never;
type Pending = { resolve: (v: boolean | string) => void; reject: (e: Error) => void };
type Slot = { worker: Worker; busy: number };

/**
 * Пул потоков для bcrypt: проверка и хеширование паролей не занимают основной поток API,
 * и несколько входов считаются параллельно (по потоку на ядро, кроме одного — для запросов).
 * Без собранного файла потока (юнит-тесты из исходников .ts) — расчёт в текущем потоке.
 */
class PasswordPool {
  private slots: Slot[] = [];
  private pending = new Map<number, Pending>();
  private seq = 0;

  private start(): Slot {
    const worker = new Worker(WORKER_FILE);
    const slot: Slot = { worker, busy: 0 };
    worker.unref();
    worker.on('message', (msg: PasswordReply) => {
      slot.busy--;
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (!p) return;
      if (msg.ok) p.resolve(msg.value);
      else p.reject(new Error(msg.error));
    });
    worker.on('error', (e) => {
      // Поток упал: его задачи отклоняются, следующий запрос создаст новый поток
      this.slots = this.slots.filter((s) => s !== slot);
      for (const [id, p] of this.pending) {
        this.pending.delete(id);
        p.reject(e);
      }
    });
    this.slots.push(slot);
    return slot;
  }

  run(task: NewTask): Promise<boolean | string> {
    const free = this.slots.find((s) => s.busy === 0);
    const slot =
      free ??
      (this.slots.length < SIZE ? this.start() : this.slots.reduce((a, b) => (a.busy <= b.busy ? a : b)));
    const id = ++this.seq;
    slot.busy++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      slot.worker.postMessage({ ...task, id } as PasswordTask);
    });
  }
}

const pool = existsSync(WORKER_FILE) && process.env.PASSWORD_WORKERS !== '0' ? new PasswordPool() : null;

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!pool) return bcrypt.compare(password, hash);
  return (await pool.run({ op: 'compare', password, hash })) as boolean;
}

export async function hashPassword(password: string, rounds = 10): Promise<string> {
  if (!pool) return bcrypt.hash(password, rounds);
  return (await pool.run({ op: 'hash', password, rounds })) as string;
}
