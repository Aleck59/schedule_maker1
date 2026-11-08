"""Учебный год организации из настроек: начало года и типовые границы семестров («ММ-ДД»).

API передаёт их в переменной окружения SCHEDULE_ACADEMIC_CALENDAR («09-01,12-31,01-12,06-30»):
начало года, конец I семестра, начало и конец II семестра. Используются только там, где в самом
плане дат нет (план без графика, год набора не найден). Сетка графика .plx по-прежнему идёт от
1 сентября: так её строит программа «Планы».
"""

from __future__ import annotations

import datetime as dt
import os
import re

DEFAULT = ("09-01", "12-31", "01-12", "06-30")
_MD = re.compile(r"^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$")


def _valid(md: str) -> bool:
    if not _MD.match(md) or md == "02-29":
        return False
    try:
        dt.date(2023, int(md[:2]), int(md[3:]))
    except ValueError:
        return False
    return True


def settings() -> tuple[str, str, str, str]:
    raw = [s.strip() for s in os.environ.get("SCHEDULE_ACADEMIC_CALENDAR", "").split(",")]
    if len(raw) == 4 and all(_valid(s) for s in raw):
        return raw[0], raw[1], raw[2], raw[3]
    return DEFAULT


def year_start() -> str:
    return settings()[0]


def _md(d: dt.date) -> str:
    return f"{d.month:02d}-{d.day:02d}"


def academic_year_of(d: dt.date) -> int:
    """Год, в котором начался учебный год, содержащий дату."""
    return d.year if _md(d) >= year_start() else d.year - 1


def date_in_year(year: int, md: str) -> dt.date:
    """Дата «ММ-ДД» внутри учебного года, начавшегося в году year."""
    y = year if md >= year_start() else year + 1
    return dt.date(y, int(md[:2]), int(md[3:]))


def default_semesters(year: int) -> list[tuple[dt.date, dt.date]]:
    """Типовые I и II семестры учебного года (для плана без графика)."""
    start, first_end, second_start, second_end = settings()
    return [
        (date_in_year(year, start), date_in_year(year, first_end)),
        (date_in_year(year, second_start), date_in_year(year, second_end)),
    ]


def is_first_semester(d: dt.date) -> bool:
    """Сессия заочников относится к I семестру, если идёт в первые 5 месяцев учебного года
    (при начале 1 сентября — с сентября по январь: зимняя сессия в январе — тоже I семестр)."""
    start_month = int(year_start()[:2])
    return (d.month - start_month) % 12 < 5
