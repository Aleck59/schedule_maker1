import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Версия приложения (SemVer). Релизный Docker-образ передаёт её в APP_VERSION;
 * если там не номер версии (локальный запуск, сборка CI по коммиту), берётся версия
 * из package.json бэкенда — её выставляет semantic-release при каждом релизе.
 */
export function appVersion(): string {
  const env = process.env.APP_VERSION ?? '';
  if (/^\d+\.\d+\.\d+/.test(env)) return env;
  return packageVersion() ?? (env || 'dev');
}

let cached: string | null | undefined;

function packageVersion(): string | null {
  if (cached !== undefined) return cached;
  cached = null;
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const file = join(dir, 'package.json');
    if (existsSync(file)) {
      try {
        const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version?: string };
        if (pkg.name === '@schedule-maker/backend' && pkg.version) {
          cached = pkg.version;
          break;
        }
      } catch {
        // повреждённый package.json — ищем выше
      }
    }
    dir = dirname(dir);
  }
  return cached;
}
