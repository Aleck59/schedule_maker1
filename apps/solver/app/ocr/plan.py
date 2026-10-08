"""Сборка результата распознавания учебного плана из страниц скана."""

from __future__ import annotations

import base64
import datetime as dt
import logging
import re
import time
from collections.abc import Callable
from typing import Any

import numpy as np

from .calendar import CalendarTable, _monday_of_first_week, _week_row, cluster_rows, parse_calendar_page
from .checks import Num, build_equations, make_num, resolve
from .image import is_blank, load_pages, prepare
from .normalize import CYCLE_NAMES, index_prefix, main_control, parse_control, parse_fraction_weeks
from .semesters import HOUR_FIELDS, RawRow, SemesterPage, parse_semester_page
from .table import Cell, crop_png, detect_cells, ocr_cells
from .tesseract import ocr_text, tesseract_info
from .title import is_title_page, parse_title

log = logging.getLogger("engine.ocr")

Progress = Callable[[float, str], None]

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
}
PROFESSIONAL_KINDS = {
    "MODULE",
    "MODULE_EXAM",
    "INTERDISCIPLINARY_COURSE",
    "EDUCATIONAL_PRACTICE",
    "INDUSTRIAL_PRACTICE",
    "PRE_DIPLOMA_PRACTICE",
}


def _data_url(png: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def kind_of(code: str, name: str, all_codes: set[str]) -> str:
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


def module_code(code: str) -> str | None:
    m = re.match(r"^(?:МДК|УП|ПП|ПМ)\.(\d{1,2})\.", code)
    return f"ПМ.{int(m.group(1)):02d}" if m else None


def repair_codes(codes: list[str]) -> dict[str, str]:
    """Исправление букв индекса по соседним строкам: «ОО.01» при наличии «СОО.01.01» → «СОО.01»."""
    present = set(codes)
    renames: dict[str, str] = {}
    prefixes = {index_prefix(c) for c in codes}
    for code in codes:
        prefix, rest = code.split(".", 1)
        own = [c for c in codes if index_prefix(c) == prefix]
        if len(own) > 1:
            continue
        for other in prefixes - {prefix}:
            if prefix not in other and other not in prefix:
                continue
            candidate = f"{other}.{rest}"
            family = [c for c in codes if c.startswith(candidate + ".") or (index_prefix(c) == other)]
            if candidate not in present and family:
                renames[code] = candidate
                break
    return renames


class Recognizer:
    def __init__(self, on_progress: Progress | None = None) -> None:
        self.on_progress = on_progress or (lambda f, m: None)
        self.warnings: list[str] = []
        self.pages_info: list[dict[str, Any]] = []
        self.title: dict[str, Any] = {}
        self.semester_pages: list[SemesterPage] = []
        self.calendar_sources: list[tuple[int, np.ndarray, list[Cell]]] = []
        self.grays: dict[int, np.ndarray] = {}

    # ------------------------------------------------------------------ страницы
    def read_pages(self, paths: list[str]) -> None:
        self.on_progress(0.02, "Загрузка страниц")
        pages = load_pages(paths)
        total = len(pages)
        for i, raw in enumerate(pages):
            self.on_progress(0.05 + 0.8 * i / max(1, total), f"Распознавание страницы {i + 1} из {total}")
            if is_blank(raw):
                self.pages_info.append({"index": i, "kind": "blank"})
                continue
            gray = prepare(raw)
            cells = detect_cells(gray)
            ocr_cells(gray, cells)
            kind = self._classify(i, gray, cells)
            self.pages_info.append({"index": i, "kind": kind, "cells": len(cells)})
            log.info("Страница %d: %s, ячеек %d", i + 1, kind, len(cells))

    def _classify(self, index: int, gray: np.ndarray, cells: list[Cell]) -> str:
        sem = parse_semester_page(index, cells)
        if sem and sem.rows:
            self.semester_pages.append(sem)
            self.grays[index] = gray
            return "semesters"
        if any(_week_row(row) for row in cluster_rows(cells)):
            self.calendar_sources.append((index, gray, cells))
            return "calendar"
        texts = " ".join(c.text for c in cells).upper()
        if "КУРС 1" in texts or "СЧИТАТЬ В ПЛАНЕ" in texts:
            return "plan"
        if len(cells) < 120 and not self.title:
            page_text = ocr_text(gray)
            if is_title_page(cells, page_text):
                self.title = parse_title(cells, page_text)
                return "title"
        return "other"

    # ------------------------------------------------------------------ календарный график
    def calendar(self) -> list[dict[str, Any]]:
        admission = self.title.get("admissionYear")
        tables: list[CalendarTable] = []
        for index, gray, cells in self.calendar_sources:
            tables.extend(
                parse_calendar_page(index, gray, cells, admission + len(tables) if admission else None)
            )
        tables.sort(key=lambda t: (t.page, t.y))
        result = []
        for course, table in enumerate(tables, start=1):
            year = table.start_year
            if admission and (year is None or table.year_score < 0.5):
                year = admission + course - 1
            if year is None:
                self.warnings.append(f"Не удалось определить учебный год графика {course}-го курса")
                continue
            if admission and year != admission + course - 1:
                self.warnings.append(
                    f"График {course}-го курса относится к {year}–{year + 1} учебному году, "
                    f"ожидался {admission + course - 1}–{admission + course}"
                )
            monday = _monday_of_first_week(year)
            weeks = []
            for w, codes in enumerate(table.codes):
                weeks.append(
                    {
                        "number": w + 1,
                        "monday": (monday + dt.timedelta(days=7 * w)).isoformat(),
                        "days": codes,
                    }
                )
            uncertain = []
            for u in table.uncertain:
                gray = next(g for i, g, _ in self.calendar_sources if i == u["page"])
                uncertain.append({**u, "crop": _data_url(crop_png(gray, u["box"]))})  # type: ignore[arg-type]
            result.append({"course": course, "startYear": year, "weeks": weeks, "uncertain": uncertain})
        if not result:
            self.warnings.append("Календарный учебный график не найден — даты семестров заданы по умолчанию")
        return result

    # ------------------------------------------------------------------ дисциплины
    def items(self) -> tuple[list[dict[str, Any]], dict[str, int]]:
        stats = {"corrected": 0, "uncertain": 0}
        entries: dict[str, dict[str, Any]] = {}
        for sp in sorted(self.semester_pages, key=lambda p: (min(p.semesters), p.page)):
            sem_keys = [str(n) for n in sp.semesters]
            for row in sp.rows:
                self._add_row(entries, sp, row, sem_keys, stats)
        renames = repair_codes(list(entries))
        if renames:
            rebuilt: dict[str, dict[str, Any]] = {}
            for code, entry in entries.items():
                new = renames.get(code, code)
                if new != code:
                    entry["code"] = new
                    entry["issues"].append(f"Индекс распознан как «{code}» и исправлен по соседним строкам")
                rebuilt[new] = entry
            entries = rebuilt
        codes = set(entries)
        items = []
        for code, entry in entries.items():
            entry["kind"] = kind_of(code, entry["name"], codes)
            items.append(entry)
        # Родительские модули и циклы
        groups = {i["code"] for i in items if i["kind"] == "GROUP"}
        for item in items:
            kind = item["kind"]
            parent = module_code(item["code"]) if kind in PROFESSIONAL_KINDS and kind != "MODULE" else None
            item["parentCode"] = parent
            if kind in PROFESSIONAL_KINDS:
                item["cycleCode"] = "П"
            else:
                owners = [g for g in groups if item["code"].startswith(g + ".")]
                item["cycleCode"] = max(owners, key=len) if owners else index_prefix(item["code"])
        known = {i["code"] for i in items}
        for parent in sorted(
            {i["parentCode"] for i in items if i["parentCode"] and i["parentCode"] not in known}
        ):
            items.append(
                {
                    "code": parent,
                    "name": f"Профессиональный модуль {parent[3:]}",
                    "kind": "MODULE",
                    "parentCode": None,
                    "cycleCode": "П",
                    "semesters": [],
                    "issues": ["Модуль не найден на скане и добавлен автоматически"],
                }
            )
        return items, stats

    def _add_row(
        self,
        entries: dict[str, dict[str, Any]],
        sp: SemesterPage,
        row: RawRow,
        sem_keys: list[str],
        stats: dict[str, int],
    ) -> None:
        nums: dict[tuple[str, str], Num] = {}
        for block, values in row.values.items():
            for f in HOUR_FIELDS:
                v = values.get(f)
                nums[(block, f)] = make_num(v.text, v.alt, v.box, sp.page) if v else Num(0, [0])
        eqs = build_equations(
            list(row.values),
            [k for k in sem_keys if k in row.values],
            ["lecture", "laboratory", "practical", "seminar"],
        )
        check = resolve(nums, eqs)
        entry = entries.setdefault(
            row.code, {"code": row.code, "name": row.name, "semesters": [], "issues": []}
        )
        if len(row.name) > len(entry["name"]):
            entry["name"] = row.name
        for key in sem_keys:
            values = row.values.get(key, {})
            hours = {f: max(0, nums[(key, f)].value or 0) for f in HOUR_FIELDS}
            control_text = values["control"].text if "control" in values else ""
            if not any(hours.values()) and not control_text:
                continue
            cells: dict[str, Any] = {}
            for f in HOUR_FIELDS:
                n = nums[(key, f)]
                if n.status in ("corrected", "uncertain") and n.box:
                    stats[n.status] += 1
                    cells[f] = {
                        "status": n.status,
                        "read": n.read,
                        "crop": _data_url(crop_png(self.grays[sp.page], n.box)),
                    }
            forms = parse_control(control_text)
            if row.code.endswith("(К)"):
                forms = ["QUALIFICATION_EXAM"]
            weeks_text = values["weeks"].text if "weeks" in values else ""
            semester = {
                "number": int(key),
                "control": control_text,
                "controlForms": forms,
                "controlForm": main_control(forms),
                "hours": hours,
                "weeks": parse_fraction_weeks(weeks_text) if weeks_text else None,
                "cells": cells,
                "page": sp.page,
            }
            existing = next((s for s in entry["semesters"] if s["number"] == semester["number"]), None)
            if existing:
                if existing["hours"] != hours:
                    entry["issues"].append(f"{key} семестр: на разных страницах указаны разные часы")
                continue
            entry["semesters"].append(semester)
        if check.failed:
            failed_blocks = sorted({eq.lhs[0] for eq in check.failed})
            names = ", ".join("итог за курс" if b == "course" else f"{b} семестр" for b in failed_blocks)
            entry["issues"].append(f"Суммы часов не сходятся ({names}) — проверьте выделенные ячейки")
        entry["semesters"].sort(key=lambda s: s["number"])

    # ------------------------------------------------------------------ семестры и периоды
    def semesters(self, calendar: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        plan_weeks: dict[int, dict[str, float]] = {}
        for sp in self.semester_pages:
            plan_weeks.update(sp.weeks)
        numbers = sorted(
            {n for sp in self.semester_pages for n in sp.semesters}
            | {2 * c["course"] - k for c in calendar for k in (1, 0)}
        )
        semesters: list[dict[str, Any]] = []
        periods: list[dict[str, Any]] = []
        by_course = {c["course"]: c for c in calendar}
        admission = self.title.get("admissionYear") or (
            calendar[0]["startYear"] if calendar else dt.date.today().year
        )
        for course in sorted({(n + 1) // 2 for n in numbers}):
            table = by_course.get(course)
            if table:
                days = self._days(table)
                split = self._split(days)
                ranges = [(days[0][0], split), (split + dt.timedelta(days=1), self._last_study_day(days))]
                periods.extend(self._periods(course, days))
            else:
                year = admission + course - 1
                ranges = [
                    (dt.date(year, 9, 1), dt.date(year + 1, 1, 31)),
                    (dt.date(year + 1, 2, 1), dt.date(year + 1, 6, 30)),
                ]
                days = []
            for k, (start, end) in enumerate(ranges):
                number = 2 * course - 1 + k
                if number not in numbers:
                    continue
                counts: dict[str, float] = {"theory": 0, "exam": 0, "vacation": 0, "practice": 0, "gia": 0}
                for day, code in days:
                    if start <= day <= end:
                        key = {
                            "": "theory",
                            "Э": "exam",
                            "К": "vacation",
                            "У": "practice",
                            "П": "practice",
                            "Пд": "practice",
                            "Г": "gia",
                            "Д": "gia",
                        }.get(code)
                        if key:
                            counts[key] += 1 / 6
                semester = {
                    "number": number,
                    "course": course,
                    "startDate": start.isoformat(),
                    "endDate": end.isoformat(),
                    "weeks": {k: round(v, 2) for k, v in counts.items()},
                    "planWeeks": plan_weeks.get(number, {}),
                }
                planned = plan_weeks.get(number, {}).get("theory")
                if days and planned is not None and abs(planned - counts["theory"]) > 0.6:
                    self.warnings.append(
                        f"{number} семестр: по графику {counts['theory']:.1f} нед. теоретического обучения, "
                        f"в плане {planned:.1f} — проверьте календарный график"
                    )
                semesters.append(semester)
        return semesters, periods

    @staticmethod
    def _days(table: dict[str, Any]) -> list[tuple[dt.date, str]]:
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

    @staticmethod
    def _split(days: list[tuple[dt.date, str]]) -> dt.date:
        """Конец первого семестра: окончание зимних каникул (или аттестации), иначе 31 января."""
        runs = Recognizer._runs(days)
        for code in ("К", "Э"):
            for code_, start, end in runs:
                if code_ == code and (start.month in (12, 1, 2)):
                    # Первый семестр завершается вместе с периодом (до воскресенья)
                    return end + dt.timedelta(days=(6 - end.weekday()) % 7)
        year = days[0][0].year
        return dt.date(year + 1, 1, 31)

    @staticmethod
    def _last_study_day(days: list[tuple[dt.date, str]]) -> dt.date:
        for day, code in reversed(days):
            if code != "=":
                return day
        return days[-1][0]

    @staticmethod
    def _runs(days: list[tuple[dt.date, str]]) -> list[tuple[str, dt.date, dt.date]]:
        runs: list[tuple[str, dt.date, dt.date]] = []
        for day, code in days:
            if runs and runs[-1][0] == code and (day - runs[-1][2]).days <= 2:
                runs[-1] = (code, runs[-1][1], day)
            else:
                runs.append((code, day, day))
        return runs

    def _periods(self, course: int, days: list[tuple[dt.date, str]]) -> list[dict[str, Any]]:
        result = []
        for code, start, end in self._runs(days):
            if code in ("", "="):
                continue
            result.append(
                {
                    "course": course,
                    "code": code,
                    "type": CODE_TYPES.get(code, "OTHER"),
                    "startDate": start.isoformat(),
                    "endDate": end.isoformat(),
                    "weeks": round(sum(1 for d, c in days if start <= d <= end and c == code) / 6, 2),
                }
            )
        return result

    # ------------------------------------------------------------------ итог
    def result(self, started: float) -> dict[str, Any]:
        self.on_progress(0.88, "Проверка сумм часов")
        calendar = self.calendar()
        items, stats = self.items()
        semesters, periods = self.semesters(calendar)
        if not self.title:
            self.warnings.append("Титульный лист не распознан — заполните сведения о специальности вручную")
        if not self.semester_pages:
            self.warnings.append("Страницы с часами по семестрам не найдены")
        cycles = []
        group_names = {i["code"]: i["name"] for i in items if i["kind"] == "GROUP"}
        for code in dict.fromkeys(i["cycleCode"] for i in items if i["kind"] != "GROUP"):
            cycles.append({"code": code, "name": group_names.get(code) or CYCLE_NAMES.get(code, code)})
        if self.title.get("admissionYear") is None and calendar:
            self.title["admissionYear"] = calendar[0]["startYear"]
        self.on_progress(0.98, "Формирование результата")
        return {
            "title": self.title,
            "calendar": calendar,
            "semesters": semesters,
            "periods": periods,
            "cycles": cycles,
            "items": items,
            "pages": self.pages_info,
            "warnings": self.warnings,
            "stats": {
                "pages": len(self.pages_info),
                "items": sum(1 for i in items if i["kind"] != "GROUP"),
                "corrected": stats["corrected"],
                "uncertain": stats["uncertain"] + sum(len(c["uncertain"]) for c in calendar),
                "durationMs": round((time.monotonic() - started) * 1000),
            },
        }


def recognize_files(paths: list[str], on_progress: Progress | None = None) -> dict[str, Any]:
    info = tesseract_info()
    if not info["ready"]:
        raise RuntimeError(f"Распознавание недоступно: {info['error']}")
    started = time.monotonic()
    rec = Recognizer(on_progress)
    rec.read_pages(paths)
    return rec.result(started)
