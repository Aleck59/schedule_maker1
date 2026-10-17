"""Высшее образование и цифровые PDF: индексы и виды строк ВО, текстовый слой, сессии заочной формы."""

from __future__ import annotations

import datetime as dt

import numpy as np

from app.ocr.pdftext import Glyph, _stamp_range, fill_cells, page_text, text_of
from app.ocr.plan import Recognizer, is_required, kind_of
from app.ocr.semesters import find_blocks, semester_number
from app.ocr.sessions import parse_date_ru, parse_session_schedule, session_semester
from app.ocr.table import Cell
from app.ocr.title import education_level, parse_plan_header


def test_vo_item_kinds_and_electives():
    codes = {
        "Б1.О.01",
        "Б1.О.01.01",
        "Б1.В.ДВ.01",
        "Б1.В.ДВ.01.01",
        "Б1.В.ДВ.01.02",
        "Б2.О.01(У)",
        "Б2.В.02(Пд)",
        "Б3.01(Д)",
        "ФТД.01",
        "К.М.01",
        "К.М.01.01",
    }
    assert kind_of("Б1.О.01", "Общеобразовательный модуль", codes) == "GROUP"
    assert kind_of("Б1.О.01.01", "История России", codes) == "DISCIPLINE"
    assert kind_of("Б1.В.ДВ.01", "Дисциплины по выбору", codes) == "GROUP"
    assert kind_of("Б2.О.01(У)", "Учебная практика", codes) == "EDUCATIONAL_PRACTICE"
    assert kind_of("Б2.В.02(Пд)", "Преддипломная практика", codes) == "PRE_DIPLOMA_PRACTICE"
    assert kind_of("Б3.01(Д)", "Защита ВКР", codes) == "FINAL_ATTESTATION"
    assert kind_of("ФТД.01", "Факультатив", codes) == "ELECTIVE"
    assert kind_of("К.М.01", "Физическая культура и спорт", codes) == "GROUP"
    # Первая дисциплина блока по выбору — по умолчанию, остальные и факультативы — только выбравшим
    assert is_required("Б1.В.ДВ.01.01", "DISCIPLINE")
    assert not is_required("Б1.В.ДВ.01.02", "DISCIPLINE")
    assert not is_required("ФТД.01", "ELECTIVE")
    assert is_required("СГ.01", "DISCIPLINE")


def test_education_level_and_plan_header():
    assert education_level("38.02.01") == "SPO"
    assert education_level("40.03.01") == "BACHELOR"
    assert education_level("38.04.01") == "MASTER"
    assert education_level("31.05.01") == "SPECIALIST"
    header = parse_plan_header(
        "Учебный план бакалавриата '40.03.01 Юр(гос)(В)26.plx', код направления 40.03.01, "
        "направленность (профиль) : Государственно-правовой, год начала подготовки 2026"
    )
    assert header == {
        "specialtyCode": "40.03.01",
        "admissionYear": 2026,
        "profile": "Государственно-правовой",
    }
    spo = parse_plan_header(
        "Учебный план ППССЗ СПО '38.02.01 ЭБУ(9кл)26ак.plx', код специальности 38.02.01, год начала подготовки 2025"
    )
    assert spo == {"specialtyCode": "38.02.01", "admissionYear": 2025}


def _word(text: str, x: float, y: float, h: float = 10.0, w: float = 6.0) -> list[Glyph]:
    return (
        [Glyph(ch, x + i * w, y, x + (i + 1) * w, y + h) for i, ch in enumerate(text) if ch != " "]
        if text
        else []
    )


def test_text_layer_cells_and_page_text():
    # Две строки в ячейке, пробелы по расстояниям между символами, перенос слова через «-»
    glyphs = (
        _word("Иностранный", 10, 10)
        + _word("язык", 82, 10)
        + _word("инфор-", 10, 24)
        + _word("мация", 10, 38)
    )
    assert text_of(glyphs) == "Иностранный язык информация"
    # Далеко отстоящие фрагменты одной строки разделяются двумя пробелами
    line = _word("Квалификация:", 10, 100) + _word("Бухгалтер", 92, 100) + _word("2026", 400, 100)
    assert page_text(line) == "Квалификация: Бухгалтер  2026"

    labels = np.zeros((60, 200), dtype=np.int32)
    labels[0:30, 0:100] = 1
    labels[0:30, 100:200] = 2
    labels[30:60, 0:200] = 3
    a, b, c = Cell(0, 0, 100, 30), Cell(100, 0, 100, 30), Cell(0, 30, 200, 30)
    fill_cells([a, b, c], labels, {1: a, 2: b, 3: c}, _word("СГ.01", 5, 8) + _word("72", 120, 8))
    assert (a.text, b.text, c.text) == ("СГ.01", "72", "")
    assert c.empty and not a.empty and a.alt is None


def test_signature_stamp_is_skipped():
    text = (
        "Документ подписан простой электронной подписью\r\nИнформация о владельце:\r\nФИО: Иванов\r\n"
        "Уникальный программный ключ:\r\n185097543b3f0c685df3cd54a5e24d47608e4131\r\nУЧЕБНЫЙ ПЛАН"
    )
    rng = _stamp_range(text)
    assert rng is not None
    assert text[rng.stop :].strip() == "УЧЕБНЫЙ ПЛАН"
    assert _stamp_range("УЧЕБНЫЙ ПЛАН") is None


def test_hex_semesters_and_session_blocks():
    assert semester_number("9") == 9
    assert semester_number("A") == 10
    assert semester_number("С") == 12
    cells = [
        Cell(1000, 100, 600, 40, text="Установочная сессия"),
        Cell(1600, 100, 600, 40, text="Зимняя сессия"),
        Cell(2200, 100, 600, 40, text="Летняя сессия"),
        Cell(2800, 100, 600, 40, text="Итого за курс"),
    ]
    blocks = find_blocks(cells, course=2)
    assert [(b.number, b.session) for b in blocks] == [(3, True), (3, True), (4, True), (None, False)]
    numbered = [Cell(1000, 100, 600, 40, text="Сессия 1"), Cell(1600, 100, 600, 40, text="Сессия 2")]
    assert [b.number for b in find_blocks(numbered, course=1)] == [1, 2]
    assert session_semester(3, "Сессия", 0, 3) == 5
    assert session_semester(3, "", 2, 3) == 6


def test_session_schedule_and_extramural_calendar():
    assert parse_date_ru("22 сентября 2025 г.") == dt.date(2025, 9, 22)
    assert parse_date_ru("З ноября 2025 г.") == dt.date(2025, 11, 3)
    assert parse_date_ru("нет даты") is None
    cells = [
        Cell(680, 2858, 670, 27, text="Курс 1"),
        Cell(680, 2889, 221, 26, text="'Установочная сессия"),
        Cell(906, 2889, 219, 26, text="Зимняя сессия"),
        Cell(1130, 2889, 220, 26, text="Летняя сессия"),
        Cell(399, 2950, 277, 26, text="Дата начала/Номер недели"),
        Cell(680, 2950, 189, 26, text="22 сентября 2025 г."),
        Cell(906, 2950, 188, 26, text="З ноября 2025 г."),
        Cell(1130, 2950, 188, 27, text="25 мая 2026 г."),
        Cell(399, 2980, 277, 26, text="Дата окончания/Номер недели"),
        Cell(680, 2980, 189, 26, text="27 сентября 2025 г."),
        Cell(906, 2980, 188, 26, text="16 ноября 2025 г."),
        Cell(1130, 2981, 188, 25, text="13 июня 2026 г."),
    ]
    sessions = parse_session_schedule(cells)
    assert [(s.course, s.name, s.start.isoformat(), s.end.isoformat()) for s in sessions] == [
        (1, "Установочная", "2025-09-22", "2025-09-27"),
        (1, "Зимняя", "2025-11-03", "2025-11-16"),
        (1, "Летняя", "2026-05-25", "2026-06-13"),
    ]

    rec = Recognizer()
    rec.title = {"admissionYear": 2025, "studyForm": "EXTRAMURAL"}
    rec.sessions = sessions
    calendar = rec.calendar()
    assert len(calendar) == 1
    days = {
        dt.date.fromisoformat(w["monday"]) + dt.timedelta(days=d): code
        for w in calendar[0]["weeks"]
        for d, code in enumerate(w["days"])
    }
    assert days[dt.date(2025, 9, 22)] == ""  # установочная сессия — занятия
    assert days[dt.date(2025, 10, 6)] == "С"  # межсессионный период
    assert days[dt.date(2025, 11, 10)] == ""
    semesters, periods = rec.semesters(calendar)
    assert [s["number"] for s in semesters] == [1, 2]
    other = [p for p in periods if p["code"] == "С"]
    assert other and all(p["type"] == "OTHER" and p["title"].startswith("Межсессионный") for p in other)
