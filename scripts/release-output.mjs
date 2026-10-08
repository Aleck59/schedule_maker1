#!/usr/bin/env node
// Передача результата semantic-release следующим заданиям GitHub Actions
// (сборка и публикация Docker-образов выполняется только при выпуске новой версии).
import { appendFileSync } from 'node:fs';

const version = process.argv[2];
const output = process.env.GITHUB_OUTPUT;
if (output) {
  appendFileSync(output, `published=true\nversion=${version}\n`);
}
console.log(`Выпущена версия ${version}`);
