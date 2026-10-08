import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { loadConfig } from '../config/configuration';

export interface EngineInfo {
  available: boolean;
  version?: string;
  python?: string;
  ortools?: string | null;
  ocr?: { ready: boolean; version: string | null; languages: string[]; error: string | null };
  error?: string;
}

export interface EngineRunOptions {
  /** Данные для stdin (JSON задачи) */
  input?: string;
  timeoutMs: number;
  /** Ход выполнения из строк «PROGRESS {...}» в stderr */
  onProgress?: (fraction: number, message: string) => void;
}

/**
 * Вычислительный модуль на Python (apps/solver): решатель OR-Tools CP-SAT и распознавание
 * сканов учебных планов. Запускается подпроцессом `python -m app <команда>` в том же
 * контейнере, что и API, — отдельный сервис не нужен.
 */
@Injectable()
export class EngineService {
  private readonly logger = new Logger(EngineService.name);
  private readonly config = loadConfig().engine;
  private infoCache: { at: number; value: EngineInfo } | null = null;

  async info(force = false): Promise<EngineInfo> {
    if (!force && this.infoCache && Date.now() - this.infoCache.at < 60_000) return this.infoCache.value;
    let value: EngineInfo;
    try {
      const raw = await this.run<Omit<EngineInfo, 'available'>>(['info'], { timeoutMs: 30_000 });
      value = { available: true, ...raw };
    } catch (e) {
      value = { available: false, error: (e as Error).message };
    }
    this.infoCache = { at: Date.now(), value };
    return value;
  }

  run<T>(args: string[], options: EngineRunOptions): Promise<T> {
    const { python, dir } = this.config;
    return new Promise<T>((resolve, reject) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(python, ['-m', 'app', ...args], {
          cwd: dir,
          env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (e) {
        reject(new Error(`Не удалось запустить Python (${python}): ${(e as Error).message}`));
        return;
      }
      const stdout: Buffer[] = [];
      let stderrTail = '';
      let lastError: string | null = null;
      let buffered = '';
      let finished = false;
      const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        child.kill('SIGKILL');
        reject(new Error(`Превышено время выполнения (${Math.round(options.timeoutMs / 1000)} с)`));
      }, options.timeoutMs);

      child.stdout!.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr!.on('data', (chunk: Buffer) => {
        buffered += chunk.toString('utf8');
        const lines = buffered.split('\n');
        buffered = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('PROGRESS ')) {
            try {
              const p = JSON.parse(line.slice(9)) as { fraction: number; message: string };
              options.onProgress?.(p.fraction, p.message);
            } catch {
              /* строка прогресса повреждена — пропускаем */
            }
          } else if (line.startsWith('ERROR ')) {
            lastError = line.slice(6).trim();
          } else if (line.trim()) {
            this.logger.debug(line);
            stderrTail = (stderrTail + '\n' + line).slice(-2000);
          }
        }
      });
      child.on('error', (e) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        reject(new Error(`Не удалось запустить Python (${python}): ${e.message}`));
      });
      child.on('close', (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (code !== 0) {
          const tail = stderrTail.trim().split('\n').slice(-3).join(' ');
          reject(new Error(lastError ?? (tail || `процесс завершился с кодом ${code}`)));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(stdout).toString('utf8')) as T);
        } catch {
          reject(new Error('Вычислительный модуль вернул некорректный ответ'));
        }
      });
      child.stdin!.on('error', () => {
        /* процесс завершился раньше, чем прочитал вход — ошибка придёт в close */
      });
      child.stdin!.end(options.input ?? '');
    });
  }
}
