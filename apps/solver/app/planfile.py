"""Импорт учебного плана из файла программы «Планы» (ММИС, GosInsp) — форматы .plx и .xml.

Оба формата совместимы с загрузкой в 1С:Университет:

* ``.plx`` — АС «Учебные планы» («синяя звезда»): XML-выгрузка набора данных (DataSet) с таблицами
  ``ООП``, ``Планы``, ``ПланыСтроки`` (строки плана), ``ПланыНовыеЧасы`` (часы по семестрам и видам
  работ), ``СправочникВидыРабот`` (виды работ и формы контроля), ``ПланыЦиклы`` и др.
* ``.xml`` — GosInsp («зелёная звезда»): ``<Документ><План><Титул …>`` с календарным графиком
  ``<ГрафикУчПроцесса><Курс График="…">`` и строками ``<СтрокиПлана><Строка Дис="…"><Сем Ном="1" Лек="…">``.

Результат имеет тот же вид, что и распознавание скана (см. ``ocr/plan.py``), поэтому дальше
используется та же форма проверки и то же создание учебного плана на сервере.

Названия таблиц, полей и атрибутов в разных версиях программы немного отличаются, поэтому поля
ищутся по нескольким вариантам имён без учёта регистра и пространств имён XML.
"""

from __future__ import annotations

import datetime as dt
import re
import time
import xml.etree.ElementTree as ET
from collections import defaultdict
from typing import Any

from .ocr.normalize import CYCLE_NAMES, index_prefix, is_vo_index, main_control
from .ocr.structure import (
    PROFESSIONAL_KINDS,
    education_level,
    graph_days,
    graph_periods,
    is_required,
    kind_of,
    last_study_day,
    module_code,
    monday_of_first_week,
    split_semesters,
)

Row = dict[str, str]

CODE_RE = re.compile(r"(?<![\d.])(\d{2})\.(\d{2})\.(\d{2})(?![\d.])")
HOUR_KEYS = (
    "lecture",
    "laboratory",
    "practical",
    "seminar",
    "consultation",
    "individualProject",
    "selfStudy",
    "assessment",
)
# Коды недель календарного графика → коды графика распознавания (ocr/plan.py, CODE_TYPES)
GRAPH_CODES = {
    "Т": "",
    "Т1": "",
    "Т2": "",
    " ": "",
    "": "",
    "Э": "Э",
    "Э1": "Э",
    "Э2": "Э",
    "ПА": "Э",
    "К": "К",
    "У": "У",
    "Н": "У",
    "П": "П",
    "ПП": "П",
    "Пд": "Пд",
    "ПД": "Пд",
    "Х": "Пд",
    "Д": "Д",
    "Г": "Г",
    "Гэ": "Г",
    "Ч": "Г",
    "*": "*",
    "=": "=",
    "С": "С",
}


class PlanFileError(ValueError):
    """Файл не является учебным планом поддерживаемого формата."""


# ---------------------------------------------------------------------------- общие функции


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _key(name: str) -> str:
    return _local(name).lower().replace("ё", "е").replace("_", "").replace(" ", "")


def fields(el: ET.Element) -> Row:
    """Поля строки набора данных: атрибуты и простые дочерние элементы (оба варианта выгрузки DataSet)."""
    row: Row = {}
    for child in el:
        if len(child) == 0 and child.text and child.text.strip():
            row[_key(child.tag)] = child.text.strip()
    for name, value in el.attrib.items():
        row[_key(name)] = value.strip()
    return row


def get(row: Row, *names: str) -> str:
    for name in names:
        value = row.get(_key(name))
        if value not in (None, ""):
            return value  # type: ignore[return-value]
    return ""


def num(text: str | None) -> float:
    if not text:
        return 0.0
    try:
        return float(text.replace(",", ".").replace(" ", "").replace("\xa0", ""))
    except ValueError:
        return 0.0


def _norm(text: str) -> str:
    return text.lower().replace("ё", "е").strip()


def read_xml(data: bytes) -> ET.Element:
    """Разбор XML. Внешние сущности ElementTree не загружает; рекурсивные сущности ограничивает expat."""
    if b"<!ENTITY" in data[:4096].upper():
        raise PlanFileError("Файл содержит объявления сущностей XML — такие файлы не принимаются")
    try:
        return ET.fromstring(data)
    except ET.ParseError as first:
        # Встречаются файлы без объявления кодировки в windows-1251
        for encoding in ("cp1251", "utf-16"):
            try:
                text = data.decode(encoding)
                text = re.sub(r"^\s*<\?xml[^>]*\?>", "", text)
                return ET.fromstring(text)
            except (UnicodeDecodeError, ET.ParseError):
                continue
        raise PlanFileError(f"Файл не является корректным XML: {first}") from first


def parse_specialty_text(text: str) -> tuple[str, str]:
    """«Специальность 40.02.04 Юриспруденция» → ("40.02.04", "Юриспруденция")."""
    m = CODE_RE.search(text)
    if not m:
        return "", ""
    code = ".".join(m.groups())
    name = text[m.end() :].strip(' .,-—:"«»')
    return code, name


def parse_duration(text: str) -> int | None:
    """Срок обучения: «2г 10м», «3 г. 10 мес.», «4 года», «3,83» (лет), «46» (месяцев)."""
    t = _norm(text)
    if not t:
        return None
    m = re.search(r"(\d+)\s*(?:г|л)\D*?(\d{1,2})\s*м", t)
    if m:
        return int(m.group(1)) * 12 + int(m.group(2))
    m = re.search(r"(\d+)\s*(?:г|л)", t)
    if m:
        return int(m.group(1)) * 12
    m = re.search(r"(\d{1,2})\s*м", t)
    if m:
        return int(m.group(1))
    value = num(t)
    if 0 < value <= 7:
        return round(value * 12)
    if 7 < value <= 96:
        return round(value)
    return None


def study_form_of(text: str) -> str | None:
    t = _norm(text)
    if not t:
        return None
    if "очно-заоч" in t or "очно заоч" in t or "вечерн" in t:
        return "PART_TIME"
    if "заоч" in t:
        return "EXTRAMURAL"
    if "очн" in t:
        return "FULL_TIME"
    return None


def parse_date(text: str) -> str | None:
    t = text.strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", t)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.match(r"^(\d{1,2})\.(\d{1,2})\.(\d{4})", t)
    if m:
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    return None


def control_of(name: str) -> str | None:
    """Форма контроля по названию вида работы («Экзамен», «Зачет с оценкой», «Курсовая работа»…)."""
    t = _norm(name)
    if not t:
        return None
    if "квалификац" in t or "по модулю" in t:
        return "QUALIFICATION_EXAM"
    if "курсов" in t:
        return "COURSE_PROJECT"
    if "дифференц" in t or "с оценкой" in t or t in ("зао", "зачо", "дз"):
        return "DIFFERENTIATED_CREDIT"
    if t.startswith("зачет") or t in ("за", "зач"):
        return "CREDIT"
    if t.startswith("экзамен") or t in ("эк", "экз"):
        return "EXAM"
    if "контрольн" in t or "реферат" in t or "другие формы" in t or "др. формы" in t or t == "др":
        return "OTHER"
    return None


def hour_key_of(name: str, abbr: str = "") -> str | None:
    """Вид нагрузки по названию вида работы; None — вид не учитывается (з.е., интерактивные часы…)."""
    t = _norm(name)
    a = _norm(abbr)
    skip = (
        "з.е",
        "зет",
        "зачетн",
        "интерактив",
        "электрон",
        "практической подготов",
        "практическая подготов",
        "контактн",
        "аудиторн",
        "недел",
        "в т.ч",
        "в том числе",
    )
    if any(s in t for s in skip) or a in ("зет", "з.е.", "з.е", "ze"):
        return None
    if "контроль самост" in t or a == "кср":
        return "consultation"
    if "лекц" in t or a == "лек":
        return "lecture"
    if "лаборатор" in t or a == "лаб":
        return "laboratory"
    if "семинар" in t:
        return "seminar"
    if "практическ" in t or a in ("пр", "пз"):
        return "practical"
    if "индивидуальн" in t and "проект" in t:
        return "individualProject"
    if "самостоят" in t or a in ("ср", "срс"):
        return "selfStudy"
    if "консультац" in t or a == "конс":
        return "consultation"
    if "контроль" in t or "промежуточн" in t or "аттестац" in t or a in ("каттэк", "конт"):
        return "assessment"
    if "итого" in t or "всего" in t or "трудоемк" in t or "объем" in t:
        return "total"
    return "other"


def _graph_code(symbol: str) -> str:
    s = symbol.strip()
    if s in GRAPH_CODES:
        return GRAPH_CODES[s]
    up = s.upper()
    if up in GRAPH_CODES:
        return GRAPH_CODES[up]
    return GRAPH_CODES.get(s[:1].upper(), "С")


def semester_of(course: int, semester: int, session: int = 0) -> int | None:
    """Номер семестра от начала обучения: семестр в курсе (1–2) или сессия заочной формы."""
    if semester > 2:
        return semester
    if course <= 0:
        return semester or None
    if semester in (1, 2):
        return 2 * (course - 1) + semester
    if session:
        return 2 * course - 1 if session == 1 else 2 * course
    return None


# ---------------------------------------------------------------------------- сборка результата


class PlanBuilder:
    """Сборка результата в формате распознавания скана из разобранных строк плана."""

    def __init__(self, source: str) -> None:
        self.source = source
        self.title: dict[str, Any] = {}
        self.warnings: list[str] = []
        # code → {"code", "name", "cycle", "semesters": {n: {"hours": {...}, "controls": set}}}
        self.rows: dict[str, dict[str, Any]] = {}
        self.calendar: list[dict[str, Any]] = []

    def row(self, code: str, name: str, cycle: str = "") -> dict[str, Any]:
        code = code.strip()
        entry = self.rows.get(code)
        if entry is None:
            entry = {"code": code, "name": " ".join(name.split()), "cycle": cycle, "semesters": {}}
            self.rows[code] = entry
        return entry

    @staticmethod
    def semester(entry: dict[str, Any], number: int) -> dict[str, Any]:
        sem = entry["semesters"].get(number)
        if sem is None:
            sem = {"hours": defaultdict(float), "controls": set()}
            entry["semesters"][number] = sem
        return sem

    def add_calendar_weeks(
        self, course: int, start_year: int, codes: list[str], per_day: bool = False
    ) -> None:
        """Календарный график курса: коды по неделям (или по дням) от первой недели сентября."""
        monday = monday_of_first_week(start_year)
        weeks = []
        if per_day:
            for i in range(0, len(codes), 6):
                chunk = codes[i : i + 6]
                days = chunk + [chunk[-1]] * (6 - len(chunk))
                weeks.append({"monday": (monday + dt.timedelta(weeks=i // 6)).isoformat(), "days": days})
        else:
            for i, code in enumerate(codes):
                weeks.append({"monday": (monday + dt.timedelta(weeks=i)).isoformat(), "days": [code] * 6})
        if weeks:
            self.calendar.append({"course": course, "startYear": start_year, "weeks": weeks, "uncertain": []})

    # ------------------------------------------------------------------ итог
    def result(self, started: float) -> dict[str, Any]:
        items = self._items()
        title = {k: v for k, v in self.title.items() if v not in (None, "")}
        if title.get("specialtyCode"):
            title["educationLevel"] = education_level(str(title["specialtyCode"]))
        used = {s["number"] for i in items for s in i["semesters"]}
        # Все семестры срока обучения (в том числе без строк плана: практика, ГИА)
        months = title.get("durationMonths") or 0
        last = max([*used, -(-int(months) // 6) if months else 0, 0])
        numbers = list(range(1, last + 1))
        if not title.get("admissionYear"):
            title["admissionYear"] = self.calendar[0]["startYear"] if self.calendar else dt.date.today().year
            self.warnings.append("В файле не указан год начала подготовки — проверьте год набора")
        semesters, periods = self._semesters(numbers, int(title["admissionYear"]))
        cycles = []
        group_names = {i["code"]: i["name"] for i in items if i["kind"] == "GROUP"}
        for code in dict.fromkeys(i["cycleCode"] for i in items if i["kind"] != "GROUP"):
            cycles.append({"code": code, "name": group_names.get(code) or CYCLE_NAMES.get(code, code)})
        if not title.get("specialtyCode"):
            self.warnings.append("Код специальности в файле не найден — заполните его вручную")
        if not title.get("qualification"):
            self.warnings.append("Квалификация в файле не указана — заполните её вручную")
        if not items:
            self.warnings.append("В файле не найдено строк учебного плана")
        return {
            "source": self.source,
            "title": title,
            "calendar": self.calendar,
            "semesters": semesters,
            "periods": periods,
            "cycles": cycles,
            "items": items,
            "pages": [],
            "warnings": self.warnings,
            "stats": {
                "pages": 0,
                "textPages": 0,
                "items": sum(1 for i in items if i["kind"] != "GROUP"),
                "corrected": 0,
                "uncertain": 0,
                "durationMs": round((time.monotonic() - started) * 1000),
            },
        }

    def _items(self) -> list[dict[str, Any]]:
        codes = set(self.rows)
        items: list[dict[str, Any]] = []
        for code, entry in self.rows.items():
            name = entry["name"] or code
            kind = kind_of(code, name, codes)
            low = _norm(name)
            if kind == "DISCIPLINE" and "практик" in low and not is_vo_index(code):
                kind = (
                    "PRE_DIPLOMA_PRACTICE"
                    if "преддиплом" in low
                    else "EDUCATIONAL_PRACTICE"
                    if "учебн" in low
                    else "INDUSTRIAL_PRACTICE"
                )
            elif kind == "DISCIPLINE" and ("итоговая аттестация" in low or "выпускной квалиф" in low):
                kind = "FINAL_ATTESTATION"
            issues: list[str] = []
            semesters = []
            for number in sorted(entry["semesters"]):
                sem = entry["semesters"][number]
                hours = {k: round(v) for k, v in sem["hours"].items() if k in HOUR_KEYS and v}
                parts = sum(hours.values()) + round(sem["hours"].get("other", 0))
                total = max(round(sem["hours"].get("total", 0)), parts)
                control = main_control(sorted(sem["controls"]))
                if not total and control == "NONE":
                    continue
                hours["total"] = total
                if "QUALIFICATION_EXAM" in sem["controls"] and kind == "MODULE":
                    control = "QUALIFICATION_EXAM"
                semesters.append({"number": number, "controlForm": control, "hours": hours, "cells": None})
            if not semesters and kind not in ("GROUP", "MODULE"):
                issues.append("В файле нет часов по семестрам для этой строки")
            items.append(
                {
                    "code": code,
                    "name": name,
                    "kind": kind,
                    "required": is_required(code, kind),
                    "issues": issues,
                    "semesters": semesters,
                    "fileCycle": entry["cycle"],
                }
            )
        groups = {i["code"] for i in items if i["kind"] == "GROUP"}
        for item in items:
            kind = item["kind"]
            item["parentCode"] = (
                module_code(item["code"]) if kind in PROFESSIONAL_KINDS and kind != "MODULE" else None
            )
            if kind in PROFESSIONAL_KINDS and not is_vo_index(item["code"]):
                item["cycleCode"] = "П"
            else:
                owners = [g for g in groups if item["code"].startswith(g + ".")]
                prefix = index_prefix(item["code"]) if "." in item["code"] else ""
                item["cycleCode"] = max(owners, key=len) if owners else (prefix or item["fileCycle"] or "ПР")
            del item["fileCycle"]
        # Экзамен по модулю (квалификационный) — отдельной строкой, как на скане
        for item in [i for i in items if i["kind"] == "MODULE" and i["semesters"]]:
            exams = [s for s in item["semesters"] if s["controlForm"] in ("QUALIFICATION_EXAM", "EXAM")]
            if exams:
                items.append(
                    {
                        "code": f"{item['code']}.ЭК",
                        "name": f"Экзамен по модулю {item['code']}",
                        "kind": "MODULE_EXAM",
                        "required": True,
                        "issues": [],
                        "semesters": [
                            {
                                **s,
                                "controlForm": "QUALIFICATION_EXAM",
                                "hours": {"total": s["hours"].get("total", 0)},
                            }
                            for s in exams
                        ],
                        "parentCode": item["code"],
                        "cycleCode": "П",
                    }
                )
            # Часы модуля — сумма МДК и практик, отдельно не импортируются
            item["semesters"] = []
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
                    "issues": ["Модуль не найден в файле и добавлен автоматически"],
                }
            )
        return items

    def _semesters(
        self, numbers: list[int], admission: int
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        by_course = {c["course"]: c for c in self.calendar}
        courses = sorted({(n + 1) // 2 for n in numbers} | set(by_course))
        semesters: list[dict[str, Any]] = []
        periods: list[dict[str, Any]] = []
        missing: list[int] = []
        for course in courses:
            table = by_course.get(course)
            days = graph_days(table) if table else []
            if days and any(code not in ("=", "*") for _, code in days):
                split = split_semesters(days)
                ranges = [(days[0][0], split), (split + dt.timedelta(days=1), last_study_day(days))]
                periods.extend(p for p in graph_periods(course, days) if p["type"] != "HOLIDAY")
            else:
                year = admission + course - 1
                ranges = [
                    (dt.date(year, 9, 1), dt.date(year + 1, 1, 31)),
                    (dt.date(year + 1, 2, 1), dt.date(year + 1, 6, 30)),
                ]
                days = []
                missing.append(course)
            for k, (start, end) in enumerate(ranges):
                number = 2 * course - 1 + k
                if number not in numbers and not days:
                    continue
                if start > end:
                    continue
                counts = {"theory": 0.0, "exam": 0.0, "vacation": 0.0, "practice": 0.0, "gia": 0.0}
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
                if days and number not in numbers and not any(counts.values()):
                    continue
                semesters.append(
                    {
                        "number": number,
                        "course": course,
                        "startDate": start.isoformat(),
                        "endDate": end.isoformat(),
                        "weeks": {key: round(v, 2) for key, v in counts.items()},
                    }
                )
        if missing:
            courses_text = ", ".join(str(c) for c in missing)
            self.warnings.append(
                f"Календарный график в файле не найден (курс: {courses_text}) — даты семестров "
                "заполнены по умолчанию (1 сентября – 31 января, 1 февраля – 30 июня), проверьте их"
            )
        return semesters, periods


# ---------------------------------------------------------------------------- .plx (АС «Учебные планы»)


def parse_plx(root: ET.Element, builder: PlanBuilder) -> None:
    tables: dict[str, list[Row]] = defaultdict(list)
    for el in root.iter():
        name = _local(el.tag)
        if el.attrib or len(el):
            tables[_key(name)].append(fields(el))

    def table(*names: str) -> list[Row]:
        for name in names:
            rows = tables.get(_key(name))
            if rows:
                return rows
        return []

    plans = table("Планы")
    plan = plans[0] if plans else {}
    plan_code = get(plan, "КодПлана", "Код")
    if len(plans) > 1:
        builder.warnings.append(f"В файле несколько учебных планов ({len(plans)}) — загружен первый")

    def own(rows: list[Row]) -> list[Row]:
        if len(plans) > 1 and plan_code:
            return [r for r in rows if get(r, "КодПлана") in ("", plan_code)]
        return rows

    # Титул: специальность (ООП), профиль, квалификация, год, форма и срок обучения
    title = builder.title
    oops = table("ООП")
    main_oop = next((o for o in oops if CODE_RE.search(get(o, "Шифр"))), oops[0] if oops else {})
    code = get(main_oop, "Шифр")
    m = CODE_RE.search(code)
    title["specialtyCode"] = ".".join(m.groups()) if m else ""
    title["specialtyName"] = get(main_oop, "Название", "Наименование")
    profile = next(
        (
            get(o, "Название")
            for o in oops
            if o is not main_oop and get(o, "КодРодителя") == get(main_oop, "Код")
        ),
        "",
    )
    if profile:
        title["profile"] = profile
    if not title["specialtyCode"]:
        for value in [*plan.values(), *(v for o in oops for v in o.values())]:
            c, n = parse_specialty_text(value)
            if c:
                title["specialtyCode"], title["specialtyName"] = c, title["specialtyName"] or n
                break
    qualification = get(plan, "Квалификация", "НазваниеКвалификации")
    if not qualification:
        for name, rows in tables.items():
            if "квалификац" in name and rows:
                qualification = get(rows[0], "Квалификация", "Название", "Наименование")
                if qualification:
                    break
    title["qualification"] = qualification
    year = get(plan, "ГодНачалаПодготовки", "ГодНачала", "Год")
    if re.fullmatch(r"20\d{2}", year):
        title["admissionYear"] = int(year)
    form_text = get(plan, "ФормаОбучения")
    if not form_text:
        form_code = get(plan, "КодФормыОбучения", "КодФормаОбучения")
        for name, rows in tables.items():
            if "формаобучения" in name or "формыобучения" in name:
                for r in rows:
                    if get(r, "Код") == form_code:
                        form_text = get(r, "ФормаОбучения", "Название", "Наименование")
    title["studyForm"] = study_form_of(form_text) or "FULL_TIME"
    months = parse_duration(get(plan, "СрокОбучения", "СрокПолученияОбразования"))
    if months is None:
        years_, months_ = num(get(plan, "СрокЛет", "СрокОбученияЛет")), num(get(plan, "СрокМесяцев"))
        if years_ or months_:
            months = round(years_ * 12 + months_)
    title["durationMonths"] = months
    for key, value in plan.items():
        if "гос" in key and "дата" in key and not title.get("fgosDate"):
            title["fgosDate"] = parse_date(value)
        elif "гос" in key and "номер" in key and not title.get("fgosNumber"):
            title["fgosNumber"] = value

    # Виды работ: код → (вид нагрузки, форма контроля)
    work_types: dict[str, tuple[str | None, str | None]] = {}
    for name, rows in tables.items():
        if name.startswith("справочниквидыработ") or name.startswith("справочниквидовработ"):
            for r in rows:
                title_ = get(r, "Название", "Наименование")
                abbr = get(r, "Аббревиатура", "Сокращение")
                control = control_of(title_) or control_of(abbr)
                work_types[get(r, "Код")] = (None if control else hour_key_of(title_, abbr), control)

    # Строки плана
    lines = own(table("ПланыСтроки"))
    cycles_by_id: dict[str, str] = {}
    for name, rows in tables.items():
        if "циклы" in name or "блоки" in name:
            for r in rows:
                cycles_by_id[get(r, "Код")] = get(r, "Цикл", "Идентификатор", "Индекс", "Аббревиатура")
    entries: dict[str, dict[str, Any]] = {}
    for r in lines:
        code_ = get(r, "ДисциплинаКод", "Индекс", "ИндексДисциплины", "НовИдДисциплины")
        name_ = get(r, "Дисциплина", "Наименование", "Название")
        if not code_ or not name_:
            continue
        if "." not in code_ and not re.search(r"\d", code_):
            continue  # строка цикла («ОГСЭ», «Б1») — цикл определяется по индексу
        entries[get(r, "Код")] = builder.row(
            code_, name_, cycles_by_id.get(get(r, "КодБлока", "КодЦикла"), "")
        )
    if not entries:
        raise PlanFileError("В файле .plx не найдено строк учебного плана (таблица «ПланыСтроки»)")

    # Часы и формы контроля по семестрам
    hour_rows = []
    for name, rows in tables.items():
        if name == "планыстроки" or not rows:
            continue
        sample = rows[0]
        if _key("КодОбъекта") in sample and (
            _key("КодВидаРабот") in sample or _key("КодВидаКонтроля") in sample
        ):
            hour_rows.extend(own(rows))
    kinds = {get(r, "КодТипаЧасов") for r in hour_rows}
    base_kind = "1" if "1" in kinds else None
    unknown_types: set[str] = set()
    for r in hour_rows:
        entry = entries.get(get(r, "КодОбъекта"))
        if entry is None:
            continue
        if base_kind and get(r, "КодТипаЧасов") not in ("", base_kind):
            continue  # интерактивные / электронные часы — часть основных
        number = semester_of(
            int(num(get(r, "Курс"))), int(num(get(r, "Семестр"))), int(num(get(r, "Сессия")))
        )
        if not number:
            continue
        type_code = get(r, "КодВидаРабот", "КодВидаКонтроля")
        hour_key, control = work_types.get(type_code, ("other", None))
        if type_code not in work_types:
            unknown_types.add(type_code)
        amount = num(get(r, "Количество", "Часов", "Значение"))
        sem = builder.semester(entry, number)
        if control:
            if amount or _key("Количество") not in r:
                sem["controls"].add(control)
        elif hour_key and amount:
            sem["hours"][hour_key] += amount
    if unknown_types and work_types:
        builder.warnings.append(
            "Неизвестные коды видов работ (часы учтены в общем объёме): " + ", ".join(sorted(unknown_types))
        )
    _plx_calendar(tables, builder, title.get("admissionYear"))


def _plx_calendar(tables: dict[str, list[Row]], builder: PlanBuilder, admission: int | None) -> None:
    """Календарный график .plx: ячейки графика (курс, неделя, [день]) со ссылкой на вид деятельности."""
    symbols: dict[str, str] = {}
    for name, rows in tables.items():
        if "справочник" in name and ("деятельност" in name or "график" in name or "обозначен" in name):
            for r in rows:
                symbol = get(r, "Символ", "Обозначение", "Аббревиатура", "КраткоеНазвание")
                if symbol:
                    symbols[get(r, "Код")] = symbol
    for name, rows in tables.items():
        if "график" not in name or "справочник" in name or not rows:
            continue
        sample = rows[0]
        week_field = next((f for f in ("НомерНедели", "Неделя", "НомерНед") if _key(f) in sample), None)
        if not week_field or _key("Курс") not in sample:
            continue
        per_day = _key("ДеньНедели") in sample or _key("НомерДня") in sample
        grid: dict[int, dict[int, str]] = defaultdict(dict)
        for r in rows:
            course = int(num(get(r, "Курс")))
            week = int(num(get(r, week_field)))
            if course <= 0 or week <= 0:
                continue
            ref = get(r, "КодВидаДеятельности", "КодДеятельности", "КодОбозначения", "КодВидаГрафика")
            symbol = symbols.get(ref) or get(r, "Символ", "Обозначение")
            if not symbol and not ref:
                continue
            code = _graph_code(symbol)
            index = (
                (week - 1) * 6 + int(num(get(r, "ДеньНедели", "НомерДня")) or 1) - 1 if per_day else week - 1
            )
            grid[course][index] = code
        for course, cells in sorted(grid.items()):
            if admission is None:
                break
            size = max(cells) + 1
            codes = [cells.get(i, "") for i in range(size)]
            builder.add_calendar_weeks(course, admission + course - 1, codes, per_day=per_day)
        if builder.calendar:
            return


# ---------------------------------------------------------------------------- .xml (GosInsp)

GOSINSP_HOURS = {
    "лек": "lecture",
    "лаб": "laboratory",
    "пр": "practical",
    "сем": "seminar",
    "срс": "selfStudy",
    "ср": "selfStudy",
    "кср": "consultation",
    "конс": "consultation",
    "консультации": "consultation",
    "ип": "individualProject",
    "часэкз": "assessment",
    "контроль": "assessment",
    "конт": "assessment",
    "па": "assessment",
    "часов": "total",
    "всего": "total",
}
GOSINSP_CONTROLS = {
    "экз": "EXAM",
    "зач": "CREDIT",
    "зачо": "DIFFERENTIATED_CREDIT",
    "дифзач": "DIFFERENTIATED_CREDIT",
    "кп": "COURSE_PROJECT",
    "кр": "COURSE_PROJECT",
    "кнтр": "OTHER",
    "реф": "OTHER",
    "эссе": "OTHER",
}
# Коды видов занятий в элементах <VZ ID="101" H="36"/>
VZ_CODES = {
    "101": "lecture",
    "102": "laboratory",
    "103": "practical",
    "106": "consultation",
    "107": "selfStudy",
    "108": "assessment",
}


def _semester_list(text: str) -> list[int]:
    """«34» → [3, 4]; «3,4» → [3, 4]; «A» → [10] (семестры записываются цифрами, 10+ — буквами)."""
    t = text.strip()
    if not t:
        return []
    if re.search(r"[,; ]", t):
        return [int(p) for p in re.split(r"[,; ]+", t) if p.isdigit()]
    result = []
    for ch in t:
        if ch.isdigit() and ch != "0":
            result.append(int(ch))
        elif ch.upper() in "ABC":
            result.append(10 + "ABC".index(ch.upper()))
    return result


def _semester_elements(row: ET.Element) -> list[tuple[int, ET.Element]]:
    """Элементы часов строки: <Сем Ном="3"> или <Курс Ном="2"><Сессия Ном="1"> (заочная форма)."""
    result: list[tuple[int, ET.Element]] = []
    for child in row:
        tag = _local(child.tag)
        if tag == "Сем":
            number = int(num(child.get("Ном")))
            if number > 0:
                result.append((number, child))
        elif tag == "Курс":
            course = int(num(child.get("Ном")))
            for sub in child:
                sub_tag = _local(sub.tag)
                if sub_tag == "Сессия":
                    number = semester_of(course, 0, int(num(sub.get("Ном")))) or 0
                elif sub_tag in ("Семестр", "Сем"):
                    number = semester_of(course, int(num(sub.get("Ном")))) or 0
                else:
                    continue
                if number > 0:
                    result.append((number, sub))
    return result


def parse_gosinsp(root: ET.Element, builder: PlanBuilder) -> None:
    plan = next((el for el in root.iter() if _local(el.tag) == "План"), root)
    title_el = next((el for el in plan.iter() if _local(el.tag) == "Титул"), None)
    title = builder.title
    t = fields(title_el) if title_el is not None else {}
    p = {_key(k): v for k, v in plan.attrib.items()}

    specialties = (
        [] if title_el is None else [el for el in title_el.iter() if _local(el.tag) == "Специальность"]
    )
    for el in specialties:
        code, name = parse_specialty_text(el.get("Название", ""))
        if code and not title.get("specialtyCode"):
            title["specialtyCode"], title["specialtyName"] = code, name
        elif not code and el.get("Название") and title.get("specialtyCode") and "profile" not in title:
            title["profile"] = re.sub(
                r"^(Профиль|Направленность)[^:]*:?\s*", "", el.get("Название", "")
            ).strip()
    if not title.get("specialtyCode"):
        for value in [*t.values(), *p.values()]:
            code, name = parse_specialty_text(value)
            if code:
                title["specialtyCode"], title["specialtyName"] = code, name
                break
    qualifications = (
        [] if title_el is None else [el for el in title_el.iter() if _local(el.tag) == "Квалификация"]
    )
    if qualifications:
        q = qualifications[0]
        title["qualification"] = q.get("Название", "").strip()
        title["durationMonths"] = parse_duration(q.get("СрокОбучения", ""))
    if not title.get("durationMonths"):
        title["durationMonths"] = parse_duration(get(t, "СрокОбучения") or get(p, "СрокОбучения"))
    year = get(t, "ГодНачалаПодготовки") or get(p, "ГодНачалаПодготовки")
    if re.fullmatch(r"20\d{2}", year):
        title["admissionYear"] = int(year)
    form = ""
    for key, value in [*p.items(), *t.items()]:
        if "форм" in key and study_form_of(value):
            form = value
            break
    title["studyForm"] = study_form_of(form) or "FULL_TIME"
    title["fgosDate"] = parse_date(get(t, "ДатаГОСа", "ДатаФГОС") or "")
    title["fgosNumber"] = get(t, "НомерГОСа", "НомерФГОС") or None

    # Календарный график: <ГрафикУчПроцесса><Курс Ном="1" График="ТТТ…ЭЭКК…"/>
    admission = title.get("admissionYear")
    graph = next((el for el in plan.iter() if _local(el.tag) == "ГрафикУчПроцесса"), None)
    if graph is not None and admission:
        for course_el in graph:
            if _local(course_el.tag) != "Курс":
                continue
            course = int(num(course_el.get("Ном")))
            text = course_el.get("График", "")
            if course <= 0 or not text:
                continue
            per_day = len(text) > 70
            codes = [_graph_code(ch) for ch in text]
            builder.add_calendar_weeks(course, admission + course - 1, codes, per_day=per_day)

    rows_el = next((el for el in plan.iter() if _local(el.tag) == "СтрокиПлана"), None)
    if rows_el is None:
        raise PlanFileError("В файле .xml нет раздела «СтрокиПлана»")
    for el in rows_el:
        if _local(el.tag) != "Строка":
            continue
        a = fields(el)
        name = get(a, "Дис", "Дисциплина", "Наименование")
        new_code = get(a, "НовИдДисциплины")
        code = (
            new_code
            if new_code and "." in new_code
            else get(a, "ИдетификаторДисциплины", "ИдентификаторДисциплины")
        )
        code = code or new_code
        if not name or not code:
            continue
        entry = builder.row(code, name, get(a, "НовЦикл", "Цикл"))
        found_controls = False
        for number, sem_el in _semester_elements(el):
            sem = builder.semester(entry, number)
            for attr, value in sem_el.attrib.items():
                k = _key(attr)
                if k in GOSINSP_CONTROLS and num(value):
                    sem["controls"].add(GOSINSP_CONTROLS[k])
                    found_controls = True
                elif k in GOSINSP_HOURS:
                    sem["hours"][GOSINSP_HOURS[k]] += num(value)
            for vz in sem_el:
                if _local(vz.tag).upper() == "VZ":
                    key = VZ_CODES.get(vz.get("ID", ""), "other")
                    sem["hours"][key] += num(vz.get("H"))
        if not found_controls:
            for attr, form in (
                ("СемЭкз", "EXAM"),
                ("СемЗач", "CREDIT"),
                ("СемЗачО", "DIFFERENTIATED_CREDIT"),
                ("СемКП", "COURSE_PROJECT"),
                ("СемКР", "COURSE_PROJECT"),
            ):
                for number in _semester_list(get(a, attr)):
                    builder.semester(entry, number)["controls"].add(form)

    # Практики, вынесенные в отдельный раздел (<ПрочиеПрактики>, <УчебПрактики>, …)
    known_names = {_norm(e["name"]) for e in builder.rows.values()}
    counter = 0
    for el in plan.iter():
        tag = _local(el.tag)
        if "практик" not in tag.lower() or tag in ("СтрокиПлана", "Строка"):
            continue
        name = el.get("Наименование") or el.get("Название") or ""
        if not name or _norm(name) in known_names:
            continue
        sems = [s for s in el if _local(s.tag) in ("Семестр", "Сем")]
        if not sems:
            continue
        counter += 1
        code = el.get("НовИдДисциплины") or el.get("Индекс") or f"ПР.{counter:02d}"
        entry = builder.row(code, name, "Б2" if code.startswith("Б2") else "")
        for s in sems:
            number = int(num(s.get("Ном")))
            if number <= 0:
                continue
            sem = builder.semester(entry, number)
            hours = num(s.get("ПланЧасов") or s.get("Часов"))
            weeks = num(s.get("ПланНед") or s.get("Недель"))
            sem["hours"]["total"] += hours or weeks * 36
            for attr, value in s.attrib.items():
                k = _key(attr)
                if k in GOSINSP_CONTROLS and num(value):
                    sem["controls"].add(GOSINSP_CONTROLS[k])
        known_names.add(_norm(name))


# ---------------------------------------------------------------------------- точка входа


def import_plan_file(path: str) -> dict[str, Any]:
    started = time.monotonic()
    with open(path, "rb") as fh:
        data = fh.read()
    root = read_xml(data)
    tags = {_local(el.tag) for el in root.iter()}
    if "ПланыСтроки" in tags:
        builder = PlanBuilder("plx")
        parse_plx(root, builder)
    elif "СтрокиПлана" in tags:
        builder = PlanBuilder("gosinsp")
        parse_gosinsp(root, builder)
    else:
        raise PlanFileError(
            "Файл не похож на учебный план программы «Планы»: нет таблицы «ПланыСтроки» (.plx) "
            "и раздела «СтрокиПлана» (.xml GosInsp)"
        )
    return builder.result(started)
