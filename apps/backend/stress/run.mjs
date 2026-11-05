#!/usr/bin/env node
/**
 * Нагрузочный тест API без внешних зависимостей (Node 22, встроенный fetch).
 *
 * Виртуальные пользователи (VU) входят под учётными записями из prepare-users.js
 * и повторяют типичные действия своей роли:
 *   студенты      — главная, «Моё расписание» на эту и следующую неделю, изредка PDF;
 *   преподаватели — главная, своё расписание, нагрузка, отчёт, изредка PDF;
 *   администраторы — просмотр расписания, правка занятия, проверка, отчёты, генерация.
 *
 * Пример:
 *   BASE_URL=http://localhost:3000/api STUDENTS=1000 TEACHERS=25 ADMINS=3 \
 *   DURATION=300 RAMP=60 THINK=3-10 BACKEND_PID=$(cat /tmp/api.pid) \
 *   PG_URL=postgresql://postgres:postgres@localhost:5432/schedule \
 *   node stress/run.mjs --out stress-results/realistic.json
 *
 * Переменные:
 *   DURATION  — длительность фазы нагрузки после входа, с (по умолчанию 300)
 *   RAMP      — за сколько секунд входят все пользователи (0 — все сразу, «утренний штурм»)
 *   THINK     — пауза между действиями студента/преподавателя, с: "3-10" или "0" (без пауз)
 *   ADMIN_THINK — пауза администратора, с (по умолчанию "2-6")
 *   GENERATE_EVERY — раз в сколько секунд каждый администратор запускает генерацию (0 — никогда)
 *   STUDENT_POOL — сколько учётных записей студентов создано (STUDENTS выбираются из них случайно)
 *   PREF_SHARE — доля действий преподавателя «предпочтения» (правила доступности), напр. 0.3
 *   LOGIN_RETRIES — сколько раз пользователь пробует войти, прежде чем сдаться (по умолчанию 3)
 *   STEADY_AFTER — с какой секунды считать установившийся режим (по умолчанию RAMP + 15)
 *   WORKERS   — число потоков генератора нагрузки (по умолчанию 2)
 *   BACKEND_PID / PG_URL — для замеров CPU/памяти API и активности Postgres (необязательно)
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const env = process.env;
const BASE = (env.BASE_URL ?? 'http://localhost:3000/api').replace(/\/$/, '');
const PASSWORD = env.STRESS_PASSWORD ?? 'Stress123!';
const DOMAIN = 'stress.local';

const range = (s, def) => {
  const [a, b] = String(s ?? def)
    .split('-')
    .map(Number);
  return [a, Number.isFinite(b) ? b : a];
};
const rnd = ([a, b]) => a + Math.random() * (b - a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pad = (n) => String(n).padStart(4, '0');

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
function weekStart(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - wd);
  return isoDate(d);
}
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

// ───────────────────────────── поток-генератор нагрузки ─────────────────────────────
if (!isMainThread) {
  const {
    vus,
    endAt,
    steadyAfter,
    startAt,
    think,
    adminThink,
    generateEvery,
    today,
    prefShare,
    loginRetries,
  } = workerData;
  const stats = new Map(); // name -> { lat: number[], codes: {}, bytes }
  // Отдельно — установившийся режим: после того как все вошли (RAMP + 15 с)
  const steadyStats = new Map();
  const steadyFrom = startAt + steadyAfter * 1000;
  const timeline = new Map(); // second -> [requests, errors]
  const week = weekStart(today);

  const put = (map, name, ms, code, bytes, hit) => {
    let s = map.get(name);
    if (!s) map.set(name, (s = { lat: [], codes: {}, bytes: 0, hits: 0 }));
    if (hit) s.hits++;
    s.lat.push(ms);
    s.codes[code] = (s.codes[code] ?? 0) + 1;
    s.bytes += bytes;
  };
  const rec = (name, ms, code, bytes = 0, hit = false) => {
    put(stats, name, ms, code, bytes, hit);
    if (Date.now() - ms >= steadyFrom) put(steadyStats, name, ms, code, bytes, hit);
    const sec = Math.floor((Date.now() - startAt) / 1000);
    const t = timeline.get(sec) ?? [0, 0];
    t[0]++;
    if (String(code).startsWith('ERR') || Number(code) >= 400) t[1]++;
    timeline.set(sec, t);
  };

  async function req(name, token, path, { method = 'GET', body, json = true, query } = {}) {
    let url = BASE + path;
    if (query) {
      const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null));
      url += `?${qs}`;
    }
    const t0 = performance.now();
    try {
      const res = await fetch(url, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(120_000),
      });
      const buf = await res.arrayBuffer();
      // X-Cache: HIT — ответ из кэша Redis
      rec(name, performance.now() - t0, res.status, buf.byteLength, res.headers.get('x-cache') === 'HIT');
      if (!res.ok) return null;
      return json ? JSON.parse(Buffer.from(buf).toString('utf8')) : true;
    } catch (e) {
      // ERR:<причина> — тайм-аут клиента, разрыв соединения сервером и т. п.
      rec(name, performance.now() - t0, `ERR:${e?.cause?.code ?? e?.name ?? 'unknown'}`);
      return null;
    }
  }

  // Время «открытия страницы» = все запросы страницы параллельно, как в браузере
  async function page(name, fns) {
    const t0 = performance.now();
    const out = await Promise.all(fns.map((f) => f()));
    rec(`страница: ${name}`, performance.now() - t0, out.every((x) => x !== null) ? 200 : 'PART');
    return out;
  }

  // Пользователь, у которого вход не удался, пробует снова (LOGIN_RETRIES раз, пауза растёт до 10 с).
  // «вход до успеха» — время от первой попытки до входа, с повторами: так его ощущает человек
  async function login(email) {
    const t0 = performance.now();
    for (let attempt = 0; attempt < loginRetries; attempt++) {
      const r = await req('POST /auth/login', null, '/auth/login', {
        method: 'POST',
        body: { email, password: PASSWORD },
      });
      if (r?.accessToken) {
        rec('вход до успеха (с повторами)', performance.now() - t0, 200);
        return r;
      }
      await sleep(Math.min(10_000, 1000 * (attempt + 1)));
    }
    rec('вход до успеха (с повторами)', performance.now() - t0, 'ERR:gave-up');
    return null;
  }

  const shell = (token) => [
    () => req('GET /auth/me', token, '/auth/me'),
    () => req('GET /notifications/unread-count', token, '/notifications/unread-count'),
  ];

  async function student(token, user) {
    const g = user.studentGroupId;
    if (Math.random() < 0.3) {
      await page('студент — главная', [
        ...shell(token),
        () => req('GET /dashboard', token, '/dashboard'),
        () => req('GET /schedule-periods', token, '/schedule-periods'),
      ]);
    } else {
      const next = Math.random() < 0.25;
      const from = next ? addDays(week, 7) : week;
      await page('студент — моё расписание', [
        ...shell(token),
        () => req('GET /schedule-periods', token, '/schedule-periods'),
        () =>
          req('GET /schedule-lessons (группа, неделя)', token, '/schedule-lessons', {
            query: { groupId: g, from, to: addDays(from, 6) },
          }),
      ]);
      if (Math.random() < 0.02 && user.periodId) {
        await req('GET export group pdf', token, `/schedule-periods/${user.periodId}/export/group/${g}/pdf`, {
          json: false,
        });
      }
    }
  }

  async function teacher(token, user) {
    const t = user.teacherId;
    // r ∈ [0, 1 + prefShare): доля действий «предпочтения» добавляется к прежней смеси
    const r = Math.random() * (1 + prefShare);
    if (r < 0.25) {
      await page('преподаватель — главная', [
        ...shell(token),
        () => req('GET /dashboard', token, '/dashboard'),
      ]);
    } else if (r < 0.75) {
      await page('преподаватель — моё расписание', [
        ...shell(token),
        () => req('GET /schedule-periods', token, '/schedule-periods'),
        () =>
          req('GET /schedule-lessons (преподаватель, неделя)', token, '/schedule-lessons', {
            query: { teacherId: t, from: week, to: addDays(week, 6) },
          }),
        () => req('GET /teachers/:id/availability', token, `/teachers/${t}/availability`),
      ]);
    } else if (r < 0.75 + prefShare) {
      // Мои предпочтения: правила доступности — посмотреть, проверить и сохранить, позже удалить
      const [, rules] = await page('преподаватель — предпочтения (открыть)', [
        () => req('GET /teachers/:id/availability', token, `/teachers/${t}/availability`),
        () => req('GET /teachers/:id/availability-rules', token, `/teachers/${t}/availability-rules`),
      ]);
      const own = Array.isArray(rules) ? rules.filter((x) => x.note === 'нагрузочный тест') : [];
      if (own.length && Math.random() < 0.5) {
        await req(
          'DELETE /teachers/:id/availability-rules/:ruleId',
          token,
          `/teachers/${t}/availability-rules/${own[0].id}`,
          {
            method: 'DELETE',
          },
        );
      } else {
        const rule = {
          kind: pick(['PREFERRED', 'UNDESIRED', 'UNAVAILABLE']),
          weekdays: [1 + Math.floor(Math.random() * 6)],
          lessonNumbers: [1 + Math.floor(Math.random() * 6)],
          note: 'нагрузочный тест',
        };
        await req(
          'POST /teachers/:id/availability-rules/preview',
          token,
          `/teachers/${t}/availability-rules/preview`,
          {
            method: 'POST',
            body: rule,
          },
        );
        await req('POST /teachers/:id/availability-rules', token, `/teachers/${t}/availability-rules`, {
          method: 'POST',
          body: rule,
        });
      }
    } else if (r < 0.95 + prefShare) {
      await page('преподаватель — нагрузка', [
        () => req('GET /teachers/:id/workload', token, `/teachers/${t}/workload`),
      ]);
    } else if (user.periodId) {
      await req(
        'GET export teacher pdf',
        token,
        `/schedule-periods/${user.periodId}/export/teacher/${t}/pdf`,
        { json: false },
      );
    }
  }

  async function admin(token, ctx) {
    const period = pick(ctx.periods);
    const r = Math.random();
    if (r < 0.35) {
      // Раздел «Расписание»: неделя группы
      const groupId = period.groups?.[0]?.id ?? period.groupId;
      await page('админ — расписание', [
        ...shell(token),
        () => req('GET /schedule-periods', token, '/schedule-periods'),
        () =>
          req('GET /schedule-lessons (период, неделя)', token, '/schedule-lessons', {
            query: { periodId: period.id, groupId, from: week, to: addDays(week, 6) },
          }),
        () =>
          req('GET /calendar-events', token, '/calendar-events', {
            query: { from: week, to: addDays(week, 6) },
          }),
        () => req('GET /validation-results', token, `/schedule-periods/${period.id}/validation-results`),
      ]);
    } else if (r < 0.55) {
      // Правка занятия: открыть, проверить слот и сохранить (без фактического изменения)
      const lessons = await req('GET /schedule-lessons (день)', token, '/schedule-lessons', {
        query: { periodId: period.id, from: week, to: addDays(week, 6) },
      });
      const l = lessons?.length ? pick(lessons) : null;
      if (l) {
        await req('GET /schedule-lessons/:id', token, `/schedule-lessons/${l.id}`);
        await req('POST /schedule-lessons/check', token, '/schedule-lessons/check', {
          method: 'POST',
          body: {
            schedulePeriodId: l.schedulePeriodId,
            lessonId: l.id,
            date: String(l.date).slice(0, 10),
            lessonNumber: l.lessonNumber,
            studentGroupId: l.studentGroupId,
            teacherId: l.teacherId ?? null,
            classroomId: l.classroomId ?? null,
          },
        });
        await req('PATCH /schedule-lessons/:id', token, `/schedule-lessons/${l.id}`, {
          method: 'PATCH',
          body: { notes: l.notes ?? '' },
        });
      }
    } else if (r < 0.65) {
      await req('POST /schedule-periods/:id/validate', token, `/schedule-periods/${period.id}/validate`, {
        method: 'POST',
      });
    } else if (r < 0.8) {
      await page('админ — нагрузка преподавателей', [
        () =>
          req('GET /workload/teachers?current', token, '/workload/teachers', { query: { current: true } }),
      ]);
    } else if (r < 0.9) {
      await page('админ — выполнение часов', [
        () => req('GET /hour-control/summary', token, '/hour-control/summary', { query: { by: 'group' } }),
      ]);
    } else if (r < 0.95) {
      await req('GET /reports/teacher-workload', token, '/reports/teacher-workload', {
        query: { semesterId: period.semesterId },
      });
    } else {
      await req('GET export excel (период)', token, `/schedule-periods/${period.id}/export/excel`, {
        json: false,
      });
    }
  }

  async function generate(token, ctx) {
    const period = pick(ctx.periods);
    const t0 = performance.now();
    const job = await req(
      'POST /schedule-periods/:id/generate',
      token,
      `/schedule-periods/${period.id}/generate`,
      { method: 'POST', body: {} },
    );
    if (!job?.id) return;
    let status = job.status;
    while (['QUEUED', 'GENERATING', 'VALIDATING'].includes(status) && Date.now() < endAt + 120_000) {
      await sleep(1500);
      const j = await req('GET /generation-jobs/:id (опрос)', token, `/generation-jobs/${job.id}`);
      status = j?.status ?? status;
    }
    rec(
      'генерация (от запуска до результата)',
      performance.now() - t0,
      ['COMPLETED', 'COMPLETED_WITH_CONFLICTS'].includes(status) ? 200 : status,
    );
  }

  async function runVu(vu) {
    await sleep(vu.delay);
    const auth = await login(vu.email);
    if (!auth) return;
    const token = auth.accessToken;
    const user = { ...auth.user, periodId: null };
    const ctx = { periods: [] };
    const periods = await req('GET /schedule-periods', token, '/schedule-periods');
    if (Array.isArray(periods) && periods.length) {
      ctx.periods = periods;
      user.periodId =
        periods.find((p) => p.startDate?.slice(0, 10) <= today && p.endDate?.slice(0, 10) >= today)?.id ??
        periods[0].id;
    }
    let nextGen = Date.now() + (generateEvery ? Math.random() * generateEvery * 1000 : Infinity);
    while (Date.now() < endAt) {
      if (vu.role === 'student') await student(token, user);
      else if (vu.role === 'teacher') await teacher(token, user);
      else if (ctx.periods.length) {
        if (Date.now() >= nextGen) {
          await generate(token, ctx);
          nextGen = Date.now() + generateEvery * 1000;
        } else await admin(token, ctx);
      }
      await sleep(rnd(vu.role === 'admin' ? adminThink : think) * 1000);
    }
  }

  await Promise.all(vus.map(runVu));
  parentPort.postMessage({
    stats: [...stats],
    steady: [...steadyStats],
    timeline: [...timeline],
  });
}

// ───────────────────────────── главный поток ─────────────────────────────
if (isMainThread) {
  const args = process.argv.slice(2);
  const outPath = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
  const STUDENTS = Number(env.STUDENTS ?? 1000);
  const STUDENT_POOL = Number(env.STUDENT_POOL ?? STUDENTS);
  const PREF_SHARE = Number(env.PREF_SHARE ?? 0);
  const LOGIN_RETRIES = Number(env.LOGIN_RETRIES ?? 3);
  const TEACHERS = Number(env.TEACHERS ?? 25);
  const ADMINS = Number(env.ADMINS ?? 3);
  const DURATION = Number(env.DURATION ?? 300);
  const RAMP = Number(env.RAMP ?? 60);
  const STEADY_AFTER = Number(env.STEADY_AFTER ?? RAMP + 15);
  const WORKERS = Number(env.WORKERS ?? 2);
  const think = range(env.THINK, '3-10');
  const adminThink = range(env.ADMIN_THINK, '2-6');
  const generateEvery = Number(env.GENERATE_EVERY ?? 120);
  const today = env.TODAY ?? isoDate(new Date());
  const startAt = Date.now() + 500;
  const endAt = startAt + (RAMP + DURATION) * 1000;
  const run = promisify(execFile);

  const vus = [];
  // Из пула STUDENT_POOL учётных записей одновременно работают STUDENTS случайных (по разным группам)
  const pool = Array.from({ length: Math.max(STUDENT_POOL, STUDENTS) }, (_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  for (const i of pool.slice(0, STUDENTS))
    vus.push({ role: 'student', email: `student-${pad(i)}@${DOMAIN}` });
  for (let i = 0; i < TEACHERS; i++) vus.push({ role: 'teacher', email: `teacher-${pad(i)}@${DOMAIN}` });
  for (let i = 0; i < ADMINS; i++) vus.push({ role: 'admin', email: `admin-${pad(i)}@${DOMAIN}` });
  for (const v of vus) v.delay = 500 + Math.random() * RAMP * 1000;

  // ── мониторинг: CPU/память API и Postgres, задержка /health как признак занятости основного потока
  const hz = 100;
  const procCpu = (pid) => {
    try {
      const f = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
      return (Number(f[11]) + Number(f[12])) / hz; // utime+stime, с
    } catch {
      return null;
    }
  };
  const procRss = (pid) => {
    try {
      return Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))[1]) / 1024;
    } catch {
      return null;
    }
  };
  const pgPids = () =>
    readdirSync('/proc')
      .filter((p) => /^\d+$/.test(p))
      .filter((p) => {
        try {
          return readFileSync(`/proc/${p}/comm`, 'utf8').trim() === 'postgres';
        } catch {
          return false;
        }
      });
  const childPids = (pid) => {
    try {
      return readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean);
    } catch {
      return [];
    }
  };
  const apiPid = env.BACKEND_PID;
  const samples = [];
  let prev = null;
  const sample = async () => {
    const t = (Date.now() - startAt) / 1000;
    const pids = apiPid ? [apiPid, ...childPids(apiPid)] : [];
    const apiCpu = pids.reduce((a, p) => a + (procCpu(p) ?? 0), 0);
    // основной поток Node (JS-код запросов); остальное — потоки Prisma, генерации, GC
    const apiMain = apiPid ? (procCpu(`${apiPid}/task/${apiPid}`) ?? 0) : 0;
    const pgCpu = pgPids().reduce((a, p) => a + (procCpu(p) ?? 0), 0);
    const genCpu = process.cpuUsage();
    const s = {
      t,
      apiRssMb: apiPid ? pids.reduce((a, p) => a + (procRss(p) ?? 0), 0) : null,
      loadavg: readFileSync('/proc/loadavg', 'utf8').split(' ')[0],
    };
    if (prev) {
      const dt = t - prev.t;
      s.apiCpuPct = apiPid ? Math.max(0, ((apiCpu - prev.apiCpu) / dt) * 100) : null;
      s.apiMainThreadPct = apiPid ? Math.max(0, ((apiMain - prev.apiMain) / dt) * 100) : null;
      s.pgCpuPct = Math.max(0, ((pgCpu - prev.pgCpu) / dt) * 100);
      s.genCpuPct = ((genCpu.user + genCpu.system - prev.gen) / 1e6 / dt) * 100;
    }
    if (env.PG_URL) {
      try {
        const { stdout } = await run('psql', [
          env.PG_URL,
          '-At',
          '-c',
          "select count(*) filter (where state='active'), count(*) filter (where wait_event_type='Lock'), count(*) from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()",
        ]);
        const [active, locks, total] = stdout.trim().split('|').map(Number);
        Object.assign(s, { pgActive: active, pgLockWaits: locks, pgConns: total });
      } catch {
        /* psql недоступен */
      }
    }
    prev = { t, apiCpu, apiMain, pgCpu, gen: genCpu.user + genCpu.system };
    samples.push(s);
  };
  const health = [];
  const probe = async () => {
    const t0 = performance.now();
    try {
      const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(30_000) });
      await r.arrayBuffer();
      health.push([(Date.now() - startAt) / 1000, performance.now() - t0, r.status]);
    } catch {
      health.push([(Date.now() - startAt) / 1000, performance.now() - t0, 'ERR:timeout']);
    }
  };
  if (env.PG_URL) await run('psql', [env.PG_URL, '-qc', 'select pg_stat_statements_reset()']).catch(() => {});
  const mon = setInterval(sample, 2000);
  const hp = setInterval(probe, 1000);
  await sample();

  console.log(
    `Старт: ${STUDENTS} студентов, ${TEACHERS} преподавателей, ${ADMINS} админов; вход за ${RAMP} с, нагрузка ${DURATION} с, ` +
      `пауза ${think.join('–')} с, генерация раз в ${generateEvery || '∞'} с на админа`,
  );
  const progress = setInterval(() => {
    const s = samples.at(-1);
    console.log(
      `  t=${Math.round((Date.now() - startAt) / 1000)}s  API CPU ${s?.apiCpuPct?.toFixed(0) ?? '–'}% (осн. поток ${s?.apiMainThreadPct?.toFixed(0) ?? '–'}%)  RSS ${s?.apiRssMb?.toFixed(0) ?? '–'} МБ  ` +
        `PG CPU ${s?.pgCpuPct?.toFixed(0) ?? '–'}%  PG active ${s?.pgActive ?? '–'}  /health ${health.at(-1)?.[1]?.toFixed(0) ?? '–'} мс`,
    );
  }, 15_000);

  const chunks = Array.from({ length: WORKERS }, () => []);
  vus.forEach((v, i) => chunks[i % WORKERS].push(v));
  const results = await Promise.all(
    chunks.map(
      (chunk) =>
        new Promise((resolve, reject) => {
          const w = new Worker(fileURLToPath(import.meta.url), {
            workerData: {
              vus: chunk,
              endAt,
              startAt,
              steadyAfter: STEADY_AFTER,
              think,
              adminThink,
              generateEvery,
              today,
              prefShare: PREF_SHARE,
              loginRetries: LOGIN_RETRIES,
            },
          });
          w.on('message', resolve);
          w.on('error', reject);
        }),
    ),
  );
  clearInterval(mon);
  clearInterval(hp);
  clearInterval(progress);
  await sample();

  // ── сводка
  const pct = (sorted, p) =>
    sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;
  const totalSec = (Date.now() - startAt) / 1000;
  const table = (key, seconds) => {
    const merged = new Map();
    for (const r of results)
      for (const [name, s] of r[key]) {
        const m = merged.get(name) ?? { lat: [], codes: {}, bytes: 0, hits: 0 };
        m.hits += s.hits ?? 0;
        for (const x of s.lat) m.lat.push(x);
        for (const [c, n] of Object.entries(s.codes)) m.codes[c] = (m.codes[c] ?? 0) + n;
        m.bytes += s.bytes;
        merged.set(name, m);
      }
    return [...merged]
      .map(([name, m]) => {
        const lat = m.lat.sort((a, b) => a - b);
        const errors = Object.entries(m.codes)
          .filter(([c]) => Number.isNaN(Number(c)) || Number(c) >= 400)
          .reduce((a, [, n]) => a + n, 0);
        return {
          name,
          count: lat.length,
          rps: +(lat.length / seconds).toFixed(2),
          p50: Math.round(pct(lat, 50)),
          p95: Math.round(pct(lat, 95)),
          p99: Math.round(pct(lat, 99)),
          max: Math.round(lat.at(-1) ?? 0),
          errors,
          errorPct: +((errors / lat.length) * 100).toFixed(2),
          codes: m.codes,
          avgKb: +(m.bytes / lat.length / 1024).toFixed(1),
          cacheHitPct: +((m.hits / lat.length) * 100).toFixed(0),
        };
      })
      .sort((a, b) => b.p95 - a.p95);
  };
  const rows = table('stats', totalSec);
  const steadySec = Math.max(1, totalSec - STEADY_AFTER - 0.5);
  const steadyRows = table('steady', steadySec);
  const timeline = new Map();
  for (const r of results)
    for (const [sec, [n, e]] of r.timeline) {
      const t = timeline.get(sec) ?? [0, 0];
      t[0] += n;
      t[1] += e;
      timeline.set(sec, t);
    }
  const totalReq = rows
    .filter((r) => !/^(страница|генерация|вход до)/.test(r.name))
    .reduce((a, r) => a + r.count, 0);
  const totalErr = rows
    .filter((r) => !/^(страница|генерация|вход до)/.test(r.name))
    .reduce((a, r) => a + r.errors, 0);
  const hLat = health.map((h) => h[1]).sort((a, b) => a - b);
  const steady = samples.filter((s) => s.t > STEADY_AFTER && s.apiCpuPct != null);
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const summary = {
    config: {
      STUDENTS,
      TEACHERS,
      ADMINS,
      DURATION,
      RAMP,
      think,
      adminThink,
      generateEvery,
      WORKERS,
      today,
      base: BASE,
    },
    totals: {
      seconds: +totalSec.toFixed(1),
      requests: totalReq,
      rps: +(totalReq / totalSec).toFixed(1),
      peakRps: Math.max(0, ...[...timeline.values()].map((t) => t[0])),
      errors: totalErr,
      errorPct: +((totalErr / Math.max(1, totalReq)) * 100).toFixed(2),
    },
    health: {
      p50: Math.round(pct(hLat, 50)),
      p95: Math.round(pct(hLat, 95)),
      p99: Math.round(pct(hLat, 99)),
      max: Math.round(hLat.at(-1) ?? 0),
    },
    resources: {
      apiCpuAvgPct: avg(steady.map((s) => s.apiCpuPct))?.toFixed(0),
      apiCpuMaxPct: Math.max(0, ...samples.map((s) => s.apiCpuPct ?? 0)).toFixed(0),
      apiMainThreadAvgPct: avg(steady.map((s) => s.apiMainThreadPct))?.toFixed(0),
      apiRssMaxMb: Math.max(0, ...samples.map((s) => s.apiRssMb ?? 0)).toFixed(0),
      pgCpuAvgPct: avg(steady.map((s) => s.pgCpuPct))?.toFixed(0),
      pgCpuMaxPct: Math.max(0, ...samples.map((s) => s.pgCpuPct ?? 0)).toFixed(0),
      pgActiveMax: Math.max(0, ...samples.map((s) => s.pgActive ?? 0)),
      pgConnsMax: Math.max(0, ...samples.map((s) => s.pgConns ?? 0)),
      generatorCpuAvgPct: avg(steady.map((s) => s.genCpuPct))?.toFixed(0),
    },
    endpoints: rows,
    steady: steadyRows,
    steadyTotals: (() => {
      const r = steadyRows.filter((x) => !/^(страница|генерация|вход до)/.test(x.name));
      const n = r.reduce((a, x) => a + x.count, 0);
      const e = r.reduce((a, x) => a + x.errors, 0);
      return {
        seconds: +steadySec.toFixed(1),
        requests: n,
        rps: +(n / steadySec).toFixed(1),
        errors: e,
        errorPct: +((e / Math.max(1, n)) * 100).toFixed(2),
      };
    })(),
    timeline: [...timeline].sort((a, b) => a[0] - b[0]),
    samples,
    health_series: health,
  };

  if (env.PG_URL) {
    try {
      const { stdout } = await run('psql', [
        env.PG_URL,
        '-At',
        '-F',
        '\t',
        '-c',
        "select calls, round(total_exec_time)::int, round(mean_exec_time::numeric,2), rows, regexp_replace(left(query, 220), '\\s+', ' ', 'g') from pg_stat_statements where dbid=(select oid from pg_database where datname=current_database()) order by total_exec_time desc limit 15",
      ]);
      summary.topQueries = stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const [calls, totalMs, meanMs, rowsN, query] = l.split('\t');
          return { calls: +calls, totalMs: +totalMs, meanMs: +meanMs, rows: +rowsN, query };
        });
    } catch {
      /* pg_stat_statements не включён */
    }
  }

  console.log(
    `\nИтого: ${totalReq} запросов за ${totalSec.toFixed(0)} с (${summary.totals.rps} RPS, пик ${summary.totals.peakRps}/с), ошибок ${totalErr} (${summary.totals.errorPct}%)`,
  );
  console.log(
    `/health во время теста: p50 ${summary.health.p50} мс, p95 ${summary.health.p95} мс, max ${summary.health.max} мс`,
  );
  console.log(`Ресурсы: ${JSON.stringify(summary.resources)}`);
  console.log('\nВесь тест (включая вход):');
  console.table(rows.map(({ codes, ...r }) => r));
  console.log(
    `\nУстановившийся режим (после входа всех, ${steadySec.toFixed(0)} с): ${JSON.stringify(summary.steadyTotals)}`,
  );
  console.table(steadyRows.map(({ codes, ...r }) => r));
  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(summary, null, 1));
    console.log(`Результаты: ${outPath}`);
  }
  process.exit(0);
}
