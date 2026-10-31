"""Структура учебного плана без распознавания: виды строк, коды календарного графика, семестры.

Используется и распознаванием сканов (``plan.py``), и импортом файлов .plx/.xml (``app/planfile.py``);
модуль не зависит от OpenCV, NumPy и Tesseract.
"""

from __future__ import annotations

import datetime as dt
import re
from typing import Any

from .normalize import index_prefix, is_vo_index

CODE_RE = re.compile(r"\b(\d{2})[.,](\d{2})[.,](\d{2})\b")
LEVEL_BY_CODE = {
    "01": "SPO",
    "02": "SPO",
    "03": "BACHELOR",
    "04": "MASTER",
    "05": "SPECIALIST",
    "06": "POSTGRADUATE",
    "07": "POSTGRADUATE",
    "08": "POSTGRADUATE",
}


def education_level(code: str | None) -> str | None:
    """Уровень образования по коду специальности (направления): «38.02.01» — СПО, «38.03.01» — бакалавриат."""
    m = CODE_RE.search(code or "")
    return LEVEL_BY_CODE.get(m.group(2)) if m else None


def monday_of_first_week(year: int) -> dt.date:
    sep1 = dt.date(year, 9, 1)
    return sep1 - dt.timedelta(days=sep1.weekday())


CODE_TYPES = {
    "": "THEORETICAL_TRAINING",
    "Э": "EXAM_SESSION",
    "К": "VACATION",
    "У": "EDUCATIONAL_PRACTICE",
    "П": "INDUSTRIAL_PRACTICE",
    "Пд": "PRE_DIPLOMA_PRACTICE",
    "Д": "DIPLOMA_PREPARATION",
    "Г": "FINAL_ATTESTATION",
    "*": "HOLIDAY",
    "С": "OTHER",
}
# Коды графика, которые сохраняются у заочной формы вне сессий
KEEP_OUTSIDE_SESSIONS = {"К", "У", "П", "Пд", "Д", "Г", "*", "="}
PERIOD_TITLES = {"С": "Межсессионный период (самостоятельная работа)"}
PROFESSIONAL_KINDS = {
    "MODULE",
    "MODULE_EXAM",
    "INTERDISCIPLINARY_COURSE",
    "EDUCATIONAL_PRACTICE",
    "INDUSTRIAL_PRACTICE",
    "PRE_DIPLOMA_PRACTICE",
}


VO_PRACTICE_KINDS = {
    "У": "EDUCATIONAL_PRACTICE",
    "Н": "EDUCATIONAL_PRACTICE",
    "П": "INDUSTRIAL_PRACTICE",
    "Пд": "PRE_DIPLOMA_PRACTICE",
}


def kind_of(code: str, name: str, all_codes: set[str]) -> str:
    if is_vo_index(code):
        if any(other.startswith(code + ".") for other in all_codes):
            return "GROUP"
        if code.startswith("Б2"):
            m = re.search(r"\((\w+)\)$", code)
            return VO_PRACTICE_KINDS.get(m.group(1) if m else "", "INDUSTRIAL_PRACTICE")
        if code.startswith("Б3"):
            return "FINAL_ATTESTATION"
        if code.startswith("ФТД"):
            return "ELECTIVE"
        return "DISCIPLINE"
    prefix = index_prefix(code)
    if code.endswith("(К)") or "экзамен по модулю" in name.lower():
        return "MODULE_EXAM"
    kinds = {
        "ПМ": "MODULE",
        "МДК": "INTERDISCIPLINARY_COURSE",
        "УП": "EDUCATIONAL_PRACTICE",
        "ПП": "INDUSTRIAL_PRACTICE",
        "ПДП": "PRE_DIPLOMA_PRACTICE",
        "ГИА": "FINAL_ATTESTATION",
        "ФТД": "ELECTIVE",
    }
    if prefix in kinds:
        return kinds[prefix]
    if any(other.startswith(code + ".") for other in all_codes):
        return "GROUP"
    return "DISCIPLINE"


def is_required(code: str, kind: str) -> bool:
    """Обязательна ли дисциплина для группы: факультативы и вторые и далее дисциплины по выбору — нет."""
    if kind == "ELECTIVE":
        return False
    m = re.search(r"\.ДВ\.\d{2}\.(\d{2})$", code)
    return not (m and int(m.group(1)) > 1)


def module_code(code: str) -> str | None:
    m = re.match(r"^(?:МДК|УП|ПП|ПМ)\.(\d{1,2})\.", code)
    return f"ПМ.{int(m.group(1)):02d}" if m else None


# ---------------------------------------------------------------- календарный график по дням


def graph_days(table: dict[str, Any]) -> list[tuple[dt.date, str]]:
    year = table["startYear"]
    start, end = dt.date(year, 9, 1), dt.date(year + 1, 8, 31)
    days = []
    for week in table["weeks"]:
        monday = dt.date.fromisoformat(week["monday"])
        for d, code in enumerate(week["days"]):
            day = monday + dt.timedelta(days=d)
            if start <= day <= end:
                days.append((day, code))
    return days


def split_semesters(days: list[tuple[dt.date, str]]) -> dt.date:
    """Конец первого семестра: окончание зимних каникул (или аттестации), иначе 31 января."""
    runs = graph_runs(days)
    for code in ("К", "Э"):
        for code_, start, end in runs:
            if code_ == code and (start.month in (12, 1, 2)):
                # Первый семестр завершается вместе с периодом (до воскресенья)
                return end + dt.timedelta(days=(6 - end.weekday()) % 7)
    year = days[0][0].year
    return dt.date(year + 1, 1, 31)


def last_study_day(days: list[tuple[dt.date, str]]) -> dt.date:
    for day, code in reversed(days):
        if code != "=":
            return day
    return days[-1][0]


def graph_runs(days: list[tuple[dt.date, str]]) -> list[tuple[str, dt.date, dt.date]]:
    runs: list[tuple[str, dt.date, dt.date]] = []
    for day, code in days:
        if runs and runs[-1][0] == code and (day - runs[-1][2]).days <= 2:
            runs[-1] = (code, runs[-1][1], day)
        else:
            runs.append((code, day, day))
    return runs


def graph_periods(course: int, days: list[tuple[dt.date, str]]) -> list[dict[str, Any]]:
    result = []
    for code, start, end in graph_runs(days):
        if code in ("", "="):
            continue
        result.append(
            {
                "course": course,
                "code": code,
                "title": PERIOD_TITLES.get(code),
                "type": CODE_TYPES.get(code, "OTHER"),
                "startDate": start.isoformat(),
                "endDate": end.isoformat(),
                "weeks": round(sum(1 for d, c in days if start <= d <= end and c == code) / 6, 2),
            }
        )
    return result
