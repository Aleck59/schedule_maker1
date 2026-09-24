"""Генератор расписания на Google OR-Tools CP-SAT.

Модель строится по неделям (скользящий горизонт):

* для каждой дисциплины (потока спроса) вычисляется накопительная цель — сколько пар
  должно быть поставлено к концу недели (равномерно по доступным дням + компенсация отставания);
* для недели строится модель CP-SAT: булевы переменные x[d, день, пара, аудитория];
* жёсткие ограничения: пересечения групп/подгрупп, преподавателей и аудиторий, доступность,
  вместимость и тип аудитории (через список допустимых аудиторий), лимиты преподавателя
  в день/неделю, не более N пар дисциплины в день, календарные блокировки (через разрешённые даты);
* мягкие ограничения (штрафы): окна у групп и преподавателей, превышение пар в день у группы,
  поздние пары, предпочтения преподавателей, сложные дисциплины в конце дня, частота дисциплины
  в неделю, переходы между корпусами;
* цель — максимум поставленных пар (с весом приоритета) минус штрафы.

После основного прохода выполняется компенсационный проход по неделям для недопоставленных пар.
Если все ограничения выполнить невозможно, возвращается лучший найденный вариант и список
нераспределённых занятий.
"""

from __future__ import annotations

import os
import time
from collections import defaultdict
from dataclasses import dataclass, field

from ortools.sat.python import cp_model

from .models import Demand, Placement, Problem, Room, SolveResult, Stats, Teacher, Unplaced
from .pacing import cumulative_target_by_days, effective_rate

DEFAULT_WEIGHTS: dict[str, float] = {
    "groupWindows": 30,
    "teacherWindows": 10,
    "lateLessons": 8,
    "teacherPreference": 6,
    "groupDailyOverload": 25,
    "difficultLate": 6,
    "disciplineWeekly": 5,
    "sameDayDiscipline": 3,
    "buildingChanges": 15,
    "evenDistribution": 10,
}

#: Масштаб штрафов (CP-SAT работает с целыми коэффициентами)
COST_SCALE = 10
#: Вознаграждение за поставленную пару (много больше любого штрафа)
PLACE_REWARD = 1000


@dataclass(frozen=True)
class DayRef:
    key: str
    weekday: int
    week: int


@dataclass(eq=False)
class DemandState:
    d: Demand
    teacher: Teacher
    allowed: set[str]
    days_by_week: dict[int, int]
    total_days: int
    rate: float
    placed: int = 0
    days_seen: int = 0
    weeks_seen: int = 0
    template_slots: list[tuple[int, int, str | None]] = field(default_factory=list)

    def target_through(self, week: int) -> int:
        self.days_seen += self.days_by_week.get(week, 0)
        self.weeks_seen += 1
        return cumulative_target_by_days(
            self.d.lessons_required, self.days_seen, self.total_days, self.weeks_seen, self.d.weekly_rate
        )


class State:
    """Текущая занятость: фиксированные занятия + уже поставленные генератором."""

    def __init__(self, subgroups_by_group: dict[str, list[int]], rooms: dict[str, Room]):
        self.group_slot: dict[tuple[str, str, int], set[int]] = defaultdict(set)
        self.teacher_slot: set[tuple[str, str, int]] = set()
        self.room_slot: dict[tuple[str, str, int], int] = defaultdict(int)
        self.teacher_day: dict[tuple[str, str], set[int]] = defaultdict(set)
        self.teacher_week: dict[tuple[str, int], int] = defaultdict(int)
        self.persp_day: dict[tuple[str, int, str], set[int]] = defaultdict(set)
        self.disc_day: dict[tuple[str, str], set[int]] = defaultdict(set)
        self.disc_week: dict[tuple[str, int], int] = defaultdict(int)
        self.group_day_buildings: dict[tuple[str, str], dict[str, int]] = defaultdict(
            lambda: defaultdict(int)
        )
        self.subgroups_by_group = subgroups_by_group
        self.rooms = rooms

    def perspectives(self, group_id: str, subgroup: int | None) -> list[int]:
        subs = self.subgroups_by_group.get(group_id) or []
        if not subs:
            return [0]
        return list(subs) if subgroup is None else [subgroup]

    def occupy(
        self,
        day: DayRef,
        lesson: int,
        group_ids: list[str],
        subgroup: int | None,
        teacher_id: str | None,
        room_id: str | None,
        discipline_keys: list[str],
    ) -> None:
        for g in group_ids:
            self.group_slot[(g, day.key, lesson)].add(subgroup or 0)
            for p in self.perspectives(g, subgroup):
                self.persp_day[(g, p, day.key)].add(lesson)
            room = self.rooms.get(room_id) if room_id else None
            if room and room.building:
                self.group_day_buildings[(g, day.key)][room.building] += 1
        if teacher_id:
            self.teacher_slot.add((teacher_id, day.key, lesson))
            self.teacher_day[(teacher_id, day.key)].add(lesson)
            self.teacher_week[(teacher_id, day.week)] += 1
        if room_id:
            self.room_slot[(room_id, day.key, lesson)] += 1
        for k in discipline_keys:
            self.disc_day[(k, day.key)].add(lesson)
            self.disc_week[(k, day.week)] += 1


class CpSatScheduler:
    def __init__(self, problem: Problem):
        self.p = problem
        self.started = time.monotonic()
        self.deadline = self.started + max(5.0, problem.time_limit_seconds)
        self.log: list[str] = []
        self.weights = {**DEFAULT_WEIGHTS, **(problem.weights or {})}
        self.rooms = {r.id: r for r in problem.rooms}
        self.teachers = {t.id: t for t in problem.teachers}
        self.groups = {g.id: g for g in problem.groups}
        self.L = problem.lessons_per_day
        self.settings = problem.settings
        self.teacher_unavail = {t.id: {(w, n) for w, n in t.unavailable} for t in problem.teachers}
        self.teacher_pref = {t.id: {(w, n): v for w, n, v in t.preferences} for t in problem.teachers}
        self.room_unavail = {r.id: {(w, n) for w, n in r.unavailable} for r in problem.rooms}
        subgroups: dict[str, list[int]] = {g.id: sorted(g.subgroups) for g in problem.groups}
        for d in problem.demands:
            if d.subgroup_number is not None:
                for g in d.group_ids:
                    lst = subgroups.setdefault(g, [])
                    if d.subgroup_number not in lst:
                        lst.append(d.subgroup_number)
        self.subgroups = subgroups
        self.days_by_week: dict[int, list[DayRef]] = defaultdict(list)
        for day in problem.days:
            self.days_by_week[day.week].append(DayRef(day.date, day.weekday, day.week))
        self.weeks = sorted(self.days_by_week)
        self.day_ref = {d.date: DayRef(d.date, d.weekday, d.week) for d in problem.days}
        self.statuses: list[int] = []
        self.objective = 0.0

    # ------------------------------------------------------------------ подготовка

    def _demand_states(self) -> list[DemandState]:
        states: list[DemandState] = []
        for d in self.p.demands:
            teacher = self.teachers.get(d.teacher_id)
            if teacher is None or d.lessons_required <= 0:
                continue
            if d.allowed_dates is not None:
                allowed = set(d.allowed_dates)
            else:
                allowed = None
                for g in d.group_ids:
                    gs = set(self.groups[g].allowed_dates) if g in self.groups else set()
                    allowed = gs if allowed is None else allowed & gs
                allowed = allowed or set()
            allowed -= set(teacher.blocked_dates)
            by_week: dict[int, int] = {}
            for w in self.weeks:
                c = sum(1 for day in self.days_by_week[w] if day.key in allowed)
                if c:
                    by_week[w] = c
            states.append(
                DemandState(
                    d=d,
                    teacher=teacher,
                    allowed=allowed,
                    days_by_week=by_week,
                    total_days=sum(by_week.values()),
                    rate=effective_rate(d.lessons_required, len(by_week), d.weekly_rate),
                )
            )
        return states

    def _new_state(self) -> State:
        return State(self.subgroups, self.rooms)

    def _apply_occupied(self, st: State) -> None:
        for o in self.p.occupied:
            day = self.day_ref.get(o.date)
            if day is None:
                continue
            st.occupy(
                day,
                o.lesson_number,
                [o.group_id] if o.group_id else [],
                o.subgroup_number,
                o.teacher_id,
                o.room_id,
                [o.discipline_key] if o.discipline_key else [],
            )

    # ------------------------------------------------------------------ проверки слотов

    def _slot_ok(self, st: State, ds: DemandState, day: DayRef, lesson: int) -> bool:
        d = ds.d
        s = self.settings
        if lesson > self.L or day.key not in ds.allowed:
            return False
        if s.forbid_late_lessons and lesson >= s.late_lesson_number:
            return False
        t = ds.teacher
        if (day.weekday, lesson) in self.teacher_unavail.get(t.id, set()):
            return False
        if (t.id, day.key, lesson) in st.teacher_slot:
            return False
        tday = st.teacher_day.get((t.id, day.key), set())
        if len(tday) >= t.max_daily_lessons and lesson not in tday:
            return False
        for g in d.group_ids:
            markers = st.group_slot.get((g, day.key, lesson))
            if markers:
                if d.subgroup_number is None or 0 in markers or d.subgroup_number in markers:
                    return False
        for k in d.discipline_keys:
            used = st.disc_day.get((k, day.key), set())
            if len(used) >= s.max_same_discipline_per_day and lesson not in used:
                return False
        return True

    def _room_ok(self, st: State, room_id: str, day: DayRef, lesson: int) -> bool:
        room = self.rooms.get(room_id)
        if room is None:
            return False
        if (day.weekday, lesson) in self.room_unavail.get(room_id, set()):
            return False
        return room.unlimited or st.room_slot.get((room_id, day.key, lesson), 0) == 0

    def _slot_cost(self, ds: DemandState, day: DayRef, lesson: int) -> float:
        s = self.settings
        w = self.weights
        cost = 0.0
        if lesson >= s.late_lesson_number:
            cost += w["lateLessons"] * (lesson - s.late_lesson_number + 1)
        if s.respect_teacher_preferences:
            t = ds.teacher
            if lesson < t.preferred_start_lesson or lesson > t.preferred_end_lesson:
                cost += w["teacherPreference"]
            cost -= self.teacher_pref.get(t.id, {}).get((day.weekday, lesson), 0) * (
                w["teacherPreference"] / 5
            )
        if ds.d.is_difficult and lesson >= max(4, s.late_lesson_number - 1):
            cost += w["difficultLate"]
        cost += lesson * 0.3
        return cost

    # ------------------------------------------------------------------ модель недели

    def _solve_week(
        self, st: State, days: list[DayRef], targets: dict[DemandState, int], time_limit: float
    ) -> int:
        active = [ds for ds, t in targets.items() if t > 0]
        if not active:
            return 0
        model = cp_model.CpModel()
        w = self.weights
        s = self.settings
        x: dict[tuple[int, str, int, str], cp_model.IntVar] = {}
        y: dict[tuple[int, str, int], list[cp_model.IntVar]] = defaultdict(list)
        objective: list[tuple[int, cp_model.IntVar]] = []

        for i, ds in enumerate(active):
            reward = PLACE_REWARD * (10 + ds.d.priority)
            for day in days:
                if day.key not in ds.allowed:
                    continue
                for lesson in range(1, self.L + 1):
                    if not self._slot_ok(st, ds, day, lesson):
                        continue
                    base_cost = self._slot_cost(ds, day, lesson)
                    for room_id in ds.d.room_ids:
                        if not self._room_ok(st, room_id, day, lesson):
                            continue
                        var = model.new_bool_var(f"x_{i}_{day.key}_{lesson}_{room_id[:8]}")
                        x[(i, day.key, lesson, room_id)] = var
                        y[(i, day.key, lesson)].append(var)
                        room = self.rooms[room_id]
                        room_cost = max(0, room.capacity - ds.d.size) / 100
                        if ds.d.preferred_room_id == room_id:
                            room_cost -= 3
                        coef = reward - int(round((base_cost + room_cost) * COST_SCALE))
                        objective.append((coef, var))
        if not x:
            return 0

        # Не более одной аудитории на слот и не больше цели недели
        for vars_ in y.values():
            if len(vars_) > 1:
                model.add(sum(vars_) <= 1)
        placed_by_demand: dict[int, list[cp_model.IntVar]] = defaultdict(list)
        for (i, _dk, _l), vars_ in y.items():
            placed_by_demand[i].extend(vars_)
        for i, vars_ in placed_by_demand.items():
            model.add(sum(vars_) <= min(targets[active[i]], active[i].d.lessons_required - active[i].placed))

        # Группы и подгруппы
        persp_slot: dict[tuple[str, int, str, int], list[cp_model.IntVar]] = defaultdict(list)
        for (i, dk, lesson), vars_ in y.items():
            ds = active[i]
            for g in ds.d.group_ids:
                for p in st.perspectives(g, ds.d.subgroup_number):
                    persp_slot[(g, p, dk, lesson)].extend(vars_)
        for vars_ in persp_slot.values():
            if len(vars_) > 1:
                model.add(sum(vars_) <= 1)

        # Преподаватели
        teacher_slot: dict[tuple[str, str, int], list[cp_model.IntVar]] = defaultdict(list)
        teacher_day: dict[tuple[str, str], list[cp_model.IntVar]] = defaultdict(list)
        teacher_week: dict[str, list[cp_model.IntVar]] = defaultdict(list)
        for (i, dk, lesson), vars_ in y.items():
            t = active[i].teacher.id
            teacher_slot[(t, dk, lesson)].extend(vars_)
            teacher_day[(t, dk)].extend(vars_)
            teacher_week[t].extend(vars_)
        for vars_ in teacher_slot.values():
            if len(vars_) > 1:
                model.add(sum(vars_) <= 1)
        for (t, dk), vars_ in teacher_day.items():
            limit = self.teachers[t].max_daily_lessons - len(st.teacher_day.get((t, dk), set()))
            model.add(sum(vars_) <= max(0, limit))
        week_no = days[0].week
        for t, vars_ in teacher_week.items():
            limit = self.teachers[t].max_weekly_lessons - st.teacher_week.get((t, week_no), 0)
            model.add(sum(vars_) <= max(0, limit))

        # Аудитории
        room_slot: dict[tuple[str, str, int], list[cp_model.IntVar]] = defaultdict(list)
        for (_i, dk, lesson, room_id), var in x.items():
            if not self.rooms[room_id].unlimited:
                room_slot[(room_id, dk, lesson)].append(var)
        for vars_ in room_slot.values():
            if len(vars_) > 1:
                model.add(sum(vars_) <= 1)

        # Не более N пар одной дисциплины в день (параллельные подгруппы — одна пара)
        disc_lesson: dict[tuple[str, str, int], list[cp_model.IntVar]] = defaultdict(list)
        for (i, dk, lesson), vars_ in y.items():
            for k in active[i].d.discipline_keys:
                disc_lesson[(k, dk, lesson)].extend(vars_)
        disc_day_usage: dict[tuple[str, str], list[cp_model.IntVar]] = defaultdict(list)
        for (k, dk, lesson), vars_ in disc_lesson.items():
            if lesson in st.disc_day.get((k, dk), set()):
                continue
            u = model.new_bool_var(f"u_{k[:12]}_{dk}_{lesson}")
            model.add_max_equality(u, vars_)
            disc_day_usage[(k, dk)].append(u)
        for (k, dk), us in disc_day_usage.items():
            limit = s.max_same_discipline_per_day - len(st.disc_day.get((k, dk), set()))
            model.add(sum(us) <= max(0, limit))

        # Частота дисциплины в неделю (мягко)
        disc_week_vars: dict[str, list[cp_model.IntVar]] = defaultdict(list)
        for (i, _dk, _l), vars_ in y.items():
            for k in active[i].d.discipline_keys:
                disc_week_vars[k].extend(vars_)
        for k, vars_ in disc_week_vars.items():
            fixed = st.disc_week.get((k, week_no), 0)
            over = model.new_int_var(0, len(vars_), f"dw_{k[:12]}")
            model.add(over >= sum(vars_) + fixed - s.max_same_discipline_per_week)
            objective.append((-int(w["disciplineWeekly"] * COST_SCALE), over))

        # Окна и перегрузка дня у групп (по каждой подгруппе — с точки зрения студента)
        persp_day: dict[tuple[str, int, str], dict[int, list[cp_model.IntVar]]] = defaultdict(
            lambda: defaultdict(list)
        )
        for (g, p, dk, lesson), vars_ in persp_slot.items():
            persp_day[(g, p, dk)][lesson].extend(vars_)
        for (g, p, dk), by_lesson in persp_day.items():
            fixed = st.persp_day.get((g, p, dk), set())
            occ = self._occupancy_vector(model, by_lesson, fixed, f"o_{g[:6]}_{p}_{dk}")
            group = self.groups.get(g)
            max_per_day = group.max_lessons_per_day if group else 4
            over = model.new_int_var(0, self.L, f"ov_{g[:6]}_{p}_{dk}")
            model.add(over >= sum(occ) - max_per_day)
            objective.append((-int(w["groupDailyOverload"] * COST_SCALE), over))
            if s.avoid_windows:
                for gap in self._gap_vars(model, occ, f"g_{g[:6]}_{p}_{dk}"):
                    objective.append((-int(w["groupWindows"] * COST_SCALE), gap))

        # Окна преподавателей
        if s.avoid_windows:
            t_by_lesson: dict[tuple[str, str], dict[int, list[cp_model.IntVar]]] = defaultdict(
                lambda: defaultdict(list)
            )
            for (t, dk, lesson), vars_ in teacher_slot.items():
                t_by_lesson[(t, dk)][lesson].extend(vars_)
            for (t, dk), by_lesson in t_by_lesson.items():
                fixed = st.teacher_day.get((t, dk), set())
                occ = self._occupancy_vector(model, by_lesson, fixed, f"to_{t[:6]}_{dk}")
                for gap in self._gap_vars(model, occ, f"tg_{t[:6]}_{dk}"):
                    objective.append((-int(w["teacherWindows"] * COST_SCALE), gap))

        # Переходы между корпусами
        buildings: dict[tuple[str, str], dict[str, list[cp_model.IntVar]]] = defaultdict(
            lambda: defaultdict(list)
        )
        for (i, dk, _lesson, room_id), var in x.items():
            b = self.rooms[room_id].building
            if not b:
                continue
            for g in active[i].d.group_ids:
                buildings[(g, dk)][b].append(var)
        for (g, dk), by_b in buildings.items():
            fixed_b = {b for b, n in st.group_day_buildings.get((g, dk), {}).items() if n > 0}
            uses = []
            for b, vars_ in by_b.items():
                if b in fixed_b:
                    continue
                ub = model.new_bool_var(f"b_{g[:6]}_{dk}_{b[:6]}")
                model.add_max_equality(ub, vars_)
                uses.append(ub)
            if not uses:
                continue
            changes = model.new_int_var(0, len(uses) + len(fixed_b), f"bc_{g[:6]}_{dk}")
            model.add(changes >= sum(uses) + len(fixed_b) - 1)
            objective.append((-int(w["buildingChanges"] * COST_SCALE), changes))

        model.maximize(sum(c * v for c, v in objective))
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = max(0.5, time_limit)
        solver.parameters.num_workers = min(8, os.cpu_count() or 4)
        solver.parameters.random_seed = self.p.seed
        # Остановка, когда до оптимума остаётся меньше пяти «единиц штрафа»
        solver.parameters.absolute_gap_limit = COST_SCALE * 5
        status = solver.solve(model)
        self.statuses.append(status)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return 0
        self.objective += solver.objective_value
        placed = 0
        for (i, dk, lesson, room_id), var in x.items():
            if solver.boolean_value(var):
                ds = active[i]
                day = next(d for d in days if d.key == dk)
                self._commit(st, ds, day, lesson, room_id)
                placed += 1
        return placed

    def _occupancy_vector(self, model: cp_model.CpModel, by_lesson, fixed: set[int], name: str):
        occ = []
        for lesson in range(1, self.L + 1):
            if lesson in fixed:
                occ.append(1)
            elif by_lesson.get(lesson):
                o = model.new_bool_var(f"{name}_{lesson}")
                model.add_max_equality(o, by_lesson[lesson])
                occ.append(o)
            else:
                occ.append(0)
        return occ

    def _gap_vars(self, model: cp_model.CpModel, occ: list, name: str) -> list[cp_model.IntVar]:
        """Окно в слоте l: слот свободен, но занятия есть и до, и после него."""
        gaps = []
        n = len(occ)
        for i in range(1, n - 1):
            if isinstance(occ[i], int) and occ[i] == 1:
                continue
            before = [v for v in occ[:i] if not (isinstance(v, int) and v == 0)]
            after = [v for v in occ[i + 1 :] if not (isinstance(v, int) and v == 0)]
            if not before or not after:
                continue
            b = self._or(model, before, f"{name}_b{i}")
            a = self._or(model, after, f"{name}_a{i}")
            gap = model.new_bool_var(f"{name}_gap{i}")
            model.add(gap >= b + a - occ[i] - 1)
            gaps.append(gap)
        return gaps

    @staticmethod
    def _or(model: cp_model.CpModel, items: list, name: str):
        if any(isinstance(v, int) and v == 1 for v in items):
            return 1
        v = model.new_bool_var(name)
        model.add_max_equality(v, items)
        return v

    def _commit(self, st: State, ds: DemandState, day: DayRef, lesson: int, room_id: str | None) -> None:
        st.occupy(
            day, lesson, ds.d.group_ids, ds.d.subgroup_number, ds.teacher.id, room_id, ds.d.discipline_keys
        )
        ds.placed += 1
        if day.week >= 0:
            self.placements.append(
                Placement(demand_id=ds.d.id, date=day.key, lesson_number=lesson, room_id=room_id)
            )
        else:
            ds.template_slots.append((day.weekday, lesson, room_id))

    # ------------------------------------------------------------------ режимы

    def solve(self) -> SolveResult:
        self.placements: list[Placement] = []
        states = self._demand_states()
        st = self._new_state()
        self._apply_occupied(st)
        budget = max(5.0, self.p.time_limit_seconds)
        main_budget = budget * 0.8
        weeks = self.weeks

        calendar_states = states
        if self.p.mode == "WEEKLY_TEMPLATE":
            # В шаблон недели входят только регулярные занятия; практика и консультации
            # (со своими датами) ставятся календарным проходом
            regular = [ds for ds in states if ds.d.allowed_dates is None]
            calendar_states = [ds for ds in states if ds.d.allowed_dates is not None]
            self._template(regular, st, main_budget * (0.7 if calendar_states else 1.0))
        if calendar_states:
            per_week = max(
                0.5, main_budget / max(1, len(weeks)) / (3 if self.p.mode == "WEEKLY_TEMPLATE" else 1)
            )
            for w in weeks:
                if time.monotonic() > self.deadline:
                    self.log.append("Достигнут лимит времени — возвращён лучший найденный вариант")
                    break
                targets = {}
                for ds in calendar_states:
                    if w not in ds.days_by_week:
                        continue
                    t = ds.target_through(w) - ds.placed
                    if t > 0:
                        targets[ds] = t
                self._solve_week(st, self.days_by_week[w], targets, per_week)

        # Компенсация: сначала равномерно по оставшимся неделям, затем в любые свободные слоты
        for spread in (True, False):
            leftovers = [ds for ds in states if ds.placed < ds.d.lessons_required]
            if not leftovers or time.monotonic() >= self.deadline:
                break
            if spread:
                self.log.append(
                    f"Компенсационный проход: {len(leftovers)} дисциплин с недопоставленными парами"
                )
            remaining = max(0.5, self.deadline - time.monotonic())
            weeks_with = [w for w in weeks if any(w in ds.days_by_week for ds in leftovers)]
            per_week = max(0.3, remaining / max(1, len(weeks_with)) / (2 if spread else 1))
            for i, w in enumerate(weeks_with):
                if time.monotonic() > self.deadline:
                    break
                targets = {}
                for ds in leftovers:
                    left = ds.d.lessons_required - ds.placed
                    if left <= 0 or w not in ds.days_by_week:
                        continue
                    weeks_left = sum(1 for x in weeks_with[i:] if x in ds.days_by_week)
                    targets[ds] = -(-left // max(1, weeks_left)) if spread else left
                if targets:
                    self._solve_week(st, self.days_by_week[w], targets, per_week)

        required = sum(max(0, d.lessons_required) for d in self.p.demands)
        unplaced = [
            Unplaced(demand_id=ds.d.id, count=ds.d.lessons_required - ds.placed)
            for ds in states
            if ds.placed < ds.d.lessons_required
        ]
        known = {ds.d.id for ds in states}
        for d in self.p.demands:
            if d.id not in known and d.lessons_required > 0:
                unplaced.append(Unplaced(demand_id=d.id, count=d.lessons_required))
        self.placements.sort(key=lambda p: (p.date, p.lesson_number))
        if required > 0 and not self.placements:
            status = "EMPTY"
        elif unplaced:
            status = "PARTIAL"
        elif self.statuses and all(s == cp_model.OPTIMAL for s in self.statuses):
            status = "OPTIMAL"
        else:
            status = "FEASIBLE"
        return SolveResult(
            status=status,
            placements=self.placements,
            unplaced=unplaced,
            stats=Stats(
                required_lessons=required,
                placed_lessons=len(self.placements),
                duration_ms=int((time.monotonic() - self.started) * 1000),
                weeks=len(weeks),
                objective=self.objective,
            ),
            log=self.log,
        )

    def _template(self, states: list[DemandState], st: State, budget: float) -> None:
        """Постоянное недельное расписание: шаблон недели → развёртка по датам."""
        template_days = [DayRef(f"T{wd}", wd, -1) for wd in self.p.working_days]
        tst = self._new_state()
        # Регулярная занятость (встречается в большинстве недель) переносится в шаблон
        recurring: dict[tuple, int] = defaultdict(int)
        for o in self.p.occupied:
            day = self.day_ref.get(o.date)
            if day is None:
                continue
            recurring[
                (
                    day.weekday,
                    o.lesson_number,
                    o.group_id,
                    o.subgroup_number,
                    o.teacher_id,
                    o.room_id,
                    o.discipline_key,
                )
            ] += 1
        threshold = max(2, len(self.weeks) / 2)
        for (wd, lesson, g, sub, t, r, k), count in recurring.items():
            if count >= threshold:
                tst.occupy(DayRef(f"T{wd}", wd, -1), lesson, [g] if g else [], sub, t, r, [k] if k else [])

        originals = {}
        template_states = []
        for ds in states:
            weekdays = {self.day_ref[k].weekday for k in ds.allowed if k in self.day_ref}
            tds = DemandState(
                d=ds.d,
                teacher=ds.teacher,
                allowed={f"T{wd}" for wd in weekdays},
                days_by_week=ds.days_by_week,
                total_days=ds.total_days,
                rate=ds.rate,
            )
            originals[id(tds)] = ds
            template_states.append(tds)
        # Постоянная неделя: число слотов в шаблоне — округлённый темп (не менее одного)
        targets = {
            tds: min(tds.d.lessons_required, max(1, int(tds.rate + 0.5))) if tds.days_by_week else 0
            for tds in template_states
        }
        self._solve_week(tst, template_days, targets, budget * 0.5)
        for tds in template_states:
            originals[id(tds)].template_slots = sorted(tds.template_slots)
        self.log.append(f"Шаблон недели: {sum(len(t.template_slots) for t in template_states)} пар")

        # Развёртка шаблона по датам: шаблон повторяется каждую неделю, пока не выработаны часы
        for w in self.weeks:
            days = self.days_by_week[w]
            for ds in states:
                if w not in ds.days_by_week:
                    continue
                need = ds.d.lessons_required - ds.placed
                for weekday, lesson, room_id in ds.template_slots:
                    if need <= 0:
                        break
                    day = next((d for d in days if d.weekday == weekday), None)
                    if day is None or not self._slot_ok(st, ds, day, lesson):
                        continue
                    room = room_id if room_id and self._room_ok(st, room_id, day, lesson) else None
                    if room is None:
                        room = next((r for r in ds.d.room_ids if self._room_ok(st, r, day, lesson)), None)
                    if room is None:
                        continue
                    self._commit(st, ds, day, lesson, room)
                    need -= 1


def solve(problem: Problem) -> SolveResult:
    return CpSatScheduler(problem).solve()
