import { existsSync } from 'fs';
import { join, resolve } from 'path';

/** Конфигурация приложения из переменных окружения */
export interface AppConfig {
  port: number;
  corsOrigin: string[];
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: string;
    refreshTtl: string;
  };
  redisUrl: string | null;
  /** Вычислительный модуль на Python (решатель CP-SAT, распознавание сканов) */
  engine: {
    python: string;
    dir: string;
  };
  solver: {
    /** auto — CP-SAT, если доступен, иначе эвристика; cp-sat — только CP-SAT; heuristic — только эвристика */
    mode: 'auto' | 'cp-sat' | 'heuristic';
    timeoutMs: number;
  };
}

export function loadConfig(): AppConfig {
  const mode = (process.env.SOLVER_MODE ?? 'auto') as AppConfig['solver']['mode'];
  return {
    port: Number(process.env.PORT ?? 3000),
    corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    jwt: {
      accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
      refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret',
      accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
      refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
    },
    redisUrl: process.env.REDIS_URL?.trim() || null,
    engine: resolveEngine(),
    solver: {
      mode: ['auto', 'cp-sat', 'heuristic'].includes(mode) ? mode : 'auto',
      timeoutMs: Number(process.env.SOLVER_TIMEOUT_MS ?? 15 * 60 * 1000),
    },
  };
}

/** Каталог Python-модуля и интерпретатор: переменные ENGINE_DIR и PYTHON_BIN или поиск рядом с API */
function resolveEngine(): AppConfig['engine'] {
  const candidates = [
    process.env.ENGINE_DIR,
    resolve(process.cwd(), '../solver'),
    resolve(process.cwd(), 'apps/solver'),
    resolve(__dirname, '../../../solver'),
    '/app/engine',
  ].filter((d): d is string => Boolean(d));
  const dir = candidates.find((d) => existsSync(join(d, 'app', '__main__.py'))) ?? candidates[0];
  const venv = join(dir, '.venv', 'bin', 'python');
  const python = process.env.PYTHON_BIN?.trim() || (existsSync(venv) ? venv : 'python3');
  return { python, dir };
}

/** Значения-заглушки из репозитория: с ними любой может подписать себе токен администратора */
const PLACEHOLDER_SECRET = /^(dev-|change-me)/i;
const MIN_SECRET_LENGTH = 32;

/**
 * В продакшене (NODE_ENV=production) сервер не запускается без собственных секретов JWT:
 * они должны быть заданы, не совпадать с заглушками из репозитория, быть не короче 32 символов
 * и различаться между собой. Возвращает список проблем (пустой — всё в порядке).
 */
export function jwtSecretProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  for (const name of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    const value = env[name]?.trim();
    if (!value) problems.push(`${name} не задан`);
    else if (PLACEHOLDER_SECRET.test(value)) problems.push(`${name} — заглушка из репозитория`);
    else if (value.length < MIN_SECRET_LENGTH) problems.push(`${name} короче ${MIN_SECRET_LENGTH} символов`);
  }
  const access = env.JWT_ACCESS_SECRET?.trim();
  if (access && access === env.JWT_REFRESH_SECRET?.trim()) {
    problems.push('JWT_ACCESS_SECRET и JWT_REFRESH_SECRET совпадают');
  }
  return problems;
}

export function assertProductionSecrets(env: NodeJS.ProcessEnv = process.env): void {
  const problems = jwtSecretProblems(env);
  if (problems.length === 0) return;
  throw new Error(
    `Небезопасные секреты JWT: ${problems.join('; ')}. ` +
      'Задайте в .env две разные случайные строки, например командой `openssl rand -hex 32`, и перезапустите сервер.',
  );
}
