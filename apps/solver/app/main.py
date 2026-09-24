"""HTTP API сервиса оптимизации: POST /solve принимает задачу, возвращает расписание."""

from __future__ import annotations

import logging
import os

import ortools
from fastapi import FastAPI, HTTPException

from . import __version__
from .cpsat import solve
from .models import Problem, SolveResult

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
log = logging.getLogger("solver")

app = FastAPI(
    title="Сервис оптимизации расписания (OR-Tools CP-SAT)",
    description="Генерация расписания занятий колледжа СПО: понедельная модель CP-SAT с жёсткими и мягкими ограничениями.",
    version=os.getenv("APP_VERSION", __version__),
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "ortools": ortools.__version__, "version": app.version}


@app.post("/solve", response_model=SolveResult)
def solve_endpoint(problem: Problem) -> SolveResult:
    required = sum(d.lessons_required for d in problem.demands)
    log.info(
        "Задача: режим %s, дней %d, групп %d, спрос %d пар (%d потоков), лимит %.0f с",
        problem.mode,
        len(problem.days),
        len(problem.groups),
        required,
        len(problem.demands),
        problem.time_limit_seconds,
    )
    try:
        result = solve(problem)
    except Exception as exc:  # pragma: no cover - защитный код
        log.exception("Ошибка решения задачи")
        raise HTTPException(status_code=500, detail=f"Ошибка решателя CP-SAT: {exc}") from exc
    log.info(
        "Результат: %s, поставлено %d из %d за %d мс",
        result.status,
        result.stats.placed_lessons,
        result.stats.required_lessons,
        result.stats.duration_ms,
    )
    return result
