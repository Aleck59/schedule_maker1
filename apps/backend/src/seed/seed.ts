import '../config/env';
import 'reflect-metadata';
process.env.QUEUE_MODE = 'inline';

import { NestFactory } from '@nestjs/core';
import {
  CalendarEventType,
  CancellationReason,
  ClassroomType,
  GenerationJobStatus,
  GenerationMode,
  LessonStatus,
  LessonType,
  Prisma,
  PrismaClient,
  ProgramStatus,
  StudyForm,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../app.module';
import { CalendarService } from '../calendar/calendar.service';
import { AuthUser } from '../common/types/auth-user';
import { addDaysStr, parseDate, toDateStr, todayInTimezone } from '../common/utils/dates';
import { computePlannedLessons } from '../common/utils/hours';
import { defaultBlocksSchedule } from '../planning/calendar-context';
import { PrismaService } from '../prisma/prisma.service';
import { MakeupTasksService } from '../schedule/makeup-tasks.service';
import { SchedulePeriodsService } from '../schedule/schedule-periods.service';
import { ScheduleLessonsService } from '../schedule/schedule-lessons.service';
import { GenerationRunnerService } from '../scheduler/generation-runner.service';
import { GenerationService } from '../scheduler/generation.service';
import { DEFAULT_LESSON_TIMES } from '../settings/settings.service';
import {
  CLASSROOMS,
  CURRICULUM,
  CYCLES,
  DEMO_USERS,
  FEMALE_FIRST,
  HOLIDAY_FIXED,
  HOLIDAY_TRANSFERS,
  MALE_FIRST,
  MALE_LAST,
  ORGANIZATION,
  PATRONYMIC_BASE,
  semesterPlans,
  SPECIALTY,
  TEACHERS,
} from './demo-data';

const log = (...args: unknown[]) => console.log('[seed]', ...args);

/** Детерминированный генератор псевдослучайных чисел */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function studentNames(count: number, seed: number): string[] {
  const rand = rng(seed);
  const names = new Set<string>();
  while (names.size < count) {
    const male = rand() < 0.6;
    const last = MALE_LAST[Math.floor(rand() * MALE_LAST.length)];
    const first = male
      ? MALE_FIRST[Math.floor(rand() * MALE_FIRST.length)]
      : FEMALE_FIRST[Math.floor(rand() * FEMALE_FIRST.length)];
    const patr = PATRONYMIC_BASE[Math.floor(rand() * PATRONYMIC_BASE.length)];
    const lastName = male ? last : `${last}а`;
    names.add(`${lastName} ${first} ${patr}${male ? 'ич' : 'на'}`);
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'ru'));
}

async function resetDatabase(prisma: PrismaClient) {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
  log('База данных очищена');
}

interface ProgramRefs {
  programId: string;
  admissionYear: number;
  semesters: Map<number, { id: string; academicYearId: string; start: string; end: string }>;
  itemBySemester: Map<string, string>;
  groupId: string;
  groupCode: string;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const force = process.argv.includes('--reset') || process.env.SEED_RESET === 'true';
  const existing = await prisma.organization.count();
  if (existing > 0 && !force) {
    log('База данных уже содержит данные — заполнение пропущено (для пересоздания: npm run seed -- --reset)');
    await app.close();
    return;
  }
  if (existing > 0) await resetDatabase(prisma);

  const today = todayInTimezone(ORGANIZATION.timezone);
  log(`Текущая дата: ${today}`);

  // ------------------------------------------------------------------ организация и настройки
  const org = await prisma.organization.create({ data: ORGANIZATION });
  await prisma.organizationSettings.create({ data: { organizationId: org.id } });
  await prisma.lessonTime.createMany({
    data: DEFAULT_LESSON_TIMES.map((t) => ({ ...t, organizationId: org.id })),
  });
  const settings = await prisma.organizationSettings.findUniqueOrThrow({ where: { organizationId: org.id } });

  // ------------------------------------------------------------------ преподаватели и аудитории
  const teacherIds = new Map<string, string>();
  for (const t of TEACHERS) {
    const created = await prisma.teacher.create({
      data: {
        organizationId: org.id,
        fullName: t.fullName,
        department: t.department,
        position: t.position,
        email: t.email,
        maxWeeklyLessons: t.maxWeeklyLessons,
        maxDailyLessons: t.maxDailyLessons,
        preferredStartLesson: t.preferredStartLesson,
        preferredEndLesson: t.preferredEndLesson,
      },
    });
    teacherIds.set(t.key, created.id);
    const rows: Prisma.TeacherAvailabilityCreateManyInput[] = [];
    for (const u of t.unavailable) {
      for (const lesson of u.lessons) {
        rows.push({
          teacherId: created.id,
          weekday: u.weekday,
          lessonNumber: lesson,
          isAvailable: false,
          reason: u.reason,
        });
      }
    }
    for (const p of t.preferences ?? []) {
      if (!rows.some((r) => r.weekday === p.weekday && r.lessonNumber === p.lesson)) {
        rows.push({
          teacherId: created.id,
          weekday: p.weekday,
          lessonNumber: p.lesson,
          isAvailable: true,
          preferenceWeight: p.weight,
          reason: 'Нежелательное время',
        });
      }
    }
    if (rows.length) await prisma.teacherAvailability.createMany({ data: rows });
  }
  const roomIds = new Map<string, string>();
  for (const c of CLASSROOMS) {
    const created = await prisma.classroom.create({
      data: {
        organizationId: org.id,
        code: c.code,
        name: c.name,
        building: c.building,
        floor: c.floor,
        capacity: c.capacity,
        classroomType: c.classroomType,
        equipmentJson: c.equipment as Prisma.InputJsonValue,
      },
    });
    roomIds.set(c.code, created.id);
    const rows: Prisma.ClassroomAvailabilityCreateManyInput[] = [];
    for (const u of c.unavailable ?? []) {
      for (const lesson of u.lessons)
        rows.push({
          classroomId: created.id,
          weekday: u.weekday,
          lessonNumber: lesson,
          isAvailable: false,
          reason: u.reason,
        });
    }
    if (rows.length) await prisma.classroomAvailability.createMany({ data: rows });
  }
  log(`Преподавателей: ${TEACHERS.length}, аудиторий: ${CLASSROOMS.length}`);

  // ------------------------------------------------------------------ специальность и учебные планы
  const specialty = await prisma.specialty.create({
    data: { ...SPECIALTY, fgosDate: parseDate(SPECIALTY.fgosDate) },
  });

  const month = Number(today.slice(5, 7));
  const academicStart = month >= 7 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  // «Живая» группа — второй курс текущего учебного года (её расписание идёт сейчас)
  const liveAdmission = academicStart - 1;
  const cohorts = [
    { admissionYear: 2024, groupCode: 'ИСП-24-1', students: 25, seed: 2024 },
    ...(liveAdmission !== 2024
      ? [
          {
            admissionYear: liveAdmission,
            groupCode: `ИСП-${String(liveAdmission).slice(2)}-1`,
            students: 24,
            seed: liveAdmission,
          },
        ]
      : []),
  ];

  const programs: ProgramRefs[] = [];
  for (const cohort of cohorts) {
    programs.push(
      await createProgram(
        prisma,
        org.id,
        specialty.id,
        cohort,
        teacherIds,
        settings.academicHoursPerLesson,
        today,
      ),
    );
  }

  // ------------------------------------------------------------------ календарь: праздники организации
  const years = new Set<number>();
  for (const p of programs) for (let y = p.admissionYear; y <= p.admissionYear + 4; y++) years.add(y);
  const holidayRows: Prisma.CalendarEventCreateManyInput[] = [];
  for (const y of [...years].sort()) {
    for (const h of HOLIDAY_FIXED) {
      holidayRows.push({
        organizationId: org.id,
        eventType: CalendarEventType.HOLIDAY,
        title: h.title,
        startDate: parseDate(`${y}-${h.md}`),
        endDate: parseDate(`${y}-${h.md}`),
        blocksSchedule: true,
      });
    }
    for (const t of HOLIDAY_TRANSFERS[y] ?? []) {
      holidayRows.push({
        organizationId: org.id,
        eventType: CalendarEventType.HOLIDAY,
        title: t.title,
        startDate: parseDate(t.date),
        endDate: parseDate(t.date),
        blocksSchedule: true,
      });
    }
  }
  await prisma.calendarEvent.createMany({ data: holidayRows });
  // Недоступность преподавателя по датам (курсы повышения квалификации)
  const main = programs[programs.length - 1];
  const sem = main.semesters.get(3)!;
  await prisma.calendarEvent.create({
    data: {
      organizationId: org.id,
      teacherId: teacherIds.get('sidorova')!,
      eventType: CalendarEventType.OTHER,
      title: 'Курсы повышения квалификации (Сидорова Е.В.)',
      startDate: parseDate(addDaysStr(sem.start, 49)),
      endDate: parseDate(addDaysStr(sem.start, 53)),
      blocksSchedule: true,
    },
  });

  // ------------------------------------------------------------------ пользователи
  const hash = (p: string) => bcrypt.hash(p, 10);
  const admin = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: DEMO_USERS.admin.email,
      fullName: DEMO_USERS.admin.fullName,
      role: UserRole.ADMIN,
      passwordHash: await hash(DEMO_USERS.admin.password),
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org.id,
      email: DEMO_USERS.dispatcher.email,
      fullName: DEMO_USERS.dispatcher.fullName,
      role: UserRole.DISPATCHER,
      passwordHash: await hash(DEMO_USERS.dispatcher.password),
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org.id,
      email: DEMO_USERS.teacher.email,
      fullName: TEACHERS.find((t) => t.key === 'petrov')!.fullName,
      role: UserRole.TEACHER,
      teacherId: teacherIds.get('petrov'),
      passwordHash: await hash(DEMO_USERS.teacher.password),
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org.id,
      email: DEMO_USERS.student.email,
      fullName: DEMO_USERS.student.fullName,
      role: UserRole.STUDENT,
      studentGroupId: main.groupId,
      passwordHash: await hash(DEMO_USERS.student.password),
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org.id,
      email: DEMO_USERS.manager.email,
      fullName: DEMO_USERS.manager.fullName,
      role: UserRole.MANAGER,
      passwordHash: await hash(DEMO_USERS.manager.password),
    },
  });
  const actor: AuthUser = {
    id: admin.id,
    email: admin.email,
    fullName: admin.fullName,
    role: UserRole.ADMIN,
    organizationId: org.id,
    teacherId: null,
    studentGroupId: null,
  };
  log('Пользователи созданы');

  // ------------------------------------------------------------------ демо-расписания
  const periodsService = app.get(SchedulePeriodsService);
  const runner = app.get(GenerationRunnerService);
  const generation = app.get(GenerationService);
  const calendar = app.get(CalendarService);

  const generate = async (
    program: ProgramRefs,
    semesterNumber: number,
    publish: boolean,
    groupIds?: string[],
  ) => {
    const s = program.semesters.get(semesterNumber)!;
    const period = await periodsService.create(
      {
        semesterId: s.id,
        title: `${program.groupCode.replace(/-\d+$/, '')}: ${semesterNumber} семестр (${s.start.slice(0, 4)})`,
      },
      actor,
    );
    const job = await prisma.scheduleGenerationJob.create({
      data: {
        schedulePeriodId: period.id,
        createdByUserId: actor.id,
        mode: GenerationMode.CALENDAR,
        status: GenerationJobStatus.QUEUED,
        paramsJson: {
          mode: 'CALENDAR',
          solver: 'heuristic',
          groupIds: groupIds ?? [program.groupId],
          timeLimitSeconds: 60,
        },
      },
    });
    await runner.run(job.id);
    const finished = await prisma.scheduleGenerationJob.findUniqueOrThrow({ where: { id: job.id } });
    log(`Генерация «${period.title}»: ${finished.message}`);
    if (finished.status === GenerationJobStatus.FAILED) throw new Error(finished.error ?? 'Ошибка генерации');
    const applied = await generation.apply(job.id, actor);
    log(
      `  применено занятий: ${applied.created}, ошибок проверки: ${applied.validation.errors}, предупреждений: ${applied.validation.warnings}`,
    );
    if (publish) {
      try {
        await periodsService.publish(period.id, actor);
        log('  расписание опубликовано');
      } catch (e) {
        log(`  не удалось опубликовать: ${(e as Error).message}`);
      }
    }
    return period.id;
  };

  const lessonsService = app.get(ScheduleLessonsService);
  const makeupService = app.get(MakeupTasksService);

  /** Отметки о проведении прошедших занятий, несколько отмен, отработка и замена */
  const markHistory = async (periodId: string, upTo: string, seed: number) => {
    const rand = rng(seed);
    const lessons = await prisma.scheduleLesson.findMany({
      where: { schedulePeriodId: periodId, date: { lte: parseDate(upTo) }, status: LessonStatus.PLANNED },
      orderBy: [{ date: 'asc' }, { lessonNumber: 'asc' }],
    });
    let conducted = 0;
    let cancelled = 0;
    let substituted = 0;
    let partial = 0;
    const cancelledIds: string[] = [];
    const forcedCancel = Math.floor(lessons.length * 0.6);
    for (const [index, l] of lessons.entries()) {
      const r = rand();
      try {
        if ((r < 0.025 || (cancelled === 0 && index === forcedCancel)) && cancelled < 4) {
          const reason =
            cancelled % 2 === 0 ? CancellationReason.TEACHER_ABSENT : CancellationReason.GROUP_ABSENT;
          await lessonsService.cancel(
            l.id,
            {
              reason,
              notes:
                reason === CancellationReason.TEACHER_ABSENT ? 'Больничный' : 'Участие группы в олимпиаде',
            },
            actor,
          );
          cancelled++;
          cancelledIds.push(l.id);
          continue;
        }
        if (r > 0.985 && substituted < 2 && l.lessonType === LessonType.LECTURE) {
          const substitute = [...teacherIds.values()].find(
            (id) => id !== l.teacherId && id === teacherIds.get('novikova'),
          );
          if (substitute) {
            try {
              await lessonsService.substitute(
                l.id,
                { substituteTeacherId: substitute, reason: 'Командировка преподавателя' },
                actor,
              );
              substituted++;
            } catch {
              /* заменяющий занят — пропускаем */
            }
          }
        }
        const isPartial = partial < 1 && r > 0.5 && r < 0.51 && l.academicHours === 2;
        await lessonsService.markConducted(
          l.id,
          {
            status: 'CONDUCTED',
            actualHours: isPartial ? 1 : undefined,
            notes: isPartial ? 'Проведено частично: учебная тревога' : undefined,
          },
          actor,
        );
        if (isPartial) partial++;
        conducted++;
      } catch (e) {
        log(`  пропуск занятия ${toDateStr(l.date)}: ${(e as Error).message}`);
      }
    }
    // Отработка первой отмены — ставим в ближайший свободный слот
    const tasks = await prisma.makeupTask.findMany({
      where: { sourceLessonId: { in: cancelledIds } },
      orderBy: { createdAt: 'asc' },
    });
    if (tasks[0]) {
      const source = await prisma.scheduleLesson.findUniqueOrThrow({
        where: { id: tasks[0].sourceLessonId },
      });
      const slots = await makeupService.freeSlots(tasks[0].id, actor, {
        from: addDaysStr(toDateStr(source.date), 1),
      });
      const slot = slots.find((s) => s.classroomId) ?? slots[0];
      if (slot) {
        const res = await makeupService.schedule(
          tasks[0].id,
          { date: slot.date, lessonNumber: slot.lessonNumber, classroomId: slot.classroomId ?? undefined },
          actor,
        );
        if (slot.date <= upTo)
          await lessonsService.markConducted(res.lesson.id, { status: 'CONDUCTED' }, actor);
        log(`  отработка поставлена на ${slot.date}, ${slot.lessonNumber} пара`);
      }
    }
    log(
      `  отмечено проведённых: ${conducted}, отменено: ${cancelled}, замен: ${substituted}, частично: ${partial}`,
    );
  };

  // 1) ИСП-24-1: 3 семестр — сгенерирован, опубликован, с фактическими отметками
  const a = programs[0];
  const a3 = a.semesters.get(3)!;
  const period3 = await generate(a, 3, true);
  await markHistory(period3, today < a3.end ? addDaysStr(today, -1) : a3.end, 11);
  await calendar.autoPlaceAssessments({ semesterId: a3.id, studentGroupId: a.groupId }, actor);

  // 2) ИСП-24-1: 4 семестр — период создан, расписание не сгенерировано (для демонстрации автосоставления)
  const a4 = a.semesters.get(4)!;
  await periodsService.create(
    { semesterId: a4.id, title: `ИСП-24: 4 семестр (${a4.start.slice(0, 4)})` },
    actor,
  );

  // 3) «Живая» группа текущего учебного года
  if (programs.length > 1) {
    const b = programs[1];
    const current = [...b.semesters.entries()].find(([, s]) => today >= s.start && today <= s.end)?.[0] ?? 3;
    const bs = b.semesters.get(current)!;
    const periodLive = await generate(b, current, true);
    if (today > bs.start) await markHistory(periodLive, addDaysStr(today, -1), 21);
    await calendar.autoPlaceAssessments({ semesterId: bs.id, studentGroupId: b.groupId }, actor);
  }

  log('Готово. Учётные записи:');
  for (const [role, u] of Object.entries(DEMO_USERS)) log(`  ${role}: ${u.email} / ${u.password}`);
  await app.close();
}

async function createProgram(
  prisma: PrismaClient,
  organizationId: string,
  specialtyId: string,
  cohort: { admissionYear: number; groupCode: string; students: number; seed: number },
  teacherIds: Map<string, string>,
  academicHoursPerLesson: number,
  today: string,
): Promise<ProgramRefs> {
  const Y = cohort.admissionYear;
  const program = await prisma.educationalProgram.create({
    data: {
      organizationId,
      specialtyId,
      title: `09.02.07 ИСиП (программист), набор ${Y}`,
      admissionYear: Y,
      studyForm: StudyForm.FULL_TIME,
      durationMonths: 46,
      totalSemesters: 8,
      status: ProgramStatus.APPROVED,
    },
  });
  const yearIds: string[] = [];
  for (let i = 0; i < 4; i++) {
    const y = await prisma.academicYear.create({
      data: {
        educationalProgramId: program.id,
        title: `${Y + i}–${Y + i + 1}`,
        courseNumber: i + 1,
        startDate: parseDate(`${Y + i}-09-01`),
        endDate: parseDate(`${Y + i + 1}-08-31`),
      },
    });
    yearIds.push(y.id);
  }
  const semesters = new Map<number, { id: string; academicYearId: string; start: string; end: string }>();
  const events: Prisma.CalendarEventCreateManyInput[] = [];
  for (const plan of semesterPlans()) {
    const year = Y + plan.yearOffset;
    const start = `${year}-${plan.start}`;
    const end = `${year}-${plan.end}`;
    const academicYearId = yearIds[plan.course - 1];
    const s = await prisma.semester.create({
      data: {
        educationalProgramId: program.id,
        academicYearId,
        number: plan.number,
        courseNumber: plan.course,
        startDate: parseDate(start),
        endDate: parseDate(end),
        theoreticalWeeks: plan.theoreticalWeeks,
        examWeeks: plan.examWeeks,
        vacationWeeks: plan.vacationWeeks,
        practiceWeeks: plan.practiceWeeks,
      },
    });
    semesters.set(plan.number, { id: s.id, academicYearId, start, end });
    for (const p of plan.periods) {
      const endYear = year + (p.yearShift ?? 0);
      events.push({
        organizationId,
        educationalProgramId: program.id,
        semesterId: s.id,
        eventType: p.type,
        title: p.title,
        startDate: parseDate(`${year}-${p.start}`),
        endDate: parseDate(`${endYear}-${p.end}`),
        blocksSchedule: defaultBlocksSchedule(p.type),
      });
    }
  }
  await prisma.calendarEvent.createMany({ data: events });

  // Циклы и элементы плана
  const cycleIds = new Map<string, string>();
  for (const c of CYCLES) {
    const created = await prisma.curriculumCycle.create({ data: { educationalProgramId: program.id, ...c } });
    cycleIds.set(c.code, created.id);
  }
  const itemIds = new Map<string, string>();
  const itemBySemester = new Map<string, string>();
  let order = 0;
  for (const item of CURRICULUM) {
    const created = await prisma.curriculumItem.create({
      data: {
        educationalProgramId: program.id,
        cycleId: cycleIds.get(item.cycle)!,
        parentItemId: item.parent ? itemIds.get(item.parent) : null,
        code: item.code,
        name: item.name,
        itemType: item.itemType,
        isDifficult: item.isDifficult ?? false,
        sortOrder: order++,
      },
    });
    itemIds.set(item.code, created.id);
    for (const sh of item.semesters) {
      const hours = {
        lectureHours: sh.lecture ?? 0,
        practicalHours: sh.practical ?? 0,
        laboratoryHours: sh.laboratory ?? 0,
        consultationHours: sh.consultation ?? 0,
        selfStudyHours: sh.selfStudy ?? 0,
        assessmentHours: sh.assessment ?? 0,
        practiceHours: sh.practice ?? 0,
      };
      const sum = Object.values(hours).reduce((x, y) => x + y, 0);
      const semItem = await prisma.semesterCurriculumItem.create({
        data: {
          curriculumItemId: created.id,
          semesterId: semesters.get(sh.semester)!.id,
          ...hours,
          totalHours: sh.total ?? sum,
          controlForm: sh.control,
          practiceAtCollege: sh.practiceAtCollege ?? false,
          lectureRoomTypes: (sh.lectureRoomTypes ?? []) as ClassroomType[],
          practicalRoomTypes: (sh.practicalRoomTypes ?? []) as ClassroomType[],
          laboratoryRoomTypes: (sh.laboratoryRoomTypes ?? []) as ClassroomType[],
          practiceRoomTypes: (sh.practiceRoomTypes ?? []) as ClassroomType[],
          ...computePlannedLessons(hours, academicHoursPerLesson),
        },
      });
      itemBySemester.set(`${item.code}#${sh.semester}`, semItem.id);
    }
  }

  // Группа, подгруппы, студенты
  const currentCourse = Math.min(
    4,
    Math.max(1, Number(today.slice(0, 4)) - Y + (Number(today.slice(5, 7)) >= 7 ? 1 : 0)),
  );
  const currentSemester =
    [...semesters.entries()].find(([, s]) => today >= s.start && today <= s.end)?.[0] ??
    currentCourse * 2 - 1;
  const group = await prisma.studentGroup.create({
    data: {
      educationalProgramId: program.id,
      code: cohort.groupCode,
      title: `Информационные системы и программирование, набор ${Y}, группа 1`,
      admissionYear: Y,
      courseNumber: currentCourse,
      currentSemesterNumber: Math.min(8, currentSemester),
      studentCount: cohort.students,
      subgroupCount: 2,
    },
  });
  const names = studentNames(cohort.students, cohort.seed);
  const half = Math.ceil(names.length / 2);
  const sg1 = await prisma.subgroup.create({
    data: {
      studentGroupId: group.id,
      number: 1,
      name: 'Подгруппа 1 (иностранный язык, лабораторные)',
      studentCount: half,
    },
  });
  const sg2 = await prisma.subgroup.create({
    data: {
      studentGroupId: group.id,
      number: 2,
      name: 'Подгруппа 2 (иностранный язык, лабораторные)',
      studentCount: names.length - half,
    },
  });
  await prisma.student.createMany({
    data: names.map((fullName, i) => ({
      studentGroupId: group.id,
      subgroupId: i < half ? sg1.id : sg2.id,
      fullName,
      recordBookNumber: `${String(Y).slice(2)}-${String(i + 1).padStart(3, '0')}`,
    })),
  });

  // Нагрузка
  for (const item of CURRICULUM) {
    for (const sh of item.semesters) {
      const semItemId = itemBySemester.get(`${item.code}#${sh.semester}`)!;
      for (const as of item.assignments ?? []) {
        await prisma.groupCurriculumAssignment.create({
          data: {
            studentGroupId: group.id,
            semesterCurriculumItemId: semItemId,
            lessonType: (as.lessonType ?? null) as LessonType | null,
            subgroupNumber: as.subgroup ?? null,
            teacherId: teacherIds.get(as.teacher) ?? null,
            weeklyLessonTarget: as.weeklyLessonTarget ?? null,
          },
        });
      }
    }
  }
  log(`Учебный план «${program.title}», группа ${group.code}: ${names.length} студентов, 2 подгруппы`);
  return {
    programId: program.id,
    admissionYear: Y,
    semesters,
    itemBySemester,
    groupId: group.id,
    groupCode: group.code,
  };
}

main().catch((e) => {
  console.error('[seed] Ошибка:', e);
  process.exit(1);
});
