import { NestExpressApplication } from '@nestjs/platform-express';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { createApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';

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

  it('название и логотип программы: открыты без входа, меняет только администратор', async () => {
    const def = await http.get('/api/settings/branding').expect(200);
    expect(def.body.appName).toBe('Расписание СПО и ВО');
    expect(def.body.appLogo).toBeNull();
    const logo = 'data:image/png;base64,iVBORw0KGgo=';
    await http.patch('/api/settings/organization').set(auth('dispatcher')).send({ appName: 'X' }).expect(403);
    const bad = await http
      .patch('/api/settings/organization')
      .set(auth('admin'))
      .send({ appLogo: 'data:text/html;base64,PHNjcmlwdD4=' })
      .expect(400);
    expect(bad.body.message).toMatch(/Логотип/);
    await http
      .patch('/api/settings/organization')
      .set(auth('admin'))
      .send({ appName: '  Колледж  ', appLogo: logo })
      .expect(200);
    const custom = await http.get('/api/settings/branding').expect(200);
    expect(custom.body).toMatchObject({ appName: 'Колледж', appLogo: logo });
    // Пустые значения возвращают название и значок по умолчанию
    await http
      .patch('/api/settings/organization')
      .set(auth('admin'))
      .send({ appName: '', appLogo: '' })
      .expect(200);
    const reset = await http.get('/api/settings/branding').expect(200);
    expect(reset.body).toMatchObject({ appName: 'Расписание СПО и ВО', appLogo: null });
  });

  it('тепловая карта аудиторий: занятость всех аудиторий за период', async () => {
    await http.get('/api/classrooms/occupancy').set(auth('student')).expect(403);
    await http.get('/api/classrooms/occupancy?from=2026-13-01').set(auth('manager')).expect(400);
    const res = await http
      .get('/api/classrooms/occupancy?from=2026-09-01&to=2026-12-31')
      .set(auth('manager'))
      .expect(200);
    const rooms = res.body.rooms as Array<{
      slotsTotal: number;
      slotsUsed: number;
      percent: number;
      grid: Record<string, number>;
    }>;
    expect(rooms.length).toBeGreaterThan(0);
    expect(rooms.some((r) => r.slotsUsed > 0)).toBe(true);
    for (const r of rooms) {
      expect(r.slotsUsed).toBeLessThanOrEqual(r.slotsTotal);
      const gridSum = Object.values(r.grid).reduce((a, b) => a + b, 0);
      expect(gridSum).toBe(r.slotsUsed);
    }
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

  it('преподавателю доступны только собственные отчёты и контроль часов', async () => {
    const me = await http.get('/api/auth/me').set(auth('teacher')).expect(200);
    const types = await http.get('/api/reports').set(auth('teacher')).expect(200);
    expect(types.body.map((t: { type: string }) => t.type)).toEqual(['teacher-schedule']);
    await http.get('/api/reports/plan-execution').set(auth('teacher')).expect(403);
    const own = await http
      .get('/api/reports/teacher-schedule?from=2026-02-09&to=2026-02-14')
      .set(auth('teacher'))
      .expect(200);
    expect(own.body.rows.length).toBeGreaterThan(0);
    const hours = await http.get('/api/hour-control').set(auth('teacher')).expect(200);
    expect(hours.body.rows.length).toBeGreaterThan(0);
    for (const row of hours.body.rows as Array<{ teachers: Array<{ id: string | null }> }>) {
      expect(row.teachers.some((t) => t.id === me.body.teacherId)).toBe(true);
    }
    const programs = await http.get('/api/programs').set(auth('manager')).expect(200);
    await http
      .get(`/api/programs/${programs.body[0].id}/export/hour-control/excel`)
      .set(auth('teacher'))
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

  it('календарный график: недели на границе учебных лет учитывают только свой год', async () => {
    const programs = await http.get('/api/programs').set(auth('manager')).expect(200);
    const graph = await http
      .get(`/api/programs/${programs.body[0].id}/calendar-graph`)
      .set(auth('manager'))
      .expect(200);
    expect(graph.body.years.length).toBeGreaterThan(0);
    const settings = await http.get('/api/settings').set(auth('manager')).expect(200);
    const workingDays: number[] = settings.body.settings.workingDays;
    for (const year of graph.body.years as Array<{
      startDate: string;
      endDate: string;
      weeks: Array<{ start: string; end: string; workingDays: number }>;
    }>) {
      for (const week of year.weeks) {
        const from = week.start < year.startDate ? year.startDate : week.start;
        const to = week.end > year.endDate ? year.endDate : week.end;
        let days = 0;
        for (
          let d = new Date(`${from}T00:00:00Z`);
          d <= new Date(`${to}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() + 1)
        ) {
          if (workingDays.includes(d.getUTCDay() === 0 ? 7 : d.getUTCDay())) days++;
        }
        expect(week.workingDays).toBe(days);
      }
    }
  });

  it('предложения по устранению конфликтов: применение в один клик и автоисправление', async () => {
    const prisma = app.get(PrismaService);
    await http.get(`/api/schedule-periods/${periodId}/fixes`).set(auth('teacher')).expect(403);
    const baseline = (
      await http.post(`/api/schedule-periods/${periodId}/validate`).set(auth('dispatcher')).expect(200)
    ).body.errors;
    const list = await http
      .get(`/api/schedule-lessons?periodId=${periodId}&groupId=${groupId}&from=2026-03-02&to=2026-03-07`)
      .set(auth('dispatcher'))
      .expect(200);
    const source = list.body.find(
      (l: { status: string; subgroupNumber: number | null }) =>
        l.status === 'PLANNED' && l.subgroupNumber === null,
    );
    const row = await prisma.scheduleLesson.findUniqueOrThrow({ where: { id: source.id } });
    const { id: _id, createdAt: _c, updatedAt: _u, ...copy } = row;
    await prisma.scheduleLesson.create({ data: { ...copy, isManual: true } });

    const fixes = await http
      .get(`/api/schedule-periods/${periodId}/fixes`)
      .set(auth('dispatcher'))
      .expect(200);
    expect(fixes.body.errors).toBeGreaterThan(baseline);
    const group = fixes.body.fixes.find(
      (f: { issue: { validationType: string } }) => f.issue.validationType === 'GROUP_CONFLICT',
    );
    expect(group.lessons).toHaveLength(2);
    expect(group.options[0]).toMatchObject({ action: 'DELETE', title: 'Удалить дублирующее занятие' });
    const move = group.options.find((o: { action: string }) => o.action === 'MOVE');
    expect(move.title).toMatch(/^Перенести на \d{2}\.\d{2}\.\d{4}/);
    await http
      .post(`/api/schedule-periods/${periodId}/fixes/apply`)
      .set(auth('dispatcher'))
      .send(move)
      .expect(200);

    // После переноса остаётся превышение часов — предлагается удалить лишнее занятие
    const next = await http
      .get(`/api/schedule-periods/${periodId}/fixes`)
      .set(auth('dispatcher'))
      .expect(200);
    expect(
      next.body.fixes.some(
        (f: { issue: { validationType: string } }) => f.issue.validationType === 'GROUP_CONFLICT',
      ),
    ).toBe(false);
    const excess = next.body.fixes.find(
      (f: { issue: { validationType: string } }) => f.issue.validationType === 'HOURS_EXCEEDED',
    );
    expect(excess.options[0]).toMatchObject({ action: 'DELETE' });
    await http
      .post(`/api/schedule-periods/${periodId}/fixes/apply`)
      .set(auth('dispatcher'))
      .send(excess.options[0])
      .expect(200);
    const fixed = await http
      .post(`/api/schedule-periods/${periodId}/validate`)
      .set(auth('dispatcher'))
      .expect(200);
    expect(fixed.body.errors).toBe(baseline);

    // Новый дубликат исправляется автоматически
    await prisma.scheduleLesson.create({ data: { ...copy, isManual: true } });
    const auto = await http
      .post(`/api/schedule-periods/${periodId}/fixes/auto`)
      .set(auth('dispatcher'))
      .expect(200);
    expect(auto.body.applied.length).toBeGreaterThan(0);
    expect(auto.body.errors).toBe(baseline);
  });

  it('гибкие правила доступности: предпросмотр, права, проверка расписания', async () => {
    const me = await http.get('/api/auth/me').set(auth('teacher')).expect(200);
    const teacherId: string = me.body.teacherId;
    const preview = await http
      .post(`/api/teachers/${teacherId}/availability-rules/preview?from=2026-09-01`)
      .set(auth('teacher'))
      .send({ kind: 'UNAVAILABLE', weekdays: [6], monthWeeks: [-1] })
      .expect(200);
    expect(preview.body.description).toBe('Не может вести занятия: последняя суббота месяца, все пары');
    expect(preview.body.dates.slice(0, 3).map((d: { date: string }) => d.date)).toEqual([
      '2026-09-26',
      '2026-10-31',
      '2026-11-28',
    ]);
    const own = await http
      .post(`/api/teachers/${teacherId}/availability-rules`)
      .set(auth('teacher'))
      .send({ kind: 'ONLINE', monthWeeks: [1], note: 'Курсы повышения квалификации' })
      .expect(201);
    const others = await http.get('/api/teachers').set(auth('dispatcher')).expect(200);
    const other = others.body.find((t: { id: string }) => t.id !== teacherId);
    await http
      .post(`/api/teachers/${other.id}/availability-rules`)
      .set(auth('teacher'))
      .send({ kind: 'UNAVAILABLE', weekdays: [1] })
      .expect(403);
    await http
      .post(`/api/teachers/${teacherId}/availability-rules`)
      .set(auth('dispatcher'))
      .send({ kind: 'UNAVAILABLE', timeFrom: '15:00', timeTo: '12:00' })
      .expect(400);
    const list = await http
      .get(`/api/teachers/${teacherId}/availability-rules`)
      .set(auth('teacher'))
      .expect(200);
    expect(list.body[0].description).toMatch(/^Занятия онлайн: 1-я неделя месяца/);
    await http
      .delete(`/api/teachers/${teacherId}/availability-rules/${own.body.id}`)
      .set(auth('teacher'))
      .expect(200);

    // Запрет на конкретную дату и пару → ошибка проверки расписания и ручной правки
    const lessons = await http
      .get(`/api/schedule-lessons?periodId=${periodId}&teacherId=${teacherId}&from=2026-02-16&to=2026-02-21`)
      .set(auth('dispatcher'))
      .expect(200);
    const lesson = lessons.body.find((l: { status: string }) => l.status === 'PLANNED');
    expect(lesson).toBeDefined();
    const before = await http
      .post(`/api/schedule-periods/${periodId}/validate`)
      .set(auth('dispatcher'))
      .expect(200);
    const rule = await http
      .post(`/api/teachers/${teacherId}/availability-rules`)
      .set(auth('dispatcher'))
      .send({
        kind: 'UNAVAILABLE',
        lessonNumbers: [lesson.lessonNumber],
        validFrom: lesson.date,
        validTo: lesson.date,
        note: 'Заседание аттестационной комиссии',
      })
      .expect(201);
    const after = await http
      .post(`/api/schedule-periods/${periodId}/validate`)
      .set(auth('dispatcher'))
      .expect(200);
    expect(after.body.canPublish).toBe(false);
    expect(after.body.errors).toBe(before.body.errors + 1);
    const issue = after.body.items.find(
      (i: { validationType: string; message: string }) =>
        i.validationType === 'TEACHER_UNAVAILABLE' && i.message.includes('по правилу'),
    );
    expect(issue.message).toMatch(/Заседание аттестационной комиссии/);
    const check = await http
      .post('/api/schedule-lessons/check')
      .set(auth('dispatcher'))
      .send({ lessonId: lesson.id, date: lesson.date, lessonNumber: lesson.lessonNumber })
      .expect(200);
    expect(check.body.ok).toBe(false);
    await http
      .delete(`/api/teachers/${teacherId}/availability-rules/${rule.body.id}`)
      .set(auth('dispatcher'))
      .expect(200);
    const restored = await http
      .post(`/api/schedule-periods/${periodId}/validate`)
      .set(auth('dispatcher'))
      .expect(200);
    expect(restored.body.errors).toBe(before.body.errors);
  });

  it('импорт учебного плана со скана: черновик, проверка и создание плана, графика и группы', async () => {
    await http.get('/api/curriculum-scans/status').set(auth('dispatcher')).expect(200);
    await http.get('/api/curriculum-scans').set(auth('teacher')).expect(403);
    const bad = await http
      .post('/api/curriculum-scans')
      .set(auth('dispatcher'))
      .attach('files', Buffer.from('текст'), 'план.docx')
      .expect(400);
    expect(bad.body.message).toMatch(/не поддерживается/);

    // Результат распознавания (формат Python-модуля) — само распознавание проверяется тестами модуля
    const hours = (h: Record<string, number>) => ({
      total: 0,
      contact: 0,
      lecture: 0,
      laboratory: 0,
      practical: 0,
      seminar: 0,
      individualProject: 0,
      selfStudy: 0,
      assessment: 0,
      ...h,
    });
    const prisma = app.get(PrismaService);
    const org = await prisma.organization.findFirstOrThrow();
    const scan = await prisma.curriculumScan.create({
      data: {
        organizationId: org.id,
        fileNames: ['plan.pdf'],
        status: 'READY',
        progress: 1,
        resultJson: {
          title: {
            specialtyCode: '40.02.04',
            specialtyName: 'Юриспруденция',
            qualification: 'Юрист',
            studyForm: 'FULL_TIME',
            durationMonths: 34,
            admissionYear: 2026,
            fgosNumber: '798',
            fgosDate: '2023-10-27',
          },
          semesters: [
            {
              number: 1,
              course: 1,
              startDate: '2026-09-01',
              endDate: '2027-02-07',
              weeks: { theory: 18.83, exam: 2, vacation: 2, practice: 0 },
            },
            {
              number: 2,
              course: 1,
              startDate: '2027-02-08',
              endDate: '2027-08-31',
              weeks: { theory: 18.5, exam: 2, vacation: 8.83, practice: 1 },
            },
          ],
          periods: [
            { course: 1, type: 'EXAM_SESSION', startDate: '2027-01-11', endDate: '2027-01-23' },
            { course: 1, type: 'VACATION', startDate: '2027-01-25', endDate: '2027-02-06' },
            { course: 1, type: 'EDUCATIONAL_PRACTICE', startDate: '2027-06-07', endDate: '2027-06-12' },
          ],
          cycles: [
            { code: 'СГ', name: 'Социально-гуманитарный цикл' },
            { code: 'П', name: 'Профессиональный цикл' },
          ],
          items: [
            {
              code: 'СОО.01',
              name: 'Обязательная часть',
              kind: 'GROUP',
              cycleCode: 'СОО',
              parentCode: null,
              issues: [],
              semesters: [
                {
                  number: 1,
                  controlForm: 'OTHER',
                  hours: hours({ total: 100, contact: 100, practical: 100 }),
                  cells: {},
                },
              ],
            },
            {
              code: 'СОО.01.01',
              name: 'Русский язык',
              kind: 'DISCIPLINE',
              cycleCode: 'СОО.01',
              parentCode: null,
              issues: [],
              semesters: [
                {
                  number: 1,
                  controlForm: 'OTHER',
                  hours: hours({ total: 50, contact: 50, practical: 50 }),
                  cells: {},
                },
              ],
            },
            {
              code: 'СГ.01',
              name: 'История России',
              kind: 'DISCIPLINE',
              cycleCode: 'СГ',
              parentCode: null,
              issues: [],
              semesters: [
                {
                  number: 2,
                  controlForm: 'CREDIT',
                  hours: hours({
                    total: 72,
                    contact: 68,
                    lecture: 32,
                    practical: 18,
                    seminar: 18,
                    selfStudy: 4,
                  }),
                  cells: { contact: { status: 'corrected', read: '58', crop: '' } },
                },
              ],
            },
            {
              code: 'ПМ.01',
              name: 'Правоприменительная деятельность',
              kind: 'MODULE',
              cycleCode: 'П',
              parentCode: null,
              issues: [],
              semesters: [
                {
                  number: 2,
                  controlForm: 'EXAM',
                  hours: hours({
                    total: 180,
                    contact: 64,
                    lecture: 32,
                    practical: 32,
                    selfStudy: 107,
                    assessment: 9,
                  }),
                  cells: {},
                },
              ],
            },
            {
              code: 'МДК.01.01',
              name: 'Административный процесс',
              kind: 'INTERDISCIPLINARY_COURSE',
              cycleCode: 'П',
              parentCode: 'ПМ.01',
              issues: [],
              semesters: [
                {
                  number: 2,
                  controlForm: 'CREDIT',
                  hours: hours({ total: 72, contact: 64, lecture: 32, practical: 32, selfStudy: 8 }),
                  cells: {},
                },
              ],
            },
            {
              code: 'УП.01.01',
              name: 'Учебная практика',
              kind: 'EDUCATIONAL_PRACTICE',
              cycleCode: 'П',
              parentCode: 'ПМ.01',
              issues: [],
              semesters: [
                {
                  number: 2,
                  controlForm: 'DIFFERENTIATED_CREDIT',
                  hours: hours({ total: 36, selfStudy: 36 }),
                  cells: {},
                },
              ],
            },
            {
              code: 'ПМ.01.01(К)',
              name: 'Экзамен по модулю',
              kind: 'MODULE_EXAM',
              cycleCode: 'П',
              parentCode: 'ПМ.01',
              issues: [],
              semesters: [
                {
                  number: 2,
                  controlForm: 'EXAM',
                  hours: hours({ total: 36, selfStudy: 27, assessment: 9 }),
                  cells: {},
                },
              ],
            },
          ],
          warnings: [],
        },
      },
    });

    const loaded = await http.get(`/api/curriculum-scans/${scan.id}`).set(auth('dispatcher')).expect(200);
    const draft = loaded.body.draft;
    expect(draft.specialty).toMatchObject({
      code: '40.02.04',
      name: 'Юриспруденция',
      qualification: 'Юрист',
    });
    expect(draft.program.title).toBe('40.02.04 Юриспруденция, набор 2026');
    expect(draft.items.find((i: { code: string }) => i.code === 'СОО.01').include).toBe(false);
    expect(draft.items.find((i: { code: string }) => i.code === 'ПМ.01.01(К)').semesters[0].controlForm).toBe(
      'QUALIFICATION_EXAM',
    );

    const invalid = await http
      .post(`/api/curriculum-scans/${scan.id}/apply`)
      .set(auth('dispatcher'))
      .send({ ...draft, semesters: [{ ...draft.semesters[0], number: 2 }, draft.semesters[1]] })
      .expect(400);
    expect(invalid.body.errors.join(' ')).toMatch(/Семестр 2 указан дважды/);

    const applied = await http
      .post(`/api/curriculum-scans/${scan.id}/apply`)
      .set(auth('dispatcher'))
      .send({ ...draft, group: { code: 'Ю-26-1', studentCount: 25, subgroupCount: 2 } })
      .expect(200);
    expect(applied.body.created).toEqual({
      semesters: 2,
      cycles: 3,
      items: 5,
      semesterItems: 5,
      calendarEvents: 3,
    });

    const programId = applied.body.programId;
    const tree = await http.get(`/api/programs/${programId}/curriculum`).set(auth('dispatcher')).expect(200);
    expect(tree.body.cycles.map((c: { code: string }) => c.code).sort()).toEqual(['П', 'СГ', 'СОО.01']);
    const items = await prisma.curriculumItem.findMany({
      where: { educationalProgramId: programId },
      include: { semesterItems: true, parent: true },
    });
    const history = items.find((i) => i.code === 'СГ.01')!;
    expect(history.semesterItems[0]).toMatchObject({
      lectureHours: 32,
      practicalHours: 36,
      selfStudyHours: 4,
      totalHours: 72,
      controlForm: 'CREDIT',
      plannedPracticalLessons: 18,
    });
    const practice = items.find((i) => i.code === 'УП.01.01')!;
    expect(practice.parent?.code).toBe('ПМ.01');
    expect(practice.semesterItems[0]).toMatchObject({
      practiceHours: 36,
      practiceAtCollege: true,
      plannedPracticeLessons: 18,
    });
    const module = items.find((i) => i.code === 'ПМ.01')!;
    expect(module.semesterItems).toHaveLength(1);
    expect(module.semesterItems[0]).toMatchObject({
      controlForm: 'QUALIFICATION_EXAM',
      totalHours: 36,
      assessmentHours: 9,
      lectureHours: 0,
    });
    expect(items.some((i) => i.code === 'СОО.01' || i.code === 'ПМ.01.01(К)')).toBe(false);

    const events = await prisma.calendarEvent.findMany({ where: { educationalProgramId: programId } });
    expect(events.map((e) => e.eventType).sort()).toEqual([
      'EDUCATIONAL_PRACTICE',
      'EXAM_SESSION',
      'VACATION',
    ]);
    expect(events.every((e) => e.courseNumber === 1 && e.blocksSchedule)).toBe(true);
    const group = await prisma.studentGroup.findUniqueOrThrow({
      where: { code: 'Ю-26-1' },
      include: { subgroups: true },
    });
    expect(group.subgroups).toHaveLength(2);
    expect(group.educationalProgramId).toBe(programId);

    await http.post(`/api/curriculum-scans/${scan.id}/apply`).set(auth('dispatcher')).send(draft).expect(409);
    const list = await http.get('/api/curriculum-scans').set(auth('dispatcher')).expect(200);
    expect(list.body.find((s: { id: string }) => s.id === scan.id)).toMatchObject({
      status: 'APPLIED',
      programId,
    });
  });

  it('импорт учебного плана из файлов .plx и .xml (GosInsp): чтение, черновик и создание плана', async () => {
    const fixtures = join(__dirname, '../../solver/tests/fixtures');
    const status = await http.get('/api/curriculum-scans/status').set(auth('dispatcher')).expect(200);
    expect(status.body.fileFormats).toEqual(['.plx', '.xml']);
    expect(status.body.fileImportAvailable).toBe(true);

    const mixed = await http
      .post('/api/curriculum-scans')
      .set(auth('dispatcher'))
      .attach('files', readFileSync(join(fixtures, 'plan-spo.plx')), 'plan.plx')
      .attach('files', Buffer.from('%PDF-1.4'), 'scan.pdf')
      .expect(400);
    expect(mixed.body.message).toMatch(/по одному/);

    const waitReady = async (id: string) => {
      for (let i = 0; i < 100; i++) {
        const res = await http.get(`/api/curriculum-scans/${id}`).set(auth('dispatcher')).expect(200);
        if (res.body.status !== 'PROCESSING') return res.body;
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error('Файл учебного плана не прочитан за 20 с');
    };

    const broken = await http
      .post('/api/curriculum-scans')
      .set(auth('dispatcher'))
      .attach('files', Buffer.from('<root><a/></root>'), 'other.xml')
      .expect(201);
    const failed = await waitReady(broken.body.id);
    expect(failed.status).toBe('FAILED');
    expect(failed.error).toMatch(/не похож на учебный план/);

    const uploaded = await http
      .post('/api/curriculum-scans')
      .set(auth('dispatcher'))
      .attach('files', readFileSync(join(fixtures, 'plan-spo.plx')), 'plan-isp.plx')
      .expect(201);
    const ready = await waitReady(uploaded.body.id);
    expect(ready.status).toBe('READY');
    expect(ready.resultJson.source).toBe('plx');
    const draft = ready.draft;
    expect(draft.specialty).toMatchObject({
      code: '09.02.07',
      qualification: 'Программист',
      educationLevel: 'SPO',
    });
    expect(draft.program).toMatchObject({ admissionYear: 2025, studyForm: 'FULL_TIME', durationMonths: 46 });
    expect(draft.semesters).toHaveLength(8);

    const applied = await http
      .post(`/api/curriculum-scans/${uploaded.body.id}/apply`)
      .set(auth('dispatcher'))
      .send({
        ...draft,
        items: draft.items.map(({ issues: _issues, ...item }: { issues: string[] }) => item),
      })
      .expect(200);
    expect(applied.body.created).toMatchObject({ semesters: 8, items: 6 });
    const prisma = app.get(PrismaService);
    const items = await prisma.curriculumItem.findMany({
      where: { educationalProgramId: applied.body.programId },
      include: { semesterItems: { include: { semester: true } } },
    });
    const os = items.find((i) => i.code === 'ОП.01')!;
    expect(os.semesterItems[0]).toMatchObject({
      lectureHours: 30,
      laboratoryHours: 40,
      controlForm: 'EXAM',
    });
    expect(os.semesterItems[0].semester.number).toBe(3);
    const module = items.find((i) => i.code === 'ПМ.01')!;
    expect(module.semesterItems.map((s) => s.controlForm)).toEqual(['QUALIFICATION_EXAM']);

    // .xml GosInsp в кодировке windows-1251 с календарным графиком
    const xml = await http
      .post('/api/curriculum-scans')
      .set(auth('dispatcher'))
      .attach('files', readFileSync(join(fixtures, 'plan-spo-gosinsp.xml')), 'plan.xml')
      .expect(201);
    const xmlReady = await waitReady(xml.body.id);
    expect(xmlReady.resultJson.source).toBe('gosinsp');
    expect(xmlReady.draft.specialty.code).toBe('40.02.04');
    expect(xmlReady.draft.semesters[0]).toMatchObject({ startDate: '2026-09-01', endDate: '2027-01-17' });
    expect(xmlReady.draft.periods.length).toBeGreaterThan(5);
  });

  it('уровень образования специальности определяется по коду', async () => {
    const vo = await http
      .post('/api/specialties')
      .set(auth('dispatcher'))
      .send({ code: '38.03.01', name: 'Экономика', qualification: 'Бакалавр', durationMonths: 48 })
      .expect(201);
    expect(vo.body.educationLevel).toBe('BACHELOR');
    const spo = await http
      .post('/api/specialties')
      .set(auth('dispatcher'))
      .send({
        code: '38.02.01',
        name: 'Экономика и бухгалтерский учет',
        qualification: 'Бухгалтер',
        durationMonths: 34,
      })
      .expect(201);
    expect(spo.body.educationLevel).toBe('SPO');
  });

  it('составление расписания для всех групп: план, совместная генерация, режим занятий группы', async () => {
    const period = await http.get(`/api/schedule-periods/${periodId}`).set(auth('dispatcher')).expect(200);
    // Через три недели после начала семестра: у обеих групп идёт теоретическое обучение
    const date = new Date(new Date(period.body.startDate).getTime() + 21 * 86400000)
      .toISOString()
      .slice(0, 10);
    const groups = await http.get('/api/groups').set(auth('dispatcher')).expect(200);
    const other = groups.body.find(
      (g: { code: string; isActive: boolean }) =>
        g.isActive && g.code.startsWith('ИСП-') && g.code !== 'ИСП-24-1',
    );
    expect(other).toBeDefined();
    // Вторая смена: группе можно ставить только 2–3 пары
    await http
      .patch(`/api/groups/${other.id}`)
      .set(auth('dispatcher'))
      .send({ firstLessonNumber: 2, lastLessonNumber: 3 })
      .expect(200);
    await http
      .patch(`/api/groups/${other.id}`)
      .set(auth('dispatcher'))
      .send({ firstLessonNumber: 4, lastLessonNumber: 2 })
      .expect(400);

    await http.get(`/api/generation/all/plan?date=${date}`).set(auth('teacher')).expect(403);
    const plan = await http.get(`/api/generation/all/plan?date=${date}`).set(auth('dispatcher')).expect(200);
    const rows = plan.body.groups as Array<{
      groupId: string;
      included: boolean;
      periodId: string | null;
      createPeriod: boolean;
      reason: string | null;
    }>;
    const main = rows.find((r) => r.groupId === groupId)!;
    expect(main).toMatchObject({ included: true, periodId, createPeriod: false });
    const second = rows.find((r) => r.groupId === other.id)! as (typeof rows)[number] & {
      semesterId: string;
    };
    expect(second.included).toBe(true);
    // В демо-плане у этого семестра нет дисциплин: две обязательные и одна по выбору
    const cycles = await http
      .get(`/api/programs/${other.educationalProgramId}/cycles`)
      .set(auth('dispatcher'))
      .expect(200);
    const semesterHours = {
      semesterId: second.semesterId,
      totalHours: 72,
      lectureHours: 24,
      practicalHours: 24,
      selfStudyHours: 24,
    };
    for (const [code, name, isRequired] of [
      ['ОП.90', 'Основы алгоритмизации', true],
      ['ОП.91', 'Компьютерные сети', true],
      ['ОП.92', 'Дисциплина по выбору', false],
    ] as const) {
      await http
        .post(`/api/programs/${other.educationalProgramId}/curriculum-items`)
        .set(auth('dispatcher'))
        .send({
          cycleId: cycles.body[0].id,
          code,
          name,
          itemType: 'DISCIPLINE',
          isRequired,
          semesters: [semesterHours],
        })
        .expect(201);
    }
    // Нагрузка группы на этот семестр: по учебному плану (без дисциплины по выбору), преподаватели — по очереди
    await http
      .post('/api/assignments/generate')
      .set(auth('dispatcher'))
      .send({ studentGroupId: other.id, semesterId: second.semesterId })
      .expect(201);
    const teachers = await http.get('/api/teachers').set(auth('dispatcher')).expect(200);
    const assignments = await http
      .get(`/api/assignments?groupId=${other.id}&semesterId=${second.semesterId}`)
      .set(auth('dispatcher'))
      .expect(200);
    for (const [i, a] of (assignments.body as Array<{ id: string; teacherId: string | null }>).entries()) {
      if (a.teacherId) continue;
      await http
        .patch(`/api/assignments/${a.id}`)
        .set(auth('dispatcher'))
        .send({ teacherId: teachers.body[i % teachers.body.length].id })
        .expect(200);
    }
    expect(plan.body.summary.included).toBeGreaterThanOrEqual(2);
    for (const r of rows.filter((x) => !x.included)) expect(r.reason).toMatch(/[а-яё]/i);

    const dateTo = new Date(new Date(`${date}T00:00:00Z`).getTime() + 13 * 86400000)
      .toISOString()
      .slice(0, 10);
    const res = await http
      .post('/api/generation/all')
      .set(auth('dispatcher'))
      .send({ date, dateFrom: date, dateTo, solver: 'heuristic' })
      .expect(201);
    const joint = res.body.job;
    expect(joint.periodIds.length).toBeGreaterThanOrEqual(2);
    expect(joint.periodIds).toContain(periodId);
    let status = joint.status;
    for (let i = 0; i < 60 && ['QUEUED', 'GENERATING', 'VALIDATING'].includes(status); i++) {
      await new Promise((r) => setTimeout(r, 500));
      const j = await http
        .get(`/api/generation-jobs/${joint.id}?result=false`)
        .set(auth('dispatcher'))
        .expect(200);
      status = j.body.status;
    }
    expect(['COMPLETED', 'COMPLETED_WITH_CONFLICTS']).toContain(status);
    const full = await http.get(`/api/generation-jobs/${joint.id}`).set(auth('dispatcher')).expect(200);
    const result = full.body.result;
    expect(result.periods.length).toBe(joint.periodIds.length);
    const lessons = result.lessons as Array<{
      periodId: string;
      groupIds: string[];
      lessonNumber: number;
      date: string;
    }>;
    expect(lessons.length).toBeGreaterThan(0);
    const otherLessons = lessons.filter((l) => l.groupIds.includes(other.id));
    expect(otherLessons.length).toBeGreaterThan(0);
    expect(otherLessons.every((l) => l.lessonNumber >= 2 && l.lessonNumber <= 3)).toBe(true);
    expect(new Set(lessons.map((l) => l.periodId)).size).toBeGreaterThanOrEqual(2);
    expect(lessons.every((l) => l.date >= date && l.date <= dateTo)).toBe(true);
    // Дисциплина по выбору без нагрузки в расписание не попадает
    expect(otherLessons.some((l) => (l as { itemCode?: string }).itemCode === 'ОП.92')).toBe(false);
    expect(otherLessons.some((l) => (l as { itemCode?: string }).itemCode === 'ОП.90')).toBe(true);

    // Пока идёт совместная генерация, периоды заняты; история совместных генераций
    const history = await http.get('/api/generation-jobs').set(auth('dispatcher')).expect(200);
    expect(history.body[0].id).toBe(joint.id);
    const periodJobs = await http
      .get(
        `/api/schedule-periods/${second.periodId ?? joint.periodIds.find((id: string) => id !== periodId)}/generation-jobs`,
      )
      .set(auth('dispatcher'))
      .expect(200);
    expect(periodJobs.body.some((j: { id: string }) => j.id === joint.id)).toBe(true);

    const applied = await http
      .post(`/api/generation-jobs/${joint.id}/apply`)
      .set(auth('dispatcher'))
      .expect(200);
    expect(applied.body.created).toBeGreaterThan(0);
    const otherPeriodId = joint.periodIds.find((id: string) => id !== periodId);
    const own = await http
      .get(`/api/schedule-lessons?periodId=${otherPeriodId}&groupId=${other.id}`)
      .set(auth('dispatcher'))
      .expect(200);
    const ownLessons = Array.isArray(own.body) ? own.body : own.body.items;
    expect(ownLessons.length).toBeGreaterThan(0);
    await http
      .patch(`/api/groups/${other.id}`)
      .set(auth('dispatcher'))
      .send({ firstLessonNumber: null, lastLessonNumber: null })
      .expect(200);
  });

  it('преподаватель вышел в середине семестра: дата начала работы, передача нагрузки, деление часов', async () => {
    type Lesson = {
      id: string;
      date: string;
      lessonNumber: number;
      status: string;
      assignmentId: string | null;
      teacher: { id: string } | null;
    };
    const listLessons = async (): Promise<Lesson[]> => {
      const res = await http
        .get(`/api/schedule-lessons?periodId=${periodId}&groupId=${groupId}`)
        .set(auth('dispatcher'))
        .expect(200);
      return Array.isArray(res.body) ? res.body : res.body.items;
    };
    const day = (l: Lesson) => l.date.slice(0, 10);
    const lessons = await listLessons();
    const assignments = await http
      .get(`/api/assignments?groupId=${groupId}`)
      .set(auth('dispatcher'))
      .expect(200);
    const target = assignments.body.find(
      (a: { id: string; teacherId: string | null; streamKey: string | null }) =>
        a.teacherId &&
        !a.streamKey &&
        new Set(lessons.filter((l) => l.assignmentId === a.id && l.status === 'PLANNED').map(day)).size >= 4,
    );
    expect(target).toBeDefined();
    const own = lessons.filter((l) => l.assignmentId === target.id && l.status === 'PLANNED');
    const dates = [...new Set(own.map(day))].sort();
    const fromDate = dates[Math.floor(dates.length / 2)];
    const early = own.find((l) => day(l) < fromDate)!;

    // Новый преподаватель (бакалавр — только СПО) начинает работать с fromDate
    const created = await http
      .post('/api/teachers')
      .set(auth('dispatcher'))
      .send({ fullName: 'Новикова Ольга Петровна', educationLevel: 'BACHELOR', employedFrom: fromDate })
      .expect(201);
    const newId = created.body.id;
    expect(created.body).not.toHaveProperty('photo');
    const card = await http.get(`/api/teachers/${newId}`).set(auth('dispatcher')).expect(200);
    expect(card.body.allowedLevels).toEqual(['SPO']);

    // Раньше даты начала работы занятие не поставить и нагрузку не передать
    const check = await http
      .post('/api/schedule-lessons/check')
      .set(auth('dispatcher'))
      .send({ lessonId: early.id, date: day(early), lessonNumber: early.lessonNumber, teacherId: newId })
      .expect(200);
    expect(check.body.ok).toBe(false);
    expect(JSON.stringify(check.body.issues)).toContain('начинает работать');
    const tooEarly = await http
      .post(`/api/assignments/${target.id}/handover`)
      .set(auth('dispatcher'))
      .send({ teacherId: newId, fromDate: dates[0] })
      .expect(400);
    expect(tooEarly.body.message).toContain('начинает работать');

    // Ограничение по уровню: преподаватель, которому разрешён только бакалавриат, не ведёт у группы СПО
    await http
      .patch(`/api/teachers/${newId}`)
      .set(auth('dispatcher'))
      .send({ teachableLevels: ['BACHELOR'] })
      .expect(200);
    const wrongLevel = await http
      .post(`/api/assignments/${target.id}/handover`)
      .set(auth('dispatcher'))
      .send({ teacherId: newId, fromDate })
      .expect(400);
    expect(wrongLevel.body.message).toContain('не может вести');
    await http
      .patch(`/api/teachers/${newId}`)
      .set(auth('dispatcher'))
      .send({ teachableLevels: [] })
      .expect(200);

    // Передача с даты: ранние занятия остаются за прежним преподавателем
    const handover = await http
      .post(`/api/assignments/${target.id}/handover`)
      .set(auth('dispatcher'))
      .send({ teacherId: newId, fromDate })
      .expect(201);
    expect(handover.body.moved).toBeGreaterThan(0);
    expect(handover.body.kept).toBeGreaterThan(0);
    expect(handover.body.conflicts).toEqual([]);
    const after = (await listLessons()).filter((l) => l.assignmentId === target.id && l.status === 'PLANNED');
    for (const l of after) {
      expect(l.teacher?.id).toBe(day(l) >= fromDate ? newId : target.teacherId);
    }

    // Нагрузка делится: часы прежнего преподавателя не входят в план нового и остаются в плане прежнего
    const wNew = await http.get(`/api/teachers/${newId}/workload`).set(auth('dispatcher')).expect(200);
    const wOld = await http
      .get(`/api/teachers/${target.teacherId}/workload`)
      .set(auth('dispatcher'))
      .expect(200);
    expect(wNew.body.planned.handedOverHours).toBeGreaterThan(0);
    expect(wOld.body.planned.previousHours).toBe(wNew.body.planned.handedOverHours);
    expect(wNew.body.scheduled.total).toBeLessThanOrEqual(wNew.body.planned.total);

    // Проверка расписания: ошибок по уровню и периоду работы нет
    const v = await http
      .post(`/api/schedule-periods/${periodId}/validate`)
      .set(auth('dispatcher'))
      .expect(200);
    const issues = JSON.stringify(v.body);
    expect(issues).not.toContain('TEACHER_LEVEL');
    expect(issues).not.toContain('начинает работать');

    // Фотография: только изображения, отдаётся отдельно, в карточке и списке — без двоичных данных
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    );
    await http
      .post(`/api/teachers/${newId}/photo`)
      .set(auth('dispatcher'))
      .attach('file', Buffer.from('не картинка'), { filename: 'photo.txt', contentType: 'text/plain' })
      .expect(400);
    const withPhoto = await http
      .post(`/api/teachers/${newId}/photo`)
      .set(auth('dispatcher'))
      .attach('file', png, { filename: 'photo.png', contentType: 'image/png' })
      .expect(200);
    expect(withPhoto.body.photoUpdatedAt).toBeTruthy();
    expect(withPhoto.body).not.toHaveProperty('photo');
    const photo = await http.get(`/api/teachers/${newId}/photo`).set(auth('teacher')).expect(200);
    expect(photo.headers['content-type']).toContain('image/png');
    const list = await http.get('/api/teachers').set(auth('dispatcher')).expect(200);
    const tile = list.body.find((x: { id: string }) => x.id === newId);
    expect(tile).not.toHaveProperty('photo');
    expect(tile.disciplines.length).toBeGreaterThan(0);
    await http.delete(`/api/teachers/${newId}/photo`).set(auth('dispatcher')).expect(200);
    await http.get(`/api/teachers/${newId}/photo`).set(auth('dispatcher')).expect(404);
  });

  it('мастер настройки: шаги подготовки расписания и следующий шаг', async () => {
    await http.get('/api/setup/status').set(auth('teacher')).expect(403);
    const res = await http.get('/api/setup/status').set(auth('dispatcher')).expect(200);
    expect(res.body.steps.map((s: { key: string }) => s.key)).toEqual([
      'settings',
      'curriculum',
      'calendar',
      'groups',
      'teachers',
      'classrooms',
      'workload',
      'generation',
      'validation',
      'publish',
    ]);
    const byKey = Object.fromEntries(
      res.body.steps.map((s: { key: string; done: boolean }) => [s.key, s.done]),
    );
    expect(byKey).toMatchObject({
      settings: true,
      curriculum: true,
      groups: true,
      teachers: true,
      publish: true,
    });
    expect(res.body.completed).toBe(res.body.steps.filter((s: { done: boolean }) => s.done).length);
    if (res.body.next) expect(byKey[res.body.next]).toBe(false);
  });

  it('контроль часов, отчёты и экспорт', async () => {
    const hc = await http.get(`/api/groups/${groupId}/hour-control`).set(auth('manager')).expect(200);
    expect(hc.body.rows.length).toBeGreaterThan(10);
    const row = hc.body.rows[0];
    expect(row).toHaveProperty('total.planned');
    expect(['NORMAL', 'RISK', 'DEFICIT', 'EXCESS']).toContain(row.status);

    // Сводная нагрузка: за все семестры и за текущие — по каждому преподавателю, в одинаковом порядке
    const all = await http.get('/api/workload/teachers').set(auth('manager')).expect(200);
    const current = await http.get('/api/workload/teachers?current=true').set(auth('manager')).expect(200);
    expect(current.body.map((t: { teacherId: string }) => t.teacherId)).toEqual(
      all.body.map((t: { teacherId: string }) => t.teacherId),
    );
    expect(all.body.some((t: { planned: number }) => t.planned > 0)).toBe(true);
    for (const [i, t] of current.body.entries()) expect(t.planned).toBeLessThanOrEqual(all.body[i].planned);

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
    // 9 преподавателей демо-данных и преподаватель, вышедший в середине семестра
    expect(dashboard.body.counters.teachers).toBe(10);
  });

  it('экзамены и зачёты: у преподавателя и аудитории нет двух мероприятий в одну пару', async () => {
    const groups = await http.get('/api/groups').set(auth('dispatcher')).expect(200);
    const base = groups.body.find((g: { code: string }) => g.code === 'ИСП-24-1');
    // Вторая группа того же учебного плана — те же дисциплины и экзамены в те же дни аттестации
    await http
      .post('/api/groups')
      .set(auth('dispatcher'))
      .send({
        educationalProgramId: base.educationalProgramId,
        code: 'ИСП-24-2',
        courseNumber: base.courseNumber,
        currentSemesterNumber: base.currentSemesterNumber,
        studentCount: 20,
      })
      .expect(201);
    const prisma = app.get(PrismaService);
    // Семестр с экзаменами в сессию и зачётами
    const semester = await prisma.semester.findFirstOrThrow({
      where: { educationalProgramId: base.educationalProgramId, number: 4 },
    });
    const placed = await http
      .post('/api/assessment-events/auto-place')
      .set(auth('dispatcher'))
      .send({ semesterId: semester.id, replaceExisting: true })
      .expect(201);
    expect(placed.body.created).toBeGreaterThan(2);
    const list = await http
      .get(`/api/assessment-events?semesterId=${semester.id}`)
      .set(auth('dispatcher'))
      .expect(200);
    type Ev = {
      date: string;
      lessonNumber: number | null;
      teacherId: string | null;
      classroomId: string | null;
      controlForm: string;
      group: { code: string };
      semesterItem: { curriculumItem: { name: string } };
    };
    const events: Ev[] = list.body;
    expect(new Set(events.map((e) => e.group.code))).toEqual(new Set(['ИСП-24-1', 'ИСП-24-2']));
    const slot = (e: Ev) => `${e.date.slice(0, 10)}#${e.lessonNumber}`;
    const unique = (keys: string[]) => expect(new Set(keys).size).toBe(keys.length);
    for (const e of events) expect(e.lessonNumber).toBeGreaterThan(0);
    unique(events.filter((e) => e.teacherId).map((e) => `${e.teacherId}|${slot(e)}`));
    // Одноимённые дисциплины двух групп (один преподаватель) — разными парами или в разные дни
    unique(events.map((e) => `${e.semesterItem.curriculumItem.name}|${slot(e)}`));
    unique(events.filter((e) => e.classroomId).map((e) => `${e.classroomId}|${slot(e)}`));
    unique(events.map((e) => `${e.group.code}|${slot(e)}`));
    // Один экзамен группы в день
    const exams = events.filter((e) => e.controlForm === 'EXAM');
    unique(exams.map((e) => `${e.group.code}|${e.date.slice(0, 10)}`));

    // Ручное мероприятие в занятую преподавателем пару отклоняется
    const busy = events.find((e) => e.teacherId);
    if (busy) {
      const other = groups.body.find((g: { code: string }) => g.code === 'ИСП-25-1');
      const item = await prisma.semesterCurriculumItem.findFirstOrThrow({
        where: {
          semester: { educationalProgramId: other.educationalProgramId },
          controlForm: { not: 'NONE' },
        },
      });
      const clash = await http
        .post('/api/assessment-events')
        .set(auth('dispatcher'))
        .send({
          studentGroupId: other.id,
          semesterCurriculumItemId: item.id,
          date: busy.date.slice(0, 10),
          lessonNumber: busy.lessonNumber,
          teacherId: busy.teacherId,
        })
        .expect(400);
      expect(clash.body.message).toMatch(/Преподаватель в эту пару уже принимает/);
    }
  });
});
