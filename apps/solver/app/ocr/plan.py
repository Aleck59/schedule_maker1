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
from .image import count_pages, is_blank, iter_pages, prepare
from .normalize import (
    CYCLE_NAMES,
    index_prefix,
    is_vo_index,
    main_control,
    parse_control,
    parse_fraction_weeks,
)
from .pdftext import fill_cells, page_text
from .semesters import HOUR_FIELDS, RawRow, SemesterPage, parse_semester_page
from .sessions import Session, parse_session_schedule
from .structure import (
    KEEP_OUTSIDE_SESSIONS,
    PROFESSIONAL_KINDS,
    graph_days,
    graph_periods,
    graph_runs,
    is_required,
    kind_of,
    last_study_day,
    module_code,
    split_semesters,
)
from .table import Cell, crop_png, detect_cells, detect_cells_map, ocr_cells
from .tesseract import ocr_text, tesseract_info
from .title import education_level, is_title_page, parse_plan_header, parse_title

log = logging.getLogger("engine.ocr")

Progress = Callable[[float, str], None]


def _data_url(png: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def repair_codes(codes: list[str]) -> dict[str, str]:
    """Исправление букв индекса по соседним строкам: «ОО.01» при наличии «СОО.01.01» → «СОО.01»."""
    codes = [c for c in codes if not is_vo_index(c)]
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
        self.text_pages = 0
        # Даты сессий заочной формы («График сессий»)
        self.sessions: list[Session] = []
        # Сведения из колонтитула цифрового плана (надёжнее распознанного титульного листа)
        self.header: dict[str, Any] = {}

    # ------------------------------------------------------------------ страницы
    def read_pages(self, paths: list[str]) -> None:
        self.on_progress(0.02, "Загрузка страниц")
        total = count_pages(paths)
        for i, page in enumerate(iter_pages(paths)):
            self.on_progress(0.05 + 0.8 * i / max(1, total), f"Распознавание страницы {i + 1} из {total}")
            if page.glyphs is None and is_blank(page.gray):
                self.pages_info.append({"index": i, "kind": "blank"})
                continue
            text: str | None = None
            if page.glyphs is not None:
                # Цифровая страница: текст берётся из PDF, изображение — только для поиска ячеек
                gray = page.gray
                cells, labels, label_of = detect_cells_map(gray)
                fill_cells(cells, labels, label_of, page.glyphs)
                text = page_text(page.glyphs)
                self.text_pages += 1
                if not self.header:
                    self.header = parse_plan_header(text)
            else:
                gray = prepare(page.gray)
                cells = detect_cells(gray)
                ocr_cells(gray, cells)
            kind = self._classify(i, gray, cells, text)
            self.pages_info.append(
                {
                    "index": i,
                    "kind": kind,
                    "cells": len(cells),
                    "source": "text" if text is not None else "ocr",
                }
            )
            log.info(
                "Страница %d: %s, ячеек %d%s", i + 1, kind, len(cells), ", текстовый слой" if text else ""
            )

    def _classify(self, index: int, gray: np.ndarray, cells: list[Cell], text: str | None = None) -> str:
        # Курс страницы заочной формы: из колонтитула «КУРС N» или по порядку страниц с сессиями
        m = re.search(r"^\s*КУРС\s+(\d)\b", text or "", re.M)
        course_hint = int(m.group(1)) if m else sum(1 for sp in self.semester_pages if sp.sessions) + 1
        sem = parse_semester_page(index, cells, course_hint)
        if sem and sem.rows:
            self.semester_pages.append(sem)
            self.grays[index] = gray
            return "semesters"
        sessions = parse_session_schedule(cells)
        if sessions:
            self.sessions.extend(sessions)
            kind = "sessions"
        else:
            kind = ""
        if any(_week_row(row) for row in cluster_rows(cells)):
            self.calendar_sources.append((index, gray, cells))
            return "calendar"
        if kind:
            return kind
        texts = " ".join(c.text for c in cells).upper()
        if "КУРС 1" in texts or "СЧИТАТЬ В ПЛАНЕ" in texts:
            return "plan"
        if len(cells) < 120 and not self.title:
            page_text_ = text if text is not None else ocr_text(gray)
            if is_title_page(cells, page_text_):
                self.title = parse_title(cells, page_text_)
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
        if self.sessions:
            self._apply_sessions(result, admission)
        if not result:
            self.warnings.append("Календарный учебный график не найден — даты семестров заданы по умолчанию")
        return result

    def _apply_sessions(self, result: list[dict[str, Any]], admission: int | None) -> None:
        """Заочная форма: занятия — только в даты сессий, остальное время — межсессионный период «С»
        (практики, каникулы и праздники из графика сохраняются)."""
        by_course = {c["course"]: c for c in result}
        first_year = admission or (
            self.sessions[0].start.year - (1 if self.sessions[0].start.month < 9 else 0)
        )
        for course in sorted({s.course for s in self.sessions}):
            table = by_course.get(course)
            if table is None:
                year = first_year + course - 1
                monday = _monday_of_first_week(year)
                table = {
                    "course": course,
                    "startYear": year,
                    "weeks": [
                        {
                            "number": w + 1,
                            "monday": (monday + dt.timedelta(days=7 * w)).isoformat(),
                            "days": [""] * 6,
                        }
                        for w in range(53)
                    ],
                    "uncertain": [],
                }
                result.append(table)
            own = [s for s in self.sessions if s.course == course]
            for week in table["weeks"]:
                monday = dt.date.fromisoformat(week["monday"])
                for d in range(6):
                    day = monday + dt.timedelta(days=d)
                    code = week["days"][d]
                    if any(s.start <= day <= s.end for s in own):
                        week["days"][d] = "*" if code == "*" else ""
                    elif code not in KEEP_OUTSIDE_SESSIONS:
                        week["days"][d] = "С"
            # Коды недель заочной формы определяются графиком сессий — неуверенные ячейки не нужны
            table["uncertain"] = []
        result.sort(key=lambda c: c["course"])

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
            entry["required"] = is_required(code, entry["kind"])
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
                    "required": True,
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
            ["lecture", "laboratory", "practical", "seminar", "consultation"],
        )
        check = resolve(nums, eqs)
        entry = entries.setdefault(
            row.code, {"code": row.code, "name": row.name, "semesters": [], "issues": []}
        )
        if row.guessed_from is not None:
            note = (
                f"Индекс не распознан («{row.guessed_from}») и восстановлен по предыдущей строке — проверьте"
            )
            if note not in entry["issues"]:
                entry["issues"].append(note)
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
        return graph_days(table)

    @staticmethod
    def _split(days: list[tuple[dt.date, str]]) -> dt.date:
        return split_semesters(days)

    @staticmethod
    def _last_study_day(days: list[tuple[dt.date, str]]) -> dt.date:
        return last_study_day(days)

    @staticmethod
    def _runs(days: list[tuple[dt.date, str]]) -> list[tuple[str, dt.date, dt.date]]:
        return graph_runs(days)

    def _periods(self, course: int, days: list[tuple[dt.date, str]]) -> list[dict[str, Any]]:
        return graph_periods(course, days)

    # ------------------------------------------------------------------ итог
    def result(self, started: float) -> dict[str, Any]:
        self.on_progress(0.88, "Проверка сумм часов")
        self.title.update(self.header)
        calendar = self.calendar()
        items, stats = self.items()
        semesters, periods = self.semesters(calendar)
        if self.title.get("specialtyCode"):
            self.title["educationLevel"] = education_level(str(self.title["specialtyCode"]))
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
                "textPages": self.text_pages,
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
