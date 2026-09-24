"""Тесты генератора CP-SAT: жёсткие ограничения должны соблюдаться всегда."""

from __future__ import annotations

import datetime as dt
from collections import Counter, defaultdict

from fastapi.testclient import TestClient

from app.cpsat import solve
from app.main import app
from app.models import Problem
from app.pacing import cumulative_target_by_days, effective_rate


def make_days(start: str, weeks: int, working=(1, 2, 3, 4, 5, 6)):
    d0 = dt.date.fromisoformat(start)
    monday = d0 - dt.timedelta(days=d0.weekday())
    days = []
    for i in range(weeks * 7):
        d = d0 + dt.timedelta(days=i)
        wd = d.isoweekday()
        if wd in working:
            days.append({"date": d.isoformat(), "weekday": wd, "week": (d - monday).days // 7})
    return days


def base_problem(**overrides) -> dict:
    days = make_days("2025-09-01", 4)
    all_dates = [d["date"] for d in days]
    problem = {
        "mode": "CALENDAR",
        "timeLimitSeconds": 10,
        "lessonsPerDay": 6,
        "workingDays": [1, 2, 3, 4, 5, 6],
        "days": days,
        "groups": [
            {"id": "g1", "code": "ИСП-1", "size": 25, "subgroups": [1, 2], "allowedDates": all_dates, "maxLessonsPerDay": 4},
            {"id": "g2", "code": "ИСП-2", "size": 20, "subgroups": [], "allowedDates": all_dates, "maxLessonsPerDay": 4},
        ],
        "teachers": [
            {"id": "t1", "name": "Иванова", "maxDailyLessons": 4, "maxWeeklyLessons": 20, "unavailable": [[6, n] for n in range(1, 7)]},
            {"id": "t2", "name": "Петров", "maxDailyLessons": 4, "maxWeeklyLessons": 20},
            {"id": "t3", "name": "Смирнова", "maxDailyLessons": 4, "maxWeeklyLessons": 20},
        ],
        "rooms": [
            {"id": "r_lec", "code": "А-101", "building": "A", "capacity": 60, "type": "LECTURE"},
            {"id": "r_gen", "code": "А-201", "building": "A", "capacity": 30, "type": "GENERAL"},
            {"id": "r_pc1", "code": "А-301", "building": "A", "capacity": 26, "type": "COMPUTER_LAB"},
            {"id": "r_pc2", "code": "А-303", "building": "A", "capacity": 15, "type": "COMPUTER_LAB"},
        ],
        "demands": [],
        "occupied": [],
        "settings": {"maxSameDisciplinePerDay": 2, "maxSameDisciplinePerWeek": 2, "lateLessonNumber": 5},
    }
    problem.update(overrides)
    return problem


def demand(id_, groups, teacher, lessons, rooms, sub=None, key=None, **extra):
    return {
        "id": id_,
        "groupIds": groups,
        "subgroupNumber": sub,
        "semesterItemId": key or id_,
        "disciplineKeys": [f"{g}|{key or id_}" for g in groups],
        "lessonType": extra.pop("lessonType", "LECTURE"),
        "teacherId": teacher,
        "lessonsRequired": lessons,
        "size": extra.pop("size", 25),
        "roomIds": rooms,
        **extra,
    }


def check_hard_constraints(problem: Problem, result):
    demands = {d.id: d for d in problem.demands}
    teacher_slots = Counter()
    room_slots = Counter()
    group_slots = defaultdict(list)
    per_day_discipline = defaultdict(set)
    for p in result.placements:
        d = demands[p.demand_id]
        teacher_slots[(d.teacher_id, p.date, p.lesson_number)] += 1
        if p.room_id:
            room_slots[(p.room_id, p.date, p.lesson_number)] += 1
            assert p.room_id in d.room_ids, "аудитория не из списка допустимых"
        for g in d.group_ids:
            group_slots[(g, p.date, p.lesson_number)].append(d.subgroup_number)
        for k in d.discipline_keys:
            per_day_discipline[(k, p.date)].add(p.lesson_number)
        teacher = next(t for t in problem.teachers if t.id == d.teacher_id)
        weekday = dt.date.fromisoformat(p.date).isoweekday()
        assert (weekday, p.lesson_number) not in {tuple(x) for x in teacher.unavailable}, "преподаватель недоступен"
        allowed = set(d.allowed_dates) if d.allowed_dates is not None else set.intersection(
            *[set(next(g for g in problem.groups if g.id == gid).allowed_dates) for gid in d.group_ids]
        )
        assert p.date in allowed, "дата заблокирована"
    assert all(c == 1 for c in teacher_slots.values()), "преподаватель на двух занятиях одновременно"
    assert all(c == 1 for c in room_slots.values()), "аудитория занята дважды"
    for subs in group_slots.values():
        if len(subs) > 1:
            assert None not in subs, "занятие всей группы пересекается с другим"
            assert len(subs) == len(set(subs)), "подгруппа на двух занятиях"
    for lessons in per_day_discipline.values():
        assert len(lessons) <= problem.settings.max_same_discipline_per_day


def test_pacing_matches_backend_contract():
    assert effective_rate(17, 16, None) == 17 / 16
    assert effective_rate(10, 5, 3) == 3
    # Накопительная цель пропорциональна дням и достигает required в конце
    assert cumulative_target_by_days(18, 6, 96, 1, None) == 1
    assert cumulative_target_by_days(18, 96, 96, 16, None) == 18
    assert cumulative_target_by_days(10, 6, 60, 1, 2) == 2


def test_places_all_lessons_without_conflicts():
    raw = base_problem(
        demands=[
            demand("math_lec", ["g1"], "t1", 6, ["r_lec", "r_gen"], key="math"),
            demand("math_pr", ["g1"], "t1", 6, ["r_gen", "r_lec"], key="math", lessonType="PRACTICAL"),
            demand("prog_lec", ["g1"], "t2", 6, ["r_lec"], key="prog"),
            demand("prog_lab_1", ["g1"], "t2", 4, ["r_pc1", "r_pc2"], sub=1, key="prog", lessonType="LABORATORY", size=13),
            demand("prog_lab_2", ["g1"], "t3", 4, ["r_pc1", "r_pc2"], sub=2, key="prog", lessonType="LABORATORY", size=12),
            demand("math_g2", ["g2"], "t1", 6, ["r_gen", "r_lec"], key="math2", size=20),
        ]
    )
    problem = Problem.model_validate(raw)
    result = solve(problem)
    assert result.status in ("OPTIMAL", "FEASIBLE")
    assert result.stats.placed_lessons == result.stats.required_lessons == 32
    assert result.unplaced == []
    check_hard_constraints(problem, result)


def test_blocked_dates_and_teacher_blocked_dates_respected():
    raw = base_problem()
    first_week = [d["date"] for d in raw["days"] if d["week"] == 0]
    raw["groups"][1]["allowedDates"] = [d["date"] for d in raw["days"] if d["date"] not in first_week]
    raw["teachers"][1]["blockedDates"] = [d["date"] for d in raw["days"] if d["week"] == 1]
    raw["demands"] = [demand("a", ["g2"], "t2", 8, ["r_gen"], size=20)]
    problem = Problem.model_validate(raw)
    result = solve(problem)
    assert result.stats.placed_lessons == 8
    for p in result.placements:
        assert p.date not in first_week
        assert p.date not in raw["teachers"][1]["blockedDates"]


def test_practice_uses_explicit_allowed_dates():
    raw = base_problem()
    practice_days = [d["date"] for d in raw["days"] if d["week"] == 3]
    # В дни практики обычные занятия группе запрещены
    raw["groups"][1]["allowedDates"] = [d["date"] for d in raw["days"] if d["week"] < 3]
    raw["demands"] = [
        demand("practice", ["g2"], "t2", 12, ["r_pc1"], lessonType="PRACTICE", size=20, allowedDates=practice_days)
        | {"disciplineKeys": []}
    ]
    problem = Problem.model_validate(raw)
    result = solve(problem)
    assert result.stats.placed_lessons == 12
    assert all(p.date in practice_days for p in result.placements)


def test_partial_result_when_capacity_is_insufficient():
    raw = base_problem(days=make_days("2025-09-01", 1))
    dates = [d["date"] for d in raw["days"]]
    for g in raw["groups"]:
        g["allowedDates"] = dates
    # 30 пар одного преподавателя за неделю при лимите 4 пары в день и выходной в субботу — невозможно
    raw["demands"] = [demand("big", ["g2"], "t1", 30, ["r_gen", "r_lec"], size=20)]
    problem = Problem.model_validate(raw)
    result = solve(problem)
    assert result.status == "PARTIAL"
    assert result.unplaced[0].count == 30 - result.stats.placed_lessons
    assert result.stats.placed_lessons <= 5 * 4
    check_hard_constraints(problem, result)


def test_occupied_slots_are_respected():
    raw = base_problem()
    busy = [
        {"date": d["date"], "lessonNumber": n, "teacherId": "t2", "roomId": None, "groupId": None}
        for d in raw["days"]
        for n in (1, 2, 3)
    ]
    raw["occupied"] = busy
    raw["demands"] = [demand("x", ["g2"], "t2", 8, ["r_gen"], size=20)]
    problem = Problem.model_validate(raw)
    result = solve(problem)
    assert result.stats.placed_lessons == 8
    assert all(p.lesson_number > 3 for p in result.placements)


def test_weekly_template_mode_unrolls_by_dates():
    raw = base_problem(mode="WEEKLY_TEMPLATE")
    raw["demands"] = [
        demand("a", ["g2"], "t2", 8, ["r_gen"], size=20),
        demand("b", ["g2"], "t3", 4, ["r_gen", "r_lec"], size=20),
    ]
    problem = Problem.model_validate(raw)
    result = solve(problem)
    assert result.stats.placed_lessons == 12
    check_hard_constraints(problem, result)
    # Занятия дисциплины повторяются в одни и те же дни недели
    weekdays = {dt.date.fromisoformat(p.date).isoweekday() for p in result.placements if p.demand_id == "a"}
    assert len(weekdays) <= 3


def test_http_api():
    client = TestClient(app)
    assert client.get("/health").json()["status"] == "ok"
    raw = base_problem(demands=[demand("a", ["g2"], "t2", 4, ["r_gen"], size=20)])
    response = client.post("/solve", json=raw)
    assert response.status_code == 200
    body = response.json()
    assert body["solver"] == "cp-sat"
    assert body["stats"]["placedLessons"] == 4
    assert {"demandId", "date", "lessonNumber", "roomId"} <= set(body["placements"][0])
