import { existsSync } from 'fs';
import { resolve } from 'path';

/** Загрузка переменных из .env (для локальной разработки); переменные окружения имеют приоритет */
const file = resolve(process.cwd(), '.env');
if (existsSync(file) && typeof process.loadEnvFile === 'function') {
  const before = { ...process.env };
  process.loadEnvFile(file);
  for (const [key, value] of Object.entries(before)) {
    if (value !== undefined) process.env[key] = value;
  }
}
