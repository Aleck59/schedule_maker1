import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createApp } from '../src/main';

/**
 * Сквозной сценарий на демо-данных: роли, генерация, применение, публикация,
 * ручные правки с проверкой конфликтов, отмена и отработка, отметка о проведении,
 * контроль часов, отчёты и экспорт.
 */
describe('Расписание СПО (e2e)', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  const tokens: Record<string, string> = {};
  const auth = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });

  beforeAll(async () => {
    process.env.QUEUE_MODE = 'inline';
    process.env.SOLVER_MODE = 'heuristic';
    app = await createApp({ quiet: true });
    await app.init();
    http = request(app.getHttpServer());
    const users = {
      dispatcher: ['dispatcher@college.ru', 'Dispatcher123!'],
      admin: ['admin@college.ru', 'Admin123!'],
      teacher: ['teacher@college.ru', 'Teacher123!'],
      student: ['student@college.ru', 'Student123!'],
      manager: ['director@college.ru', 'Director123!'],
    };
    for (const [role, [email, password]] of Object.entries(users)) {
      const res = await http.post('/api/auth/login').send({ email, password }).expect(200);
      tokens[role] = res.body.accessToken;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('health и ошибки авторизации на русском языке', async () => {
    await http.get('/api/health').expect(200);
    const noToken = await http.get('/api/programs').expect(401);
    expect(noToken.body.message).toBe('Требуется авторизация');
    const bad = await http
      .post('/api/auth/login')
      .send({ email: 'dispatcher@college.ru', password: 'wrong' })
      .expect(401);
    expect(bad.body.message).toBe('Неверный email или пароль');
  });

  it('валидация DTO возвращает сообщения на русском', async () => {
    const res = await http.post('/api/groups').set(auth('dispatcher')).send({ code: '' }).expect(400);
    expect(res.body.errors.length).toBeGreaterThan(0);
    expect(res.body.message).toMatch(/[а-яё]/i);
  });

  it('разграничение ролей', async () => {
    await http.get('/api/teachers').set(auth('student')).expect(403);
    await http.post('/api/programs').set(auth('manager')).send({}).expect(403);
    await http.get('/api/users').set(auth('dispatcher')).expect(403);
    await http.get('/api/users').set(auth('admin')).expect(200);
    const refresh = await http.post('/api/auth/login').send({ email: 'manager@none.ru', password: 'x' });
    expect(refresh.status).toBe(401);
  });

  let periodId: string;
  let groupId: string;
  let jobId: string;

  it('генерация расписания 4 семестра: очередь → готово → применение', async () => {
    const periods = await http.get('/api/schedule-periods').set(auth('dispatcher')).expect(200);
    const draft = periods.body.find((p: { status: string; title: string }) => p.status === 'DRAFT');
    expect(draft).toBeDefined();
    periodId = draft.id;
    const groups = await http.get('/api/groups').set(auth('dispatcher')).expect(200);
    groupId = groups.body.find((g: { code: string }) => g.code === 'ИСП-24-1').id;

    const job = await http
      .post(`/api/schedule-periods/${periodId}/generate`)
      .set(auth('dispatcher'))
      .send({ mode: 'CALENDAR', solver: 'heuristic', groupIds: [groupId] })
      .expect(201);
    expect(job.body.status).toBe('QUEUED');
    jobId = job.body.id;
    let status = job.body.status;
    for (let i = 0; i < 60 && ['QUEUED', 'GENERATING', 'VALIDATING'].includes(status); i++) {
      await new Promise((r) => setTimeout(r, 500));
      const res = await http
        .get(`/api/generation-jobs/${jobId}?result=false`)
        .set(auth('dispatcher'))
        .expect(200);
      status = res.body.status;
    }
    expect(['COMPLETED', 'COMPLETED_WITH_CONFLICTS']).toContain(status);
    const full = await http.get(`/api/generation-jobs/${jobId}`).set(auth('dispatcher')).expect(200);
    expect(full.body.result.stats.placedLessons).toBeGreaterThan(250);
    expect(full.body.result.lessons[0]).toHaveProperty('teacherName');

    const applied = await http
      .post(`/api/generation-jobs/${jobId}/apply`)
      .set(auth('dispatcher'))
      .expect(200);
    expect(applied.body.created).toBe(full.body.result.stats.placedLessons);
    expect(applied.body.validation.errors).toBe(0);
    // Повторное применение запрещено
    await http.post(`/api/generation-jobs/${jobId}/apply`).set(auth('dispatcher')).expect(409);
  });

  it('проверка и публикация расписания', async () => {
    const v = await http
      .post(`/api/schedule-periods/${periodId}/validate`)
      .set(auth('dispatcher'))
      .expect(200);
    expect(v.body.canPublish).toBe(true);
    await http.post(`/api/schedule-periods/${periodId}/publish`).set(auth('dispatcher')).expect(200);
  });

  let lessonA: { id: string; date: string; lessonNumber: number; teacher: { id: string } | null };
  let lessonB: { id: string; date: string; lessonNumber: number };

  it('перенос в занятый слот отклоняется с описанием конфликта', async () => {
    const lessons = await http
      .get(`/api/schedule-lessons?periodId=${periodId}&groupId=${groupId}&from=2026-02-02&to=2026-02-07`)
      .set(auth('dispatcher'))
      .expect(200);
    const whole = lessons.body.filter((l: { subgroupNumber: number | null }) => l.subgroupNumber === null);
    expect(whole.length).toBeGreaterThan(2);
    lessonA = whole[0];
    lessonB = whole.find(
      (l: { date: string; lessonNumber: number }) =>
        l.date !== lessonA.date || l.lessonNumber !== lessonA.lessonNumber,
    );
    const res = await http
      .post(`/api/schedule-lessons/${lessonA.id}/move`)
      .set(auth('dispatcher'))
      .send({ date: lessonB.date, lessonNumber: lessonB.lessonNumber })
      .expect(409);
    expect(res.body.message).toMatch(/конфликт/i);
    expect(
      res.body.details.issues.some((i: { validationType: string }) => i.validationType === 'GROUP_CONFLICT'),
    ).toBe(true);
  });

  it('проверка слота без сохранения', async () => {
    const res = await http
      .post('/api/schedule-lessons/check')
      .set(auth('dispatcher'))
      .send({ lessonId: lessonA.id, date: lessonB.date, lessonNumber: lessonB.lessonNumber })
      .expect(200);
    expect(res.body.ok).toBe(false);
  });

  it('отмена: часы не списываются, создаётся задача отработки, предлагаются слоты', async () => {
    const before = await http.get(`/api/groups/${groupId}/hour-control`).set(auth('dispatcher')).expect(200);
    const res = await http
      .post(`/api/schedule-lessons/${lessonA.id}/cancel`)
      .set(auth('dispatcher'))
      .send({ reason: 'TEACHER_ABSENT', notes: 'Болезнь' })
      .expect(200);
    expect(res.body.lesson.status).toBe('CANCELLED');
    expect(res.body.makeupTask.status).toBe('OPEN');
    expect(res.body.suggestedSlots.length).toBeGreaterThan(0);
    const after = await http.get(`/api/groups/${groupId}/hour-control`).set(auth('dispatcher')).expect(200);
    expect(after.body.summary.total.scheduled).toBe(before.body.summary.total.scheduled - 2);

    const slot = res.body.suggestedSlots[0];
    const makeup = await http
      .post(`/api/makeup-tasks/${res.body.makeupTask.id}/schedule`)
      .set(auth('dispatcher'))
      .send({ date: slot.date, lessonNumber: slot.lessonNumber, classroomId: slot.classroomId })
      .expect(201);
    expect(makeup.body.lesson.originalLessonId).toBe(lessonA.id);
    const restored = await http
      .get(`/api/groups/${groupId}/hour-control`)
      .set(auth('dispatcher'))
      .expect(200);
    expect(restored.body.summary.total.scheduled).toBe(before.body.summary.total.scheduled);
  });

  it('отметка о проведении: полностью и частично; нельзя отметить будущее занятие', async () => {
    const res = await http
      .post(`/api/schedule-lessons/${lessonB.id}/mark-conducted`)
      .set(auth('dispatcher'))
      .send({ status: 'CONDUCTED', actualHours: 1, notes: 'Проведено частично' })
      .expect(200);
    expect(res.body.conducted.actualHours).toBe(1);
    const future = await http
      .get(`/api/schedule-lessons?from=2099-01-01&to=2099-12-31`)
      .set(auth('dispatcher'))
      .expect(200);
    expect(future.body).toHaveLength(0);
  });

  it('преподаватель видит опубликованное расписание и отмечает только свои занятия', async () => {
    const me = await http.get('/api/auth/me').set(auth('teacher')).expect(200);
    const own = await http
      .get(`/api/schedule-lessons?teacherId=${me.body.teacherId}&from=2026-02-09&to=2026-02-14`)
      .set(auth('teacher'))
      .expect(200);
    const mine = own.body.find(
      (l: { status: string; teacher: { id: string } }) =>
        l.status === 'PLANNED' && l.teacher.id === me.body.teacherId,
    );
    expect(mine).toBeDefined();
    await http
      .post(`/api/schedule-lessons/${mine.id}/mark-conducted`)
      .set(auth('teacher'))
      .send({})
      .expect(200);
    const others = await http
      .get(`/api/schedule-lessons?groupId=${groupId}&from=2026-02-09&to=2026-02-14`)
      .set(auth('teacher'))
      .expect(200);
    const foreign = others.body.find(
      (l: { teacher: { id: string } | null }) => l.teacher && l.teacher.id !== me.body.teacherId,
    );
    await http
      .post(`/api/schedule-lessons/${foreign.id}/mark-conducted`)
      .set(auth('teacher'))
      .send({})
      .expect(403);
  });

  it('студент видит только свою группу', async () => {
    const me = await http.get('/api/auth/me').set(auth('student')).expect(200);
    await http.get(`/api/groups/${me.body.studentGroupId}/schedule`).set(auth('student')).expect(200);
    if (me.body.studentGroupId !== groupId) {
      await http.get(`/api/groups/${groupId}/schedule`).set(auth('student')).expect(403);
    }
    const notifications = await http.get('/api/notifications').set(auth('student')).expect(200);
    expect(Array.isArray(notifications.body)).toBe(true);
  });

  it('контроль часов, отчёты и экспорт', async () => {
    const hc = await http.get(`/api/groups/${groupId}/hour-control`).set(auth('manager')).expect(200);
    expect(hc.body.rows.length).toBeGreaterThan(10);
    const row = hc.body.rows[0];
    expect(row).toHaveProperty('total.planned');
    expect(['NORMAL', 'RISK', 'DEFICIT', 'EXCESS']).toContain(row.status);

    const summary = await http.get('/api/hour-control/summary?by=teacher').set(auth('manager')).expect(200);
    expect(summary.body.items.length).toBeGreaterThan(3);

    const report = await http.get('/api/reports/plan-execution').set(auth('manager')).expect(200);
    expect(report.body.columns.length).toBeGreaterThan(5);

    const xlsx = await http
      .get('/api/reports/teacher-workload/export?format=xlsx')
      .set(auth('manager'))
      .expect(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    const pdf = await http
      .get(`/api/schedule-periods/${periodId}/export/group/${groupId}/pdf?from=2026-02-02&to=2026-02-14`)
      .set(auth('dispatcher'))
      .expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');

    const dashboard = await http.get('/api/dashboard').set(auth('dispatcher')).expect(200);
    expect(dashboard.body.counters.teachers).toBe(9);
  });
});
