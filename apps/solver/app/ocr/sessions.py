"""Заочная форма обучения: сессии вместо семестров.

На страницах «КУРС N» часы указаны по сессиям («Установочная / Зимняя / Летняя сессия» или «Сессия 1, 2…»),
даты сессий — в таблице «График сессий» под календарным учебным графиком.
"""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass

from .normalize import DIGIT_LIKE
from .table import Cell

MONTHS = {
    "янв": 1,
    "фев": 2,
    "мар": 3,
    "апр": 4,
    "мая": 5,
    "май": 5,
    "июн": 6,
    "июл": 7,
    "авг": 8,
    "сен": 9,
    "окт": 10,
    "ноя": 11,
    "дек": 12,
}
DATE_RE = re.compile(r"(\d{1,2})\s*([А-Яа-яЁё]{3,9})\.?\s*(20\d{2})")
SESSION_RE = re.compile(r"(Установочн\w*|Зимн\w*|Летн\w*)\s+сесси|Сесси\w*\s*(\d)", re.I)
COURSE_RE = re.compile(r"Курс\s*(\d)", re.I)


@dataclass
class Session:
    course: int
    # Порядковый номер сессии на курсе (с 1)
    index: int
    name: str
    start: dt.date
    end: dt.date


def parse_date_ru(text: str) -> dt.date | None:
    """«22 сентября 2025 г.» → дата (цифры, распознанные как буквы, исправляются)."""
    t = text.strip().strip("'‘’\"„“")
    # Цифры в начале строки нередко читаются как буквы: «З ноября» — 3 ноября
    head = re.match(r"^(\S{1,2})(\s)", t)
    if head:
        t = head.group(1).translate(DIGIT_LIKE) + t[head.end(1) :]
    m = DATE_RE.search(t)
    if not m:
        return None
    month = MONTHS.get(m.group(2).lower()[:3])
    if not month:
        return None
    try:
        return dt.date(int(m.group(3)), month, int(m.group(1)))
    except ValueError:
        return None


def session_semester(course: int, name: str, position: int, count: int) -> int:
    """Семестр сессии: установочная и зимняя — нечётный, летняя (или последняя по счёту) — чётный."""
    lowered = name.lower()
    if lowered.startswith("летн"):
        return 2 * course
    if lowered.startswith(("зимн", "установочн")):
        return 2 * course - 1
    return 2 * course if count > 1 and position == count - 1 else 2 * course - 1


def parse_session_schedule(cells: list[Cell]) -> list[Session]:
    """Таблица «График сессий»: курсы, сессии и даты начала и окончания каждой сессии."""
    courses = [c for c in cells if COURSE_RE.fullmatch(c.text.strip(" .'‘\"")) and c.w > 150]
    headers = [c for c in cells if SESSION_RE.search(c.text)]
    starts = [c for c in cells if re.search(r"Дата\s+начала", c.text, re.I)]
    ends = [c for c in cells if re.search(r"Дата\s+окончания", c.text, re.I)]
    if not courses or not headers or not starts or not ends:
        return []
    sessions: list[Session] = []
    for course_cell in courses:
        course = int(COURSE_RE.search(course_cell.text).group(1))  # type: ignore[union-attr]
        own = sorted(
            (
                h
                for h in headers
                if course_cell.x - 6 <= h.cx <= course_cell.x2 + 6
                and 0 <= h.y - course_cell.y2 < course_cell.h * 2
            ),
            key=lambda c: c.x,
        )
        # Строки дат — ближайшие ниже заголовков сессий
        below = [s for s in starts if own and s.y > own[0].y]
        start_row = min(below, key=lambda s: s.y - own[0].y, default=None)
        end_row = min((e for e in ends if start_row and e.y > start_row.y), key=lambda e: e.y, default=None)
        if not own or not start_row or not end_row:
            continue
        for i, h in enumerate(own):
            start = _date_in_row(cells, h, start_row)
            end = _date_in_row(cells, h, end_row)
            if start and end and start <= end:
                m = SESSION_RE.search(h.text)
                name = (m.group(1) if m and m.group(1) else h.text).strip(" '‘\"„“")
                sessions.append(Session(course, i + 1, name, start, end))
    sessions.sort(key=lambda s: s.start)
    return sessions


def _date_in_row(cells: list[Cell], column: Cell, row: Cell) -> dt.date | None:
    for c in cells:
        if column.x - 6 <= c.cx <= column.x2 + 6 and row.y - 6 <= c.cy <= row.y2 + 6:
            value = parse_date_ru(c.text)
            if value:
                return value
    return None
