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


def test_plx_real_structure_extramural(tmp_path: Path) -> None:
    """Структура реального .plx («УП ВО» 4.x): UTF-16, КодВидаРаботы, КодТипРабот, часы курса итогом
    и по сессиям (берутся сессии), СеместровНаКурсе=1, ячейки графика по частям недели."""
    cell = (
        '<ПланыГрафикиЯчейки Код="{k}" КодГрафика="-1" КодВидаДеятельности="{a}" НомерНедели="{w}" '
        'НомерЧастиНедели="{p}" Курс="1" Семестр="1" КоличествоЧастейВНеделе="{n}" />'
    )
    weeks = ["1"] * 17 + ["12", "3", "3"] + ["1"] * 20 + ["12"] * 2 + ["3"] * 9 + ["13"]
    cells = "".join(cell.format(k=-i, a=a, w=i, p=1, n=1) for i, a in enumerate(weeks, start=1))
    # праздничный день внутри 10-й недели (неделя по дням)
    cells = cells.replace(cell.format(k=-10, a="1", w=10, p=1, n=1), "")
    cells += "".join(cell.format(k=-100 - d, a="15" if d == 3 else "1", w=10, p=d, n=6) for d in range(1, 7))
    hours = "".join(
        f'<ПланыНовыеЧасы Код="-{i}" КодОбъекта="-5" КодВидаРаботы="{t}" КодТипаЧасов="{h}" Курс="1" '
        f'Семестр="{sem}" Сессия="{ses}" Количество="{q}" />'
        for i, (t, h, sem, ses, q) in enumerate(
            [
                ("1000", "1", "1", "0", "144"),  # итог за курс
                ("101", "1", "1", "0", "6"),
                ("1", "1", "1", "0", "1"),
                ("101", "1", "0", "1", "2"),  # сессия 1 — 1-й семестр
                ("1000", "1", "0", "1", "2"),
                ("101", "1", "0", "2", "4"),  # сессия 2 — 2-й семестр
                ("107", "1", "0", "2", "124"),
                ("108", "1", "0", "2", "7.65"),
                ("143", "1", "0", "2", "0.35"),  # контактная работа — не суммируется
                ("1000", "1", "0", "2", "142"),
                ("1", "1", "0", "2", "1"),
                ("101", "2", "0", "2", "4"),  # интерактивные часы
                ("52", "1", "0", "2", "10"),  # руководство (нагрузка преподавателя)
            ],
            start=1,
        )
    )
    xml = f"""<?xml version="1.0" encoding="utf-16"?>
<Документ Тип="РАБОЧИЙ УЧЕБНЫЙ ПЛАН">
<diffgr:diffgram xmlns:msdata="urn:schemas-microsoft-com:xml-msdata" xmlns:diffgr="urn:schemas-microsoft-com:xml-diffgram-v1">
<dsMMISDB xmlns="http://tempuri.org/dsMMISDB.xsd">
<ООП diffgr:id="ООП1" Код="8091" Шифр="09.03.01" Название="Информатика и вычислительная техника" />
<ООП diffgr:id="ООП2" Код="-1" КодРодительскогоООП="8091" Шифр="" Название="Вычислительные машины" />
<Планы Код="-1" КодООП="8091" КодФормыОбучения="2" Квалификация="Бакалавр" СрокОбучения="3"
  СрокОбученияМесяцев="6" ГодНачалаПодготовки="2020" НомерФГОС="929" ДатаГОСа="2017-09-19T00:00:00"
  СеместровНаКурсе="1" />
<ФормаОбучения Код="2" ФормаОбучения="Заочная" />
<СправочникВидыРабот Код="1" Название="Экзамен" КодТипРабот="7" Аббревиатура="Эк" />
<СправочникВидыРабот Код="101" Название="Лекционные занятия" КодТипРабот="1" Аббревиатура="Лек" />
<СправочникВидыРабот Код="107" Название="Самостоятельная работа" КодТипРабот="5" Аббревиатура="СР" />
<СправочникВидыРабот Код="108" Название="Часы на контроль" КодТипРабот="6" Аббревиатура="Контроль" />
<СправочникВидыРабот Код="143" Название="Контактная работа" КодТипРабот="10" Аббревиатура="КоРа" />
<СправочникВидыРабот Код="1000" Название="Итого часов" Аббревиатура="Итого" />
<СправочникВидыРабот Код="52" Название="Руководство" КодТипРабот="8" Аббревиатура="Руководство" />
<ПланыСтроки Код="-5" КодПлана="-1" Дисциплина="Архитектура вычислительных систем" ТипОбъекта="2"
  ДисциплинаКод="Б1.О.01" СчитатьВПлане="true" />
<ПланыСтроки Код="-6" КодПлана="-1" Дисциплина="Не считается" ДисциплинаКод="Б1.О.02" СчитатьВПлане="false" />
{hours}
{cells}
</dsMMISDB></diffgr:diffgram></Документ>"""
    path = tmp_path / "real.plx"
    path.write_bytes(xml.encode("utf-16"))
    result = import_plan_file(str(path))
    title = result["title"]
    assert title["specialtyCode"] == "09.03.01"
    assert title["studyForm"] == "EXTRAMURAL"
    assert title["durationMonths"] == 42
    assert title["fgosNumber"] == "929"
    items = by_code(result)
    assert "Б1.О.02" not in items
    sems = {s["number"]: s for s in items["Б1.О.01"]["semesters"]}
    assert sems[1]["hours"] == {"lecture": 2, "total": 2}
    assert sems[2]["controlForm"] == "EXAM"
    assert sems[2]["hours"] == {"lecture": 4, "selfStudy": 124, "assessment": 8, "total": 142}
    first = next(s for s in result["semesters"] if s["number"] == 1)
    assert first["startDate"] == "2020-09-01" and first["endDate"] == "2021-01-17"
    assert any(p["type"] == "EXAM_SESSION" for p in result["periods"])
    assert not any(p["type"] == "HOLIDAY" for p in result["periods"])
    # График есть только у 1-го курса — для остальных даты по умолчанию
    assert result["warnings"] == [w for w in result["warnings"] if "курс: 2, 3, 4" in w]
