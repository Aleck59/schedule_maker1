import { Injectable } from '@nestjs/common';
import { CalendarEventType, LessonStatus, SchedulePeriodStatus, Severity } from '@prisma/client';
import { AuthUser } from '../common/types/auth-user';
import { PlanningService } from '../planning/planning.service';
import { PrismaService } from '../prisma/prisma.service';

export interface SetupStep {
  key: string;
  title: string;
  description: string;
  done: boolean;
  /** Необязательный шаг: не мешает переходу к следующим */
  optional: boolean;
  /** Что сделано / что осталось */
  status: string;
  /** Страница интерфейса, где выполняется шаг */
  link: string;
  action: string;
}

/**
 * Мастер настройки: состояние каждого шага подготовки расписания
 * (от настроек колледжа до публикации) и следующий шаг для администратора.
 */
@Injectable()
export class SetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planning: PlanningService,
  ) {}

  async status(actor: AuthUser) {
    const org = actor.organizationId;
    const [
      settings,
      lessonTimes,
      programs,
      programsWithEvents,
      groups,
      teachers,
      rooms,
      periods,
      published,
      lastPeriod,
      rulesOrGrid,
    ] = await Promise.all([
      this.prisma.organizationSettings.findUnique({ where: { organizationId: org } }),
      this.prisma.lessonTime.count({ where: { organizationId: org } }),
      this.prisma.educationalProgram.findMany({
        where: { organizationId: org, status: { not: 'ARCHIVED' } },
        select: { id: true, title: true, _count: { select: { items: true, semesters: true } } },
      }),
      this.prisma.calendarEvent.groupBy({
        by: ['educationalProgramId'],
        where: {
          organizationId: org,
          educationalProgramId: { not: null },
          eventType: { in: [CalendarEventType.EXAM_SESSION, CalendarEventType.VACATION] },
        },
      }),
      this.prisma.studentGroup.findMany({
        where: { program: { organizationId: org }, isActive: true },
        select: { id: true, educationalProgramId: true, currentSemesterNumber: true },
      }),
      this.prisma.teacher.count({ where: { organizationId: org, isActive: true } }),
      this.prisma.classroom.count({ where: { organizationId: org, isActive: true } }),
      this.prisma.schedulePeriod.findMany({
        where: { organizationId: org },
        select: {
          id: true,
          status: true,
          _count: { select: { lessons: { where: { status: LessonStatus.PLANNED } } } },
        },
      }),
      this.prisma.schedulePeriod.count({
        where: { organizationId: org, status: SchedulePeriodStatus.PUBLISHED },
      }),
      this.prisma.schedulePeriod.findFirst({
        where: { organizationId: org, lessons: { some: {} } },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, title: true, status: true },
      }),
      this.prisma.teacher.count({
        where: {
          organizationId: org,
          OR: [{ availability: { some: {} } }, { availabilityRules: { some: {} } }],
        },
      }),
    ]);

    // Нагрузка: потоки текущих семестров групп без преподавателя
    let streams = 0;
    let unassigned = 0;
    if (groups.length) {
      const semesters = await this.prisma.semester.findMany({
        where: {
          OR: groups.map((g) => ({
            educationalProgramId: g.educationalProgramId,
            number: g.currentSemesterNumber,
          })),
        },
        select: { id: true },
      });
      if (semesters.length) {
        const list = await this.planning.getStreams({
          organizationId: org,
          semesterIds: semesters.map((s) => s.id),
          groupIds: groups.map((g) => g.id),
        });
        const scheduled = list.filter((s) => s.plannedLessons > 0);
        streams = scheduled.length;
        unassigned = scheduled.filter((s) => !s.teacherId).length;
      }
    }
    const errors = lastPeriod
      ? await this.prisma.validationResult.count({
          where: { schedulePeriodId: lastPeriod.id, severity: Severity.ERROR },
        })
      : 0;
    const checked = lastPeriod
      ? (await this.prisma.validationResult.count({ where: { schedulePeriodId: lastPeriod.id } })) > 0 ||
        lastPeriod.status === SchedulePeriodStatus.PUBLISHED
      : false;
    const programsWithItems = programs.filter((p) => p._count.items > 0);
    const eventPrograms = new Set(programsWithEvents.map((e) => e.educationalProgramId));
    const withoutCalendar = programsWithItems.filter((p) => !eventPrograms.has(p.id));
    const generated = periods.filter((p) => p._count.lessons > 0);

    const steps: SetupStep[] = [
      {
        key: 'settings',
        title: 'Настройки колледжа',
        description:
          'Расписание звонков, рабочие дни недели, количество пар в день, длительность пары в академических часах.',
        done: !!settings && lessonTimes > 0,
        optional: false,
        status: lessonTimes
          ? `Звонков: ${lessonTimes}, пар в день: ${settings?.lessonsPerDay ?? '—'}`
          : 'Не заданы',
        link: '/settings',
        action: 'Проверить настройки',
      },
      {
        key: 'curriculum',
        title: 'Учебный план',
        description:
          'Загрузите скан учебного плана — система сама создаст специальность, семестры, дисциплины с часами и календарный график.',
        done: programsWithItems.length > 0,
        optional: false,
        status: programsWithItems.length
          ? `Учебных планов: ${programsWithItems.length}`
          : programs.length
            ? 'План создан, но в нём нет дисциплин'
            : 'Учебных планов нет',
        link: programsWithItems.length ? '/programs' : '/programs/import',
        action: programsWithItems.length ? 'Открыть учебные планы' : 'Загрузить скан плана',
      },
      {
        key: 'calendar',
        title: 'Календарный учебный график',
        description: 'Сессии, каникулы, практики и праздники: в эти даты обычные занятия не ставятся.',
        done: programsWithItems.length > 0 && withoutCalendar.length === 0,
        optional: false,
        status: withoutCalendar.length
          ? `Без графика: ${withoutCalendar.map((p) => p.title).join(', ')}`
          : programsWithItems.length
            ? 'График заполнен для всех планов'
            : 'Сначала создайте учебный план',
        link: '/calendar',
        action: 'Открыть календарный график',
      },
      {
        key: 'groups',
        title: 'Учебные группы',
        description: 'Группы, их численность и подгруппы (для лабораторных и иностранного языка).',
        done: groups.length > 0,
        optional: false,
        status: groups.length ? `Активных групп: ${groups.length}` : 'Групп нет',
        link: '/groups',
        action: 'Открыть группы',
      },
      {
        key: 'teachers',
        title: 'Преподаватели',
        description:
          'Список преподавателей, лимиты пар в день и неделю, доступность и гибкие правила (онлайн, недели месяца).',
        done: teachers > 0,
        optional: false,
        status: teachers
          ? `Преподавателей: ${teachers}${rulesOrGrid ? `, с указанной доступностью: ${rulesOrGrid}` : ''}`
          : 'Преподавателей нет',
        link: '/teachers',
        action: 'Открыть преподавателей',
      },
      {
        key: 'classrooms',
        title: 'Аудитории',
        description: 'Аудитории с типом (компьютерный класс, лаборатория, спортзал, онлайн) и вместимостью.',
        done: rooms > 0,
        optional: false,
        status: rooms ? `Аудиторий: ${rooms}` : 'Аудиторий нет',
        link: '/classrooms',
        action: 'Открыть аудитории',
      },
      {
        key: 'workload',
        title: 'Нагрузка преподавателей',
        description: 'Назначьте преподавателя на каждую дисциплину и вид занятий текущего семестра групп.',
        done: streams > 0 && unassigned === 0,
        optional: false,
        status: streams
          ? unassigned
            ? `Без преподавателя: ${unassigned} из ${streams}`
            : `Назначено: ${streams} из ${streams}`
          : 'Нет дисциплин в текущих семестрах групп',
        link: '/workload',
        action: 'Назначить преподавателей',
      },
      {
        key: 'generation',
        title: 'Автосоставление расписания',
        description: 'Создайте период расписания и запустите автоматическое составление.',
        done: generated.length > 0,
        optional: false,
        status: generated.length
          ? `Периодов с расписанием: ${generated.length}`
          : 'Расписание ещё не составлено',
        link: '/generation',
        action: 'Составить расписание',
      },
      {
        key: 'validation',
        title: 'Проверка и устранение конфликтов',
        description: 'Проверьте расписание: система покажет конфликты и предложит, как их исправить.',
        done: !!lastPeriod && checked && errors === 0,
        optional: false,
        status: !lastPeriod
          ? 'Нет расписания для проверки'
          : !checked
            ? `«${lastPeriod.title}» ещё не проверялось`
            : errors
              ? `«${lastPeriod.title}»: ошибок ${errors}`
              : `«${lastPeriod.title}»: ошибок нет`,
        link: lastPeriod ? `/schedule?period=${lastPeriod.id}` : '/schedule',
        action: errors ? 'Исправить конфликты' : 'Открыть расписание',
      },
      {
        key: 'publish',
        title: 'Публикация',
        description:
          'Опубликованное расписание видят студенты и преподаватели; изменения приходят им в уведомлениях.',
        done: published > 0,
        optional: false,
        status: published ? `Опубликовано периодов: ${published}` : 'Расписание не опубликовано',
        link: lastPeriod ? `/schedule?period=${lastPeriod.id}` : '/schedule',
        action: 'Опубликовать',
      },
    ];
    const next = steps.find((s) => !s.done && !s.optional) ?? null;
    return {
      steps,
      completed: steps.filter((s) => s.done).length,
      total: steps.length,
      next: next?.key ?? null,
    };
  }
}
