#!/usr/bin/env node
// Установка версии релиза во всех частях монорепозитория:
// package.json (корень, backend, frontend), package-lock.json и сервис решателя.
// Вызывается semantic-release на шаге prepare: node scripts/set-version.mjs 1.2.3
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
  console.error('Укажите версию в формате SemVer, например: node scripts/set-version.mjs 1.2.3');
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packages = ['.', 'apps/backend', 'apps/frontend'];

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, data) => writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);

for (const dir of packages) {
  const file = resolve(root, dir, 'package.json');
  const pkg = readJson(file);
  pkg.version = version;
  writeJson(file, pkg);
}

const lockFile = resolve(root, 'package-lock.json');
const lock = readJson(lockFile);
lock.version = version;
for (const dir of packages) {
  const key = dir === '.' ? '' : dir;
  if (lock.packages?.[key]) lock.packages[key].version = version;
}
writeJson(lockFile, lock);

const solverInit = resolve(root, 'apps/solver/app/__init__.py');
const source = readFileSync(solverInit, 'utf8');
writeFileSync(solverInit, source.replace(/__version__ = "[^"]*"/, `__version__ = "${version}"`));

console.log(`Версия ${version} установлена: ${packages.length} package.json, package-lock.json, apps/solver`);
