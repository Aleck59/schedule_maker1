"""Тесты распознавания сканов учебного плана: нормализация, проверка сумм, разбор графика, OCR таблицы."""

from __future__ import annotations

import datetime as dt
import shutil

import cv2
import numpy as np
import pytest

from app.ocr.calendar import _guess_year, _monday_of_first_week, normalize_code
from app.ocr.checks import build_equations, make_num, resolve
from app.ocr.normalize import main_control, norm_index, parse_control, parse_int, parse_period_weeks
from app.ocr.plan import Recognizer, kind_of, module_code, repair_codes
from app.ocr.table import detect_cells, ocr_cells
from app.ocr.title import parse_title

HAS_TESSERACT = shutil.which("tesseract") is not None


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("СГ.01", "СГ.01"),
        ("0П.02", "ОП.02"),
        ("оп.06", "ОП.06"),
        ("0пП.01", "ОП.01"),
        ("COO.01.01", "СОО.01.01"),
        ("МДК.01.02", "МДК.01.02"),
        ("ПМ.03.01(К)", "ПМ.03.01(К)"),
        ("ГИА.01(Г)", "ГИА.01(Г)"),
        ("История России", None),
        ("", None),
    ],
)
def test_norm_index(raw, expected):
    assert norm_index(raw) == expected


def test_control_forms_and_weeks():
    assert parse_control("Эк") == ["EXAM"]
    assert parse_control("За КР") == ["CREDIT", "COURSE_PROJECT"]
    assert parse_control("3а0(2)") == ["DIFFERENTIATED_CREDIT"]
    assert parse_control("Эк зао Др(3)") == ["EXAM", "DIFFERENTIATED_CREDIT", "OTHER"]
    assert main_control(parse_control("Др За")) == "CREDIT"
    assert main_control([]) == "NONE"
    assert parse_period_weeks("ТО: 18 2/3 Э: 2") == {"theory": 18.667, "exam": 2.0}
    assert parse_period_weeks("ТО: 2 1/2 Э: 1/2") == {"theory": 2.5, "exam": 0.5}
    assert parse_int("1О8") == 108
    assert parse_int("Эк") is None


def test_resolve_uses_second_reading():
    blocks = ["3", "4", "course"]
    nums = {
        ("3", "total"): make_num("72", None),
        ("3", "contact"): make_num("58", "68"),  # первое прочтение ошибочно
        ("3", "lecture"): make_num("32", None),
        ("3", "practical"): make_num("18", None),
        ("3", "seminar"): make_num("18", None),
        ("3", "selfStudy"): make_num("4", None),
        ("course", "total"): make_num("72", None),
        ("course", "contact"): make_num("68", None),
        ("course", "lecture"): make_num("32", None),
        ("course", "practical"): make_num("18", None),
        ("course", "seminar"): make_num("18", None),
        ("course", "selfStudy"): make_num("4", None),
    }
    eqs = build_equations(blocks, ["3", "4"], ["lecture", "laboratory", "practical", "seminar"])
    result = resolve(nums, eqs)
    assert not result.failed
    assert nums[("3", "contact")].value == 68
    assert nums[("3", "contact")].status == "corrected"


def test_resolve_single_cell_and_unreadable():
    eqs = build_equations(["5", "6", "course"], ["5", "6"], ["lecture", "laboratory", "practical", "seminar"])
    nums = {
        ("5", "total"): make_num("108", None),
        ("5", "contact"): make_num("80", None),
        ("5", "lecture"): make_num("18", None),
        ("5", "practical"): make_num("46", None),
        ("5", "seminar"): make_num("16", None),
        ("5", "selfStudy"): make_num("4", None),  # должно быть 1
        ("5", "assessment"): make_num("27", None),
        ("course", "total"): make_num("108", None),
        ("course", "contact"): make_num("80", None),
        ("course", "lecture"): make_num("18", None),
        ("course", "practical"): make_num("46", None),
        ("course", "seminar"): make_num("16", None),
        ("course", "selfStudy"): make_num("1", None),
        ("course", "assessment"): make_num("27", None),
    }
    assert not resolve(nums, eqs).failed
    assert nums[("5", "selfStudy")].value == 1

    nums2 = {
        ("5", "total"): make_num("237", None),
        ("5", "contact"): make_num("160", None),
        ("5", "lecture"): make_num("64", None),
        ("5", "practical"): make_num("64", None),
        ("5", "seminar"): make_num("32", None),
        ("5", "selfStudy"): make_num("у", None),  # не прочитано
    }
    eqs2 = build_equations(["5"], ["5"], ["lecture", "laboratory", "practical", "seminar"])
    assert not resolve(nums2, eqs2).failed
    assert nums2[("5", "selfStudy")].value == 77


def test_resolve_marks_uncertain_when_ambiguous():
    eqs = build_equations(["1"], ["1"], ["lecture", "laboratory", "practical", "seminar"])
    nums = {
        ("1", "total"): make_num("90", None),
        ("1", "contact"): make_num("70", None),
        ("1", "lecture"): make_num("30", None),
        ("1", "practical"): make_num("30", None),
    }
    result = resolve(nums, eqs)
    assert result.failed
    assert any(n.status == "uncertain" for n in nums.values())


def test_item_kinds_parents_and_repair():
    codes = {
        "СОО.01.01",
        "СОО.02",
        "СОО.02.01",
        "ПМ.01",
        "МДК.01.02",
        "УП.01.01",
        "ПМ.01.01(К)",
        "ГИА.01(Г)",
        "СГ.01",
    }
    assert kind_of("СОО.02", "Профильные дисциплины", codes) == "GROUP"
    assert kind_of("ПМ.01", "Правоприменительная деятельность", codes) == "MODULE"
    assert kind_of("ПМ.01.01(К)", "Экзамен по модулю", codes) == "MODULE_EXAM"
    assert kind_of("УП.01.01", "Учебная практика", codes) == "EDUCATIONAL_PRACTICE"
    assert kind_of("ГИА.01(Г)", "Демонстрационный экзамен", codes) == "FINAL_ATTESTATION"
    assert kind_of("СГ.01", "История России", codes) == "DISCIPLINE"
    assert module_code("МДК.01.02") == "ПМ.01"
    assert module_code("ПМ.01.0(К)") == "ПМ.01"
    assert module_code("СГ.01") is None
    assert repair_codes(["ОО.01", "СОО.01.01", "СОО.01.02"]) == {"ОО.01": "СОО.01"}


def test_calendar_codes_year_and_semesters():
    assert normalize_code("Э") == "Э"
    assert normalize_code("Е") == "Э"
    assert normalize_code("Ш") == "П"
    assert normalize_code("Пд") == "Пд"
    assert normalize_code("=") == "="
    assert normalize_code("") == "?"
    # 1 сентября 2026 — вторник; неделя 1 начинается 31 августа
    assert _monday_of_first_week(2026) == dt.date(2026, 8, 31)
    monday = _monday_of_first_week(2026)
    rows = [[(w, (monday + dt.timedelta(days=7 * w + d)).day) for w in range(1, 10)] for d in range(7)]
    assert _guess_year(rows, 2025) == (2026, 1.0)
    assert _guess_year(rows, 2026) == (2026, 1.0)

    # Учебный год: 19 недель теории, 2 недели аттестации, 2 недели каникул, далее теория
    year = 2026
    weeks = []
    for w in range(53):
        code = "Э" if w in (19, 20) else "К" if w in (21, 22) or w >= 44 else ""
        weeks.append(
            {"number": w + 1, "monday": (monday + dt.timedelta(days=7 * w)).isoformat(), "days": [code] * 6}
        )
    days = Recognizer._days({"startYear": year, "weeks": weeks})
    split = Recognizer._split(days)
    assert split == dt.date(2027, 2, 7)
    periods = Recognizer()._periods(1, days)
    assert [p["type"] for p in periods] == ["EXAM_SESSION", "VACATION", "VACATION"]
    assert periods[0]["startDate"] == "2027-01-11" and periods[0]["weeks"] == 2.0


def test_title_parse_from_text():
    text = """УЧЕБНЫЙ ПЛАН
40.02.04 Юриспруденция
Направленность Юрист в сфере социального обеспечения
2026
2026-2027
Протокол № 10 от 14.07.2026
№ 798 от 27.10.2023"""

    class C:
        def __init__(self, text: str) -> None:
            self.text = text

    cells = [
        C("Квалификация: Юрист"),
        C("Форма обучения: Очная"),
        C("Срок получения образования по ОП: 2 г. 10 м."),
    ]
    title = parse_title(cells, text)  # type: ignore[arg-type]
    assert title["specialtyCode"] == "40.02.04"
    assert title["specialtyName"] == "Юриспруденция"
    assert title["qualification"] == "Юрист"
    assert title["studyForm"] == "FULL_TIME"
    assert title["durationMonths"] == 34
    assert title["admissionYear"] == 2026
    assert title["fgosNumber"] == "798" and title["fgosDate"] == "2023-10-27"
    assert title["profile"] == "Юрист в сфере социального обеспечения"


def _synthetic_table(rows: list[list[str]], cell_w: int = 140, cell_h: int = 60) -> np.ndarray:
    h, w = len(rows) * cell_h + 80, len(rows[0]) * cell_w + 80
    img = np.full((h, w), 255, np.uint8)
    for r, row in enumerate(rows):
        for c, text in enumerate(row):
            x, y = 40 + c * cell_w, 40 + r * cell_h
            cv2.rectangle(img, (x, y), (x + cell_w, y + cell_h), 0, 2)
            if text:
                cv2.putText(img, text, (x + 25, y + 42), cv2.FONT_HERSHEY_SIMPLEX, 1.1, 0, 2, cv2.LINE_AA)
    return img


@pytest.mark.skipif(not HAS_TESSERACT, reason="tesseract не установлен")
def test_detect_and_ocr_table_cells():
    rows = [["72", "68", "32", ""], ["144", "104", "", "27"], ["90", "", "18", "9"]]
    img = _synthetic_table(rows)
    cells = detect_cells(img)
    assert len(cells) == 12
    ocr_cells(img, cells)
    values = sorted(((c.y, c.x), c.text if not c.empty else "") for c in cells)
    texts = [t for _, t in values]
    assert texts == [t for row in rows for t in row]
