"""Темп постановки занятий (совпадает с реализацией backend: apps/backend/src/scheduler/pacing.ts)."""

from __future__ import annotations

import math


def effective_rate(required: int, available_weeks: int, weekly_rate: float | None) -> float:
    """Пар в неделю: равномерный темп или желаемый (если он выше)."""
    if available_weeks <= 0:
        return float(required)
    return max(required / available_weeks, weekly_rate or 0.0)


def cumulative_target_by_days(
    required: int,
    days_up_to: int,
    total_days: int,
    weeks_up_to: int,
    weekly_rate: float | None,
    phase: float = 0.0,
) -> int:
    """Сколько пар должно быть поставлено к концу недели.

    Цель пропорциональна числу доступных учебных дней (короткие недели получают меньше пар),
    желаемый темп weekly_rate может опережать равномерный график. Отставание компенсируется
    автоматически, так как цель накопительная. phase (−0,5…0,5) сдвигает округление: у дисциплин
    одного преподавателя разные сдвиги, чтобы «лишняя» пара дробного темпа приходилась на разные недели.
    """
    if total_days <= 0 or days_up_to >= total_days:
        return required
    even = required * days_up_to / total_days
    by_rate = (weekly_rate or 0.0) * weeks_up_to
    # Округление «половина вверх», как Math.round в JavaScript
    return max(0, min(required, math.floor(max(even, by_rate) + phase + 0.5 + 1e-9)))


def pacing_phases(n: int) -> list[float]:
    """Сдвиги округления для n дисциплин одного преподавателя: равномерно в (−0,5; 0,5), у одной — 0."""
    return [0.0 if n <= 1 else (k + 0.5) / n - 0.5 for k in range(n)]
