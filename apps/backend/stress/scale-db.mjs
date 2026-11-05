#!/usr/bin/env node
/**
 * Синтетическая «большая» база для нагрузочного теста: N копий исходной базы в одной организации.
 *
 *   node stress/scale-db.mjs --source postgresql://…/schedule --target postgresql://…/schedule_big \
 *     --copies 10 --specialty-variants 2 --teachers 1700 --students 10000
 *
 * Как это работает:
 *  - схема и данные берутся через pg_dump; целевая база пересоздаётся (--target должен быть пустой
 *    или тестовой базой: скрипт её очищает);
 *  - общие таблицы (организация, настройки, звонки, праздники, формы отчётов) копируются один раз,
 *    служебные (аудит, уведомления, задания генерации, сканы планов) не копируются;
 *  - остальные строки повторяются --copies раз с новыми UUID (детерминированно из старого id
 *    и номера копии), поэтому связи внутри копии сохраняются;
 *  - специальности повторяются --specialty-variants раз (копии чередуют варианты);
 *  - коды групп и аудиторий получают суффикс «-2», «-3»…;
 *  - преподаватели обезличиваются («Преподаватель 0001») и делятся до --teachers: нагрузка и пары
 *    распределяются между «половинками» по назначению или потоку;
 *  - создаются --students записей студентов («Студент 00001») по группам.
 * Пользователи, кроме администраторов, не копируются — нагрузочные создаёт prepare-users.js.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const SOURCE = opt('source');
const TARGET = opt('target');
const COPIES = Number(opt('copies', 10));
const SPEC_VARIANTS = Number(opt('specialty-variants', 1));
const TEACHERS = Number(opt('teachers', 0));
const STUDENTS = Number(opt('students', 0));
if (!SOURCE || !TARGET) {
  console.error('Укажите --source и --target (строки подключения PostgreSQL)');
  process.exit(1);
}
if (SOURCE === TARGET) throw new Error('--source и --target совпадают');

const SHARED = new Set([
  '_prisma_migrations',
  'organizations',
  'organization_settings',
  'users',
  'lesson_times',
  'holidays',
  'holiday_transfers',
  'report_forms',
]);
const SKIP = new Set([
  'audit_logs',
  'notifications',
  'schedule_generation_jobs',
  'curriculum_scans',
  'validation_results',
]);
const ROOTS = new Set(['specialties', 'teachers', 'classrooms', 'educational_programs', 'student_groups']);
const SUFFIX = { student_groups: 'code', classrooms: 'code' };
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

const psql = (url, sql) =>
  execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qAt', '-c', sql], {
    encoding: 'utf8',
    maxBuffer: 2 ** 30,
  });
const newId = (id, c) => {
  const h = createHash('md5').update(`${c}:${id}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

// ── 1. Схема
const t0 = Date.now();
const dbName = new URL(TARGET).pathname.slice(1);
const admin = TARGET.replace(/\/[^/?]+(\?|$)/, '/postgres$1');
psql(admin, `DROP DATABASE IF EXISTS "${dbName}"`);
psql(admin, `CREATE DATABASE "${dbName}"`);
const schema = execFileSync('pg_dump', ['--schema-only', '--no-owner', '--no-privileges', SOURCE], {
  encoding: 'utf8',
  maxBuffer: 2 ** 30,
});
const schemaRun = spawnSync('psql', [TARGET, '-q', '-v', 'ON_ERROR_STOP=1'], {
  input: schema,
  encoding: 'utf8',
});
if (schemaRun.status !== 0) throw new Error(schemaRun.stderr);

// ── 2. Данные: разбор COPY-блоков pg_dump
const dump = execFileSync('pg_dump', ['--data-only', '--no-owner', SOURCE], {
  encoding: 'utf8',
  maxBuffer: 2 ** 30,
});
const tables = []; // { name, header, cols, rows: string[][] }
{
  const lines = dump.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^COPY public\.("?)([a-z_]+)\1 \((.*)\) FROM stdin;$/.exec(lines[i]);
    if (!m) continue;
    const t = {
      name: m[2],
      header: lines[i],
      cols: m[3].split(', ').map((c) => c.replace(/"/g, '')),
      rows: [],
    };
    for (i++; lines[i] !== '\\.'; i++) t.rows.push(lines[i].split('\t'));
    tables.push(t);
  }
}

// Какие строки копировать: корневые таблицы целиком, остальные — если ссылаются на копируемую строку
const cloned = new Set();
const idCol = (t) => t.cols.indexOf('id');
for (const t of tables) if (ROOTS.has(t.name)) for (const r of t.rows) cloned.add(r[idCol(t)]);
const specialtyIds = new Set(tables.find((t) => t.name === 'specialties')?.rows.map((r) => r[0]) ?? []);
const cloneRow = new Map(tables.map((t) => [t.name, new Set()]));
for (let pass = 0, changed = true; changed && pass < 10; pass++) {
  changed = false;
  for (const t of tables) {
    if (SHARED.has(t.name) || SKIP.has(t.name)) continue;
    const ic = idCol(t);
    t.rows.forEach((r, n) => {
      if (cloneRow.get(t.name).has(n)) return;
      const own = ic >= 0 ? r[ic] : null;
      const refs = r.some((v, ci) => ci !== ic && (v.match(UUID) ?? []).some((u) => cloned.has(u)));
      if ((own && cloned.has(own)) || refs) {
        cloneRow.get(t.name).add(n);
        if (own && !cloned.has(own)) cloned.add(own);
        changed = true;
      }
    });
  }
}

const remap = (c) => (line) =>
  line.replace(UUID, (u) => {
    if (!cloned.has(u)) return u;
    if (specialtyIds.has(u)) {
      const v = c % SPEC_VARIANTS;
      return v === 0 ? u : newId(u, `spec${v}`);
    }
    return c === 0 ? u : newId(u, c);
  });

const out = ['SET session_replication_role = replica;'];
let teacherNo = 0;
for (const t of tables) {
  if (SKIP.has(t.name)) continue;
  const rows = [];
  const set = cloneRow.get(t.name);
  t.rows.forEach((r, n) => {
    if (t.name === 'users' && r[t.cols.indexOf('role')] !== 'ADMIN') return;
    const copies = set?.has(n) ? (t.name === 'specialties' ? SPEC_VARIANTS : COPIES) : 1;
    for (let c = 0; c < copies; c++) {
      const row = r.map(remap(c));
      if (SUFFIX[t.name] && c > 0) row[t.cols.indexOf(SUFFIX[t.name])] += `-${c + 1}`;
      if (t.name === 'specialties' && c > 0) {
        const q = t.cols.indexOf('qualification');
        row[q] = row[q] === '\\N' ? `вариант ${c + 1}` : `${row[q]} (вариант ${c + 1})`;
      }
      if (t.name === 'teachers') {
        row[t.cols.indexOf('fullName')] = `Преподаватель ${String(++teacherNo).padStart(4, '0')}`;
        for (const col of ['email', 'phone', 'photo', 'photoMime', 'photoUpdatedAt'])
          row[t.cols.indexOf(col)] = '\\N';
      }
      if (t.name === 'users') row[t.cols.indexOf('fullName')] = 'Администратор';
      rows.push(row.join('\t'));
    }
  });
  out.push(t.header, ...rows, '\\.');
}
out.push('SET session_replication_role = DEFAULT;');
const dir = mkdtempSync(join(tmpdir(), 'scale-db-'));
writeFileSync(join(dir, 'data.sql'), out.join('\n') + '\n');
const load = spawnSync('psql', [TARGET, '-q', '-v', 'ON_ERROR_STOP=1', '-f', join(dir, 'data.sql')], {
  encoding: 'utf8',
});
if (load.status !== 0) throw new Error(load.stderr);

// ── 3. Деление преподавателей до --teachers
const nTeachers = Number(psql(TARGET, 'select count(*) from teachers'));
if (TEACHERS > nTeachers) {
  const ratio = TEACHERS / nTeachers;
  psql(
    TARGET,
    `
    CREATE TABLE _tfam AS
      WITH base AS (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM teachers),
           sized AS (SELECT id, rn, (floor(rn * ${ratio}) - floor((rn - 1) * ${ratio}))::int AS n FROM base)
      SELECT s.id AS tid, s.n, g.k,
             CASE WHEN g.k = 0 THEN s.id
                  -- UUID версии 4 (API проверяет формат идентификаторов)
                  ELSE overlay(overlay(md5(s.id || ':' || g.k) PLACING '4' FROM 13) PLACING 'a' FROM 17)::uuid::text END AS nid
      FROM sized s CROSS JOIN LATERAL generate_series(0, greatest(s.n, 1) - 1) AS g(k);
    INSERT INTO teachers
      SELECT (jsonb_populate_record(NULL::teachers, to_jsonb(t) || jsonb_build_object('id', f.nid))).*
      FROM teachers t JOIN _tfam f ON f.tid = t.id AND f.k > 0;
    -- Пара (назначение/поток) целиком уходит одному из «половинок» преподавателя
    UPDATE group_curriculum_assignments a SET "teacherId" = f.nid FROM _tfam f
      WHERE f.tid = a."teacherId" AND f.n > 1 AND f.k = abs(hashtext(coalesce(a."streamKey", a.id))) % f.n;
    UPDATE schedule_lessons l SET "teacherId" = f.nid FROM _tfam f
      WHERE f.tid = l."teacherId" AND f.n > 1
        AND f.k = abs(hashtext(coalesce(l."streamKey", l."assignmentId", l."studentGroupId" || l."semesterCurriculumItemId"))) % f.n;
    UPDATE permanent_lessons l SET "teacherId" = f.nid FROM _tfam f
      WHERE f.tid = l."teacherId" AND f.n > 1
        AND f.k = abs(hashtext(coalesce(l."streamKey", l."assignmentId", l."studentGroupId" || l."semesterCurriculumItemId"))) % f.n;
    WITH num AS (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM teachers)
      UPDATE teachers t SET "fullName" = 'Преподаватель ' || lpad(num.rn::text, 4, '0') FROM num WHERE num.id = t.id;
    DROP TABLE _tfam;
  `,
  );
}

// ── 4. Студенты
if (STUDENTS > 0) {
  psql(
    TARGET,
    `
    DELETE FROM students;
    WITH g AS (SELECT id, row_number() OVER (ORDER BY code) - 1 AS gi, count(*) OVER () AS gn FROM student_groups)
    INSERT INTO students (id, "fullName", "recordBookNumber", "studentGroupId", "isActive", "createdAt", "updatedAt")
      SELECT gen_random_uuid()::text, 'Студент ' || lpad(s::text, 5, '0'), 'З-' || lpad(s::text, 6, '0'), g.id, true, now(), now()
      FROM generate_series(1, ${STUDENTS}) s JOIN g ON g.gi = (s - 1) % g.gn;
  `,
  );
}
psql(TARGET, 'ANALYZE');

const count = (t) => psql(TARGET, `select count(*) from ${t}`).trim();
console.log(
  `Готово за ${Math.round((Date.now() - t0) / 1000)} с: специальностей ${count('specialties')}, планов ${count('educational_programs')}, ` +
    `групп ${count('student_groups')}, преподавателей ${count('teachers')}, аудиторий ${count('classrooms')}, ` +
    `студентов ${count('students')}, пар ${count('schedule_lessons')}, назначений ${count('group_curriculum_assignments')}`,
);
