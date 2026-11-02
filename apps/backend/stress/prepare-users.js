#!/usr/bin/env node
/**
 * Подготовка базы к нагрузочному тесту: создаёт тестовые учётные записи
 * студентов, преподавателей и администраторов с одним паролем.
 *
 *   STRESS_CONFIRM=yes node stress/prepare-users.js [--students 1000] [--teachers 25] [--admins 3] [--publish]
 *   STRESS_CONFIRM=yes node stress/prepare-users.js --cleanup
 *
 * Запускайте ТОЛЬКО на копии базы: скрипт пишет в таблицу users, а с --publish
 * публикует черновики расписания (иначе студенты не видят занятий).
 * Все созданные записи имеют адрес *@stress.local и удаляются через --cleanup.
 */
const { PrismaClient, UserRole } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const DOMAIN = 'stress.local';
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? Number(args[i + 1]) : def;
};
const flag = (name) => args.includes(`--${name}`);

async function main() {
  if (process.env.STRESS_CONFIRM !== 'yes') {
    console.error('Скрипт меняет данные. Запускайте на копии базы с STRESS_CONFIRM=yes');
    console.error(`База: ${(process.env.DATABASE_URL ?? '').replace(/\/\/[^@]*@/, '//***@')}`);
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const removed = await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
    if (flag('cleanup')) {
      console.log(`Удалено тестовых учётных записей: ${removed.count}`);
      return;
    }
    const students = opt('students', 1000);
    const teachers = opt('teachers', 25);
    const admins = opt('admins', 3);
    const password = process.env.STRESS_PASSWORD ?? 'Stress123!';
    const passwordHash = await bcrypt.hash(password, 10);

    const org = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!org) throw new Error('В базе нет организации');

    // Группы и преподаватели, у которых есть занятия, — чтобы просмотр не был пустым
    const groupRows = await prisma.scheduleLesson.groupBy({ by: ['studentGroupId'], _count: { _all: true } });
    const groupIds = groupRows.map((g) => g.studentGroupId).filter(Boolean);
    if (!groupIds.length) throw new Error('В расписании нет занятий: сначала составьте расписание');

    const linked = new Set(
      (await prisma.user.findMany({ where: { teacherId: { not: null } }, select: { teacherId: true } })).map(
        (u) => u.teacherId,
      ),
    );
    const teacherRows = await prisma.scheduleLesson.groupBy({
      by: ['teacherId'],
      where: { teacherId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { teacherId: 'desc' } },
    });
    const teacherIds = teacherRows
      .map((t) => t.teacherId)
      .filter((id) => id && !linked.has(id))
      .slice(0, teachers);
    if (teacherIds.length < teachers) {
      console.warn(
        `Преподавателей с занятиями без учётной записи: ${teacherIds.length} (запрошено ${teachers})`,
      );
    }

    const pad = (n) => String(n).padStart(4, '0');
    const data = [];
    for (let i = 0; i < students; i++) {
      data.push({
        organizationId: org.id,
        fullName: `Нагрузочный студент ${pad(i)}`,
        email: `student-${pad(i)}@${DOMAIN}`,
        passwordHash,
        role: UserRole.STUDENT,
        studentGroupId: groupIds[i % groupIds.length],
      });
    }
    teacherIds.forEach((teacherId, i) =>
      data.push({
        organizationId: org.id,
        fullName: `Нагрузочный преподаватель ${pad(i)}`,
        email: `teacher-${pad(i)}@${DOMAIN}`,
        passwordHash,
        role: UserRole.TEACHER,
        teacherId,
      }),
    );
    for (let i = 0; i < admins; i++) {
      data.push({
        organizationId: org.id,
        fullName: `Нагрузочный администратор ${pad(i)}`,
        email: `admin-${pad(i)}@${DOMAIN}`,
        passwordHash,
        role: UserRole.ADMIN,
      });
    }
    const created = await prisma.user.createMany({ data });
    console.log(
      `Создано учётных записей: ${created.count} (студентов ${students} в ${Math.min(students, groupIds.length)} группах, ` +
        `преподавателей ${teacherIds.length}, администраторов ${admins}). Пароль: ${password}`,
    );

    if (flag('publish')) {
      const res = await prisma.schedulePeriod.updateMany({
        where: { organizationId: org.id, status: { in: ['DRAFT', 'GENERATED'] } },
        data: { status: 'PUBLISHED' },
      });
      console.log(`Опубликовано периодов расписания: ${res.count}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
