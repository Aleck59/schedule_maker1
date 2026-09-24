/* eslint-disable */
// Подготовка тестовой БД для e2e: применение миграций и заполнение демо-данными.
// Защита от случайной очистки рабочей базы: имя БД должно содержать «test» (или запуск в CI).
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const envFile = path.resolve(__dirname, '..', '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envFile) && process.loadEnvFile) process.loadEnvFile(envFile);
const url = process.env.DATABASE_URL || '';
if (!/test/i.test(url) && process.env.CI !== 'true') {
  console.error('E2E-тесты очищают базу данных. Укажите тестовую БД (имя должно содержать «test»), например:');
  console.error('  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/schedule_test npm run test:e2e');
  process.exit(1);
}
const opts = { stdio: 'inherit', cwd: path.resolve(__dirname, '..'), env: { ...process.env, QUEUE_MODE: 'inline' } };
execSync('npx prisma migrate deploy', opts);
execSync('node dist/seed/seed.js --reset', opts);
