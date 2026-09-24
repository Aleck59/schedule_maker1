import { SolverDemand, SolverProblem, SolverResult, UnplacedReason } from './solver.types';

export interface DiagnosticReason {
  code: UnplacedReason;
  message: string;
}

/** Рекомендации по устранению причин */
export const SUGGESTIONS: Record<UnplacedReason, string> = {
  NO_TEACHER: 'Назначьте преподавателя в разделе «Нагрузка»',
  TEACHER_INACTIVE: 'Назначьте другого преподавателя (текущий неактивен)',
  NO_SUITABLE_ROOM:
    'Увеличьте число доступных аудиторий нужного типа и вместимости или разрешите другой тип аудитории для дисциплины',
  NO_AVAILABLE_DAYS: 'Перенесите практику или измените календарный период (нет доступных учебных дней)',
  NO_PRACTICE_PERIOD: 'Добавьте период практики для группы в календарный учебный график',
  TEACHER_UNAVAILABLE: 'Измените доступность преподавателя или назначьте другого преподавателя',
  TEACHER_BUSY: 'Назначьте другого преподавателя или увеличьте лимит пар преподавателя в день/неделю',
  TEACHER_LIMIT: 'Увеличьте лимит пар преподавателя в день или в неделю',
  GROUP_BUSY: 'Разрешите вечернюю пару (увеличьте число пар в день) или разрешите занятие в другой день',
  ROOM_SHORTAGE: 'Увеличьте число доступных аудиторий нужного типа или освободите аудитории',
  DAILY_LIMITS: 'Ослабьте ограничения: пар одной дисциплины в день, окна, поздние пары',
  NOT_ENOUGH_TIME: 'Увеличьте период генерации или лимит времени генератора, ослабьте ограничение по окнам',
};

interface Funnel {
  total: number;
  teacherAvailable: number;
  teacherFree: number;
  teacherWithinLimits: number;
  groupFree: number;
  disciplineOk: number;
  roomFree: number;
}

/**
 * Объяснение причин, по которым занятия не удалось поставить:
 * «воронка» слотов — сколько допустимых слотов отсекает каждое ограничение.
 */
export function diagnoseDemand(
  problem: SolverProblem,
  result: SolverResult,
  demand: SolverDemand,
  unplacedCount: number,
) {
  const reasons: DiagnosticReason[] = [];
  const teacher = problem.teachers.find((t) => t.id === demand.teacherId);
  if (!teacher) {
    reasons.push({ code: 'NO_TEACHER', message: 'Преподаватель не назначен' });
    return { reasons, funnel: null };
  }
  if (demand.roomIds.length === 0) {
    reasons.push({
      code: 'NO_SUITABLE_ROOM',
      message: `Нет аудиторий подходящего типа вместимостью от ${demand.size} мест`,
    });
    return { reasons, funnel: null };
  }

  // Разрешённые даты
  let allowed = null as Set<string> | null;
  if (demand.allowedDates) {
    allowed = new Set(demand.allowedDates);
  } else {
    for (const gId of demand.groupIds) {
      const g = problem.groups.find((x) => x.id === gId);
      const gs = new Set(g?.allowedDates ?? []);
      allowed = allowed ? new Set([...allowed].filter((x) => gs.has(x))) : gs;
    }
  }
  const blocked = new Set(teacher.blockedDates);
  const allowedDays = problem.days.filter((d) => allowed?.has(d.date) && !blocked.has(d.date));
  if (allowedDays.length === 0) {
    if (demand.lessonType === 'PRACTICE') {
      reasons.push({
        code: 'NO_PRACTICE_PERIOD',
        message: 'В календарном графике нет периода практики для группы',
      });
    } else {
      reasons.push({
        code: 'NO_AVAILABLE_DAYS',
        message:
          'В выбранном интервале нет учебных дней: каникулы, практика, сессия или недоступность преподавателя',
      });
    }
    return { reasons, funnel: null };
  }

  // Итоговая занятость
  const demandById = new Map(problem.demands.map((d) => [d.id, d]));
  const teacherBusy = new Set<string>();
  const teacherDay = new Map<string, number>();
  const teacherWeek = new Map<string, number>();
  const groupBusy = new Map<string, Set<number>>();
  const roomBusy = new Set<string>();
  const discDay = new Map<string, Set<number>>();
  const weekOf = new Map(problem.days.map((d) => [d.date, d.week]));
  const mark = (
    date: string,
    lesson: number,
    groupIds: string[],
    sub: number | null,
    teacherId: string | null,
    roomId: string | null,
    discKeys: string[],
  ) => {
    if (teacherId) {
      teacherBusy.add(`${teacherId}#${date}#${lesson}`);
      teacherDay.set(`${teacherId}#${date}`, (teacherDay.get(`${teacherId}#${date}`) ?? 0) + 1);
      const wk = `${teacherId}#${weekOf.get(date)}`;
      teacherWeek.set(wk, (teacherWeek.get(wk) ?? 0) + 1);
    }
    for (const g of groupIds) {
      const key = `${g}#${date}#${lesson}`;
      const set = groupBusy.get(key) ?? new Set<number>();
      set.add(sub ?? 0);
      groupBusy.set(key, set);
    }
    if (roomId) roomBusy.add(`${roomId}#${date}#${lesson}`);
    for (const dk of discKeys) {
      const set = discDay.get(`${dk}#${date}`) ?? new Set<number>();
      set.add(lesson);
      discDay.set(`${dk}#${date}`, set);
    }
  };
  for (const o of problem.occupied) {
    mark(
      o.date,
      o.lessonNumber,
      o.groupId ? [o.groupId] : [],
      o.subgroupNumber,
      o.teacherId,
      o.roomId,
      o.disciplineKey ? [o.disciplineKey] : [],
    );
  }
  for (const p of result.placements) {
    const d = demandById.get(p.demandId);
    if (!d) continue;
    mark(p.date, p.lessonNumber, d.groupIds, d.subgroupNumber, d.teacherId, p.roomId, d.disciplineKeys);
  }
  const unavailable = new Set(teacher.unavailable.map(([w, l]) => `${w}#${l}`));
  const rooms = problem.rooms.filter((r) => demand.roomIds.includes(r.id));

  const funnel: Funnel = {
    total: 0,
    teacherAvailable: 0,
    teacherFree: 0,
    teacherWithinLimits: 0,
    groupFree: 0,
    disciplineOk: 0,
    roomFree: 0,
  };
  for (const day of allowedDays) {
    for (let lesson = 1; lesson <= problem.lessonsPerDay; lesson++) {
      if (problem.settings.forbidLateLessons && lesson >= problem.settings.lateLessonNumber) continue;
      funnel.total++;
      if (unavailable.has(`${day.weekday}#${lesson}`)) continue;
      funnel.teacherAvailable++;
      if (teacherBusy.has(`${teacher.id}#${day.date}#${lesson}`)) continue;
      funnel.teacherFree++;
      if ((teacherDay.get(`${teacher.id}#${day.date}`) ?? 0) >= teacher.maxDailyLessons) continue;
      if ((teacherWeek.get(`${teacher.id}#${day.week}`) ?? 0) >= teacher.maxWeeklyLessons) continue;
      funnel.teacherWithinLimits++;
      const groupOk = demand.groupIds.every((g) => {
        const set = groupBusy.get(`${g}#${day.date}#${lesson}`);
        if (!set || set.size === 0) return true;
        if (demand.subgroupNumber === null) return false;
        return !set.has(0) && !set.has(demand.subgroupNumber);
      });
      if (!groupOk) continue;
      funnel.groupFree++;
      const discOk = demand.disciplineKeys.every((dk) => {
        const set = discDay.get(`${dk}#${day.date}`);
        return !set || set.has(lesson) || set.size < problem.settings.maxSameDisciplinePerDay;
      });
      if (!discOk) continue;
      funnel.disciplineOk++;
      const roomOk = rooms.some((r) => {
        if (r.unavailable.some(([w, l]) => w === day.weekday && l === lesson)) return false;
        return r.unlimited || !roomBusy.has(`${r.id}#${day.date}#${lesson}`);
      });
      if (roomOk) funnel.roomFree++;
    }
  }

  const need = unplacedCount;
  // Шаги «воронки»: каждое ограничение отсекает часть слотов
  const steps: Array<{ code: UnplacedReason; before: number; after: number; message: string }> = [
    {
      code: 'TEACHER_UNAVAILABLE',
      before: funnel.total,
      after: funnel.teacherAvailable,
      message: `Преподаватель ${teacher.name} доступен только в ${funnel.teacherAvailable} из ${funnel.total} слотов периода`,
    },
    {
      code: 'TEACHER_BUSY',
      before: funnel.teacherAvailable,
      after: funnel.teacherFree,
      message: `Преподаватель ${teacher.name} занят другими занятиями в ${funnel.teacherAvailable - funnel.teacherFree} доступных слотах`,
    },
    {
      code: 'TEACHER_LIMIT',
      before: funnel.teacherFree,
      after: funnel.teacherWithinLimits,
      message: `Достигнут лимит нагрузки преподавателя (${teacher.maxDailyLessons} пар в день / ${teacher.maxWeeklyLessons} в неделю)`,
    },
    {
      code: 'GROUP_BUSY',
      before: funnel.teacherWithinLimits,
      after: funnel.groupFree,
      message: `У группы нет свободных пар в ${funnel.teacherWithinLimits - funnel.groupFree} слотах, когда свободен преподаватель`,
    },
    {
      code: 'DAILY_LIMITS',
      before: funnel.groupFree,
      after: funnel.disciplineOk,
      message: `Ограничение «не более ${problem.settings.maxSameDisciplinePerDay} пар дисциплины в день» отсекает ${funnel.groupFree - funnel.disciplineOk} слотов`,
    },
    {
      code: 'ROOM_SHORTAGE',
      before: funnel.disciplineOk,
      after: funnel.roomFree,
      message: `Подходящие аудитории заняты в ${funnel.disciplineOk - funnel.roomFree} из ${funnel.disciplineOk} возможных слотов`,
    },
  ];
  // Основная причина — шаг, после которого свободных слотов становится меньше, чем нужно пар
  const primary =
    steps.find((st) => st.after < need && st.before >= need) ?? steps.find((st) => st.after < need);
  if (primary) reasons.push({ code: primary.code, message: primary.message });
  // Дополнительные причины — ограничения, отсекающие значительную часть слотов
  for (const st of steps) {
    if (st === primary) continue;
    const cut = st.before - st.after;
    if (cut > 0 && cut >= Math.max(need, st.before * 0.4)) {
      reasons.push({ code: st.code, message: st.message });
    }
  }
  if (reasons.length === 0) {
    reasons.push({
      code: 'NOT_ENOUGH_TIME',
      message:
        funnel.roomFree > 0
          ? `Найдено ${funnel.roomFree} свободных слотов, но их не удалось использовать с учётом равномерности и мягких ограничений`
          : 'Недостаточно учебного времени в выбранном интервале',
    });
  }
  return { reasons, funnel };
}

export function suggestionsFor(codes: UnplacedReason[]): string[] {
  return Array.from(new Set(codes.map((c) => SUGGESTIONS[c]).filter(Boolean)));
}
