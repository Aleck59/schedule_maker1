"""Импорт учебного плана из файлов программы «Планы»: .plx и .xml (GosInsp)."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.planfile import PlanFileError, control_of, hour_key_of, import_plan_file, parse_duration

FIXTURES = Path(__file__).parent / "fixtures"


def by_code(result: dict) -> dict[str, dict]:
    return {i["code"]: i for i in result["items"]}


def test_plx_title_and_items() -> None:
    result = import_plan_file(str(FIXTURES / "plan-spo.plx"))
    assert result["source"] == "plx"
    title = result["title"]
    assert title["specialtyCode"] == "09.02.07"
    assert title["specialtyName"] == "Информационные системы и программирование"
    assert title["qualification"] == "Программист"
    assert title["admissionYear"] == 2025
    assert title["studyForm"] == "FULL_TIME"
    assert title["durationMonths"] == 46
    assert title["educationLevel"] == "SPO"
    assert title["fgosNumber"] == "1547"
    assert title["fgosDate"] == "2016-12-09"
    # 3 г. 10 мес. — 8 семестров
    assert [s["number"] for s in result["semesters"]] == list(range(1, 9))

    items = by_code(result)
    assert "СГ" not in items  # строка цикла
    history = items["СГ.01"]
    assert history["kind"] == "DISCIPLINE"
    assert history["cycleCode"] == "СГ"
    sem = history["semesters"][0]
    assert sem["number"] == 1
    assert sem["controlForm"] == "DIFFERENTIATED_CREDIT"
    # Интерактивные часы (другой тип часов) не добавляются к основным
    assert sem["hours"] == {"lecture": 20, "practical": 12, "total": 32}

    os_ = items["ОП.01"]["semesters"][0]
    assert os_["number"] == 3 and os_["controlForm"] == "EXAM"
    assert os_["hours"]["laboratory"] == 40
    assert os_["hours"]["assessment"] == 6
    assert os_["hours"]["total"] == 78

    assert items["ПМ.01"]["kind"] == "MODULE" and items["ПМ.01"]["semesters"] == []
    assert items["МДК.01.01"]["parentCode"] == "ПМ.01"
    assert items["МДК.01.01"]["semesters"][0]["controlForm"] == "COURSE_PROJECT"
    assert items["УП.01.01"]["kind"] == "EDUCATIONAL_PRACTICE"
    assert items["УП.01.01"]["semesters"][0]["hours"]["total"] == 72
    assert items["ПП.01.01"]["kind"] == "INDUSTRIAL_PRACTICE"
    exam = items["ПМ.01.ЭК"]
    assert exam["kind"] == "MODULE_EXAM" and exam["parentCode"] == "ПМ.01"
    assert exam["semesters"][0]["number"] == 5
    assert exam["semesters"][0]["controlForm"] == "QUALIFICATION_EXAM"
    # Графика нет — даты по умолчанию и предупреждение
    assert any("Календарный график" in w for w in result["warnings"])


def test_gosinsp_xml_cp1251_with_calendar() -> None:
    result = import_plan_file(str(FIXTURES / "plan-spo-gosinsp.xml"))
    assert result["source"] == "gosinsp"
    title = result["title"]
    assert title["specialtyCode"] == "40.02.04"
    assert title["specialtyName"] == "Юриспруденция"
    assert title["qualification"] == "юрист"
    assert title["durationMonths"] == 22
    assert title["admissionYear"] == 2026
    assert title["fgosDate"] == "2023-10-27"

    semesters = {s["number"]: s for s in result["semesters"]}
    assert sorted(semesters) == [1, 2, 3, 4]
    assert semesters[1]["startDate"] == "2026-09-01"
    # Первый семестр заканчивается вместе с зимними каникулами
    assert semesters[1]["endDate"] == "2027-01-17"
    assert semesters[2]["startDate"] == "2027-01-18"
    assert round(semesters[1]["weeks"]["theory"]) == 17
    types = {(p["course"], p["type"]) for p in result["periods"]}
    assert (1, "EXAM_SESSION") in types
    assert (1, "EDUCATIONAL_PRACTICE") in types
    assert (2, "FINAL_ATTESTATION") in types
    assert not result["warnings"]

    items = by_code(result)
    phil = items["СГ.01"]["semesters"][0]
    # Форма контроля из атрибута строки «СемЗачО»
    assert phil["controlForm"] == "DIFFERENTIATED_CREDIT"
    assert phil["hours"] == {"lecture": 24, "practical": 12, "selfStudy": 4, "total": 40}
    tgp = {s["number"]: s for s in items["ОП.01"]["semesters"]}
    assert tgp[1]["controlForm"] == "EXAM" and tgp[1]["hours"]["assessment"] == 6
    assert tgp[2]["controlForm"] == "CREDIT"
    # Часы по видам занятий в элементах <VZ>
    assert items["СГ.02"]["semesters"][0]["hours"] == {"practical": 34, "selfStudy": 2, "total": 36}
    assert items["УП.01"]["kind"] == "EDUCATIONAL_PRACTICE"
    assert items["УП.01"]["semesters"][0]["hours"]["total"] == 72
    assert items["ПМ.01.ЭК"]["kind"] == "MODULE_EXAM"
    assert items["ПМ.01"]["kind"] == "MODULE"


def test_plx_with_element_columns_and_calendar(tmp_path: Path) -> None:
    """Вариант выгрузки DataSet со столбцами-элементами и таблицей ячеек графика."""
    weeks = ["Т"] * 17 + ["Э", "К", "К"] + ["Т"] * 20 + ["К"] * 10
    cells = "".join(
        f"<ПланыГрафикиЯчейки><Курс>1</Курс><НомерНедели>{n}</НомерНедели>"
        f"<КодВидаДеятельности>{ {'Т': 1, 'Э': 2, 'К': 3}[c] }</КодВидаДеятельности></ПланыГрафикиЯчейки>"
        for n, c in enumerate(weeks, start=1)
    )
    xml = f"""<?xml version="1.0" encoding="utf-8"?>
<Документ><dsMMISDB xmlns="http://tempuri.org/dsMMISDB.xsd">
<ООП><Код>1</Код><Шифр>38.03.01</Шифр><Название>Экономика</Название></ООП>
<Планы><КодПлана>1</КодПлана><ГодНачалаПодготовки>2026</ГодНачалаПодготовки>
  <ФормаОбучения>заочная</ФормаОбучения><СрокОбучения>4г 6м</СрокОбучения></Планы>
<ООПКвалификации><Квалификация>бакалавр</Квалификация></ООПКвалификации>
<СправочникВидыРабот><Код>101</Код><Название>Лекции</Название></СправочникВидыРабот>
<СправочникВидыРабот><Код>1</Код><Название>Экзамен</Название></СправочникВидыРабот>
<СправочникВидыДеятельности><Код>1</Код><Символ>Т</Символ></СправочникВидыДеятельности>
<СправочникВидыДеятельности><Код>2</Код><Символ>Э</Символ></СправочникВидыДеятельности>
<СправочникВидыДеятельности><Код>3</Код><Символ>К</Символ></СправочникВидыДеятельности>
<ПланыСтроки><Код>5</Код><ДисциплинаКод>Б1.О.01</ДисциплинаКод><Дисциплина>Философия</Дисциплина></ПланыСтроки>
<ПланыНовыеЧасы><КодОбъекта>5</КодОбъекта><Курс>1</Курс><Семестр>0</Семестр><Сессия>1</Сессия>
  <КодВидаРабот>101</КодВидаРабот><Количество>8</Количество></ПланыНовыеЧасы>
<ПланыНовыеЧасы><КодОбъекта>5</КодОбъекта><Курс>1</Курс><Семестр>0</Семестр><Сессия>2</Сессия>
  <КодВидаРабот>1</КодВидаРабот><Количество>1</Количество></ПланыНовыеЧасы>
{cells}
</dsMMISDB></Документ>"""
    path = tmp_path / "plan.plx"
    path.write_text(xml, encoding="utf-8")
    result = import_plan_file(str(path))
    title = result["title"]
    assert title["specialtyCode"] == "38.03.01"
    assert title["qualification"] == "бакалавр"
    assert title["studyForm"] == "EXTRAMURAL"
    assert title["educationLevel"] == "BACHELOR"
    item = by_code(result)["Б1.О.01"]
    sems = {s["number"]: s for s in item["semesters"]}
    assert sems[1]["hours"]["lecture"] == 8
    assert sems[2]["controlForm"] == "EXAM"
    first = next(s for s in result["semesters"] if s["number"] == 1)
    assert first["endDate"] == "2027-01-17"
    assert any(p["type"] == "EXAM_SESSION" for p in result["periods"])


def test_rejects_unknown_xml(tmp_path: Path) -> None:
    path = tmp_path / "other.xml"
    path.write_text("<root><a/></root>", encoding="utf-8")
    with pytest.raises(PlanFileError):
        import_plan_file(str(path))


def test_rejects_entities(tmp_path: Path) -> None:
    path = tmp_path / "bomb.xml"
    path.write_text('<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>', encoding="utf-8")
    with pytest.raises(PlanFileError):
        import_plan_file(str(path))


def test_helpers() -> None:
    assert parse_duration("2г 10м") == 34
    assert parse_duration("3 г. 10 мес.") == 46
    assert parse_duration("4 года") == 48
    assert parse_duration("4,5") == 54
    assert control_of("Зачет с оценкой") == "DIFFERENTIATED_CREDIT"
    assert control_of("Зачет") == "CREDIT"
    assert control_of("Курсовая работа") == "COURSE_PROJECT"
    assert control_of("Экзамен квалификационный") == "QUALIFICATION_EXAM"
    assert control_of("Лекции") is None
    assert hour_key_of("Часы в интерактивной форме") is None
    assert hour_key_of("Контроль самостоятельной работы") == "consultation"
    assert hour_key_of("Самостоятельная работа") == "selfStudy"
    assert hour_key_of("Часы на контроль") == "assessment"
    assert hour_key_of("В форме практической подготовки") is None
