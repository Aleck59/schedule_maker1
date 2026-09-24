"""Модели задачи и результата генерации расписания (JSON-контракт общий с backend)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")


class Day(CamelModel):
    date: str
    weekday: int
    week: int


class Group(CamelModel):
    id: str
    code: str
    size: int
    subgroups: list[int] = Field(default_factory=list)
    allowed_dates: list[str] = Field(default_factory=list)
    max_lessons_per_day: int = 4


class Teacher(CamelModel):
    id: str
    name: str
    max_daily_lessons: int = 4
    max_weekly_lessons: int = 18
    preferred_start_lesson: int = 1
    preferred_end_lesson: int = 6
    unavailable: list[tuple[int, int]] = Field(default_factory=list)
    preferences: list[tuple[int, int, int]] = Field(default_factory=list)
    blocked_dates: list[str] = Field(default_factory=list)


class Room(CamelModel):
    id: str
    code: str
    building: str | None = None
    capacity: int
    type: str
    unavailable: list[tuple[int, int]] = Field(default_factory=list)
    unlimited: bool = False


class Demand(CamelModel):
    id: str
    group_ids: list[str]
    subgroup_number: int | None = None
    semester_item_id: str
    discipline_keys: list[str] = Field(default_factory=list)
    title: str = ""
    lesson_type: str
    teacher_id: str
    lessons_required: int
    weekly_rate: float | None = None
    priority: int = 5
    size: int = 0
    room_ids: list[str] = Field(default_factory=list)
    preferred_room_id: str | None = None
    # Если заданы — заменяют даты обычных занятий группы (практика, консультации)
    allowed_dates: list[str] | None = None
    is_difficult: bool = False


class Occupied(CamelModel):
    date: str
    lesson_number: int
    group_id: str | None = None
    subgroup_number: int | None = None
    teacher_id: str | None = None
    room_id: str | None = None
    discipline_key: str | None = None


class Settings(CamelModel):
    max_same_discipline_per_day: int = 2
    max_same_discipline_per_week: int = 2
    late_lesson_number: int = 5
    forbid_late_lessons: bool = False
    avoid_windows: bool = True
    respect_teacher_preferences: bool = True


class Problem(CamelModel):
    version: int = 1
    mode: Literal["CALENDAR", "WEEKLY_TEMPLATE"] = "CALENDAR"
    time_limit_seconds: float = 60
    lessons_per_day: int = 6
    working_days: list[int] = Field(default_factory=lambda: [1, 2, 3, 4, 5, 6])
    days: list[Day] = Field(default_factory=list)
    groups: list[Group] = Field(default_factory=list)
    teachers: list[Teacher] = Field(default_factory=list)
    rooms: list[Room] = Field(default_factory=list)
    demands: list[Demand] = Field(default_factory=list)
    occupied: list[Occupied] = Field(default_factory=list)
    settings: Settings = Field(default_factory=Settings)
    weights: dict[str, float] = Field(default_factory=dict)
    seed: int = 42


class Placement(CamelModel):
    demand_id: str
    date: str
    lesson_number: int
    room_id: str | None = None


class Unplaced(CamelModel):
    demand_id: str
    count: int


class Stats(CamelModel):
    required_lessons: int
    placed_lessons: int
    duration_ms: int
    weeks: int
    objective: float | None = None


class SolveResult(CamelModel):
    status: Literal["OPTIMAL", "FEASIBLE", "PARTIAL", "EMPTY", "ERROR"]
    solver: Literal["cp-sat"] = "cp-sat"
    placements: list[Placement]
    unplaced: list[Unplaced]
    stats: Stats
    log: list[str] = Field(default_factory=list)
