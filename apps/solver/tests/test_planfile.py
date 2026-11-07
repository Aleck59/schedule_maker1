"""Импорт учебного плана из файлов программы «Планы»: .plx и .xml (GosInsp)."""

from __future__ import annotations

import datetime as dt
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
    # 3 — аттестация, 12 — каникулы (как в реальных файлах)
    weeks = ["1"] * 17 + ["3", "3", "12"] + ["1"] * 20 + ["3"] * 2 + ["12"] * 9 + ["13"]
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


def test_plx_extramural_sessions_with_dated_cells(tmp_path: Path) -> None:
    """Заочный план СПО (программа 4.x): один «семестр» на курс и три сессии (установочная, зимняя,
    летняя), даты сессий в «Заездах», у ячеек графика есть даты, запасные курсы сетки программы
    (ЧислоКурсов=11) заполнены «неделя отсутствует», экзамен по модулю — своей строкой."""
    cells = []
    start = dt.date(2024, 9, 2)  # 1 сентября 2024 — воскресенье, первая неделя — со 2 сентября
    for i in range(52):
        monday = start + dt.timedelta(weeks=i)
        if monday == dt.date(2024, 12, 9):  # зимняя сессия: три дня аттестации, затем теория
            codes = ["3", "3", "3", "1", "1", "1"]
        elif dt.date(2025, 1, 27) <= monday <= dt.date(2025, 2, 3):
            codes = ["12"]
        elif monday >= dt.date(2025, 6, 30):
            codes = ["12"]
        else:
            codes = ["1"]
        for part, code in enumerate(codes, start=1):
            day = monday + dt.timedelta(days=part - 1)
            cells.append((1, i + 1, part, len(codes), code, day))
    for course in range(2, 12):  # курсов нет в плане
        cells.append((course, 1, 1, 1, "13", dt.date(2023 + course, 9, 1)))
    cell_xml = "".join(
        f'<ПланыГрафикиЯчейки Код="-{k}" КодГрафика="-1" КодВидаДеятельности="{a}" НомерНедели="{w}" '
        f'НомерЧастиНедели="{p}" Курс="{c}" Семестр="1" КоличествоЧастейВНеделе="{n}" '
        f'DateElementGYP="{d.isoformat()}T00:00:00" />'
        for k, (c, w, p, n, a, d) in enumerate(cells, start=1)
    )
    hours = "".join(
        f'<ПланыНовыеЧасы Код="-{i}" КодОбъекта="{o}" КодВидаРаботы="{t}" КодТипаЧасов="1" Курс="1" '
        f'Семестр="{sem}" Сессия="{ses}" Количество="{q}" />'
        for i, (o, t, sem, ses, q) in enumerate(
            [
                ("-5", "1000", "1", "0", "104"),  # итог за курс — не берётся, есть сессии
                ("-5", "1000", "0", "1", "34"),  # установочная (октябрь) — 1-й семестр
                ("-5", "1000", "0", "2", "34"),  # зимняя (декабрь) — 1-й семестр
                ("-5", "49", "0", "2", "1"),
                ("-5", "1000", "0", "3", "36"),  # летняя (июнь) — 2-й семестр
                ("-5", "1", "0", "3", "1"),
                ("-7", "1", "0", "3", "1"),  # у модуля — сумма форм контроля его строк
                ("-8", "1000", "0", "3", "36"),
                ("-8", "1", "0", "3", "1"),
            ],
            start=1,
        )
    )
    sessions = "".join(
        f'<Заезды Код="-{i}" Курс="{c}" Сессия="{n}" ДатаНачала="{d}T00:00:00" Продолжительность="{p}" '
        'КодПлана="-1" />'
        for i, (c, n, d, p) in enumerate(
            [
                (1, 1, "2024-10-14", 10),
                (1, 2, "2024-12-09", 6),
                (1, 3, "2025-06-02", 17),
                (2, 1, "0001-01-01", 0),
            ],
            start=1,
        )
    )
    xml = f"""<?xml version="1.0" encoding="utf-16"?>
<Документ Тип="УЧЕБНЫЙ ПЛАН" LastName="40.02.04 ЮР(псо)(9кл)(озо)24акт.plx" ЧислоКурсов="11" СеместровНаКурсе="1" СессийНаКурсе="3">
<diffgr:diffgram xmlns:msdata="urn:schemas-microsoft-com:xml-msdata" xmlns:diffgr="urn:schemas-microsoft-com:xml-diffgram-v1">
<dsMMISDB xmlns="http://tempuri.org/dsMMISDB.xsd">
<ООП diffgr:id="ООП1" Код="9550" Шифр="40.02.04" Название="ЮРИСПРУДЕНЦИЯ" />
<Планы Код="-1" КодООП="9550" КодФормыОбучения="2" Квалификация="Юрист" СрокОбучения="3"
  СрокОбученияМесяцев="10" ГодНачалаПодготовки="2024" ЧислоКурсов="11" ЧислоСессий="3" СеместровНаКурсе="1" />
<ФормаОбучения Код="2" ФормаОбучения="Заочная" />
<СправочникВидыРабот Код="1" Название="Экзамен" КодТипРабот="7" Аббревиатура="Эк" />
<СправочникВидыРабот Код="49" Название="Другие формы контроля" КодТипРабот="7" Аббревиатура="Др" />
<СправочникВидыРабот Код="1000" Название="Итого часов" Аббревиатура="Итого" />
<ПланыСтроки Код="-5" КодПлана="-1" Дисциплина="Русский язык" ДисциплинаКод="СОО.01.01" ТипОбъекта="2" />
<ПланыСтроки Код="-7" КодПлана="-1" Дисциплина="Правоприменительная деятельность" ДисциплинаКод="ПМ.01"
  ТипОбъекта="1" />
<ПланыСтроки Код="-8" КодПлана="-1" КодРодителя="-7" Дисциплина="Экзамен по модулю" ДисциплинаКод="ПМ.01.01(К)"
  ТипОбъекта="4" />
{hours}
{sessions}
{cell_xml}
</dsMMISDB></diffgr:diffgram></Документ>"""
    path = tmp_path / "zo.plx"
    path.write_bytes(xml.encode("utf-16"))
    result = import_plan_file(str(path))
    # В программе — «Заочная», в имени плана — «(озо)»: берётся очно-заочная, с предупреждением
    assert result["title"]["studyForm"] == "PART_TIME"
    assert any("очно-заочная" in w for w in result["warnings"])
    items = by_code(result)
    sems = {s["number"]: s for s in items["СОО.01.01"]["semesters"]}
    assert sems[1]["hours"]["total"] == 68 and sems[1]["controlForm"] == "OTHER"
    assert sems[2]["hours"]["total"] == 36 and sems[2]["controlForm"] == "EXAM"
    exams = [i for i in result["items"] if i["kind"] == "MODULE_EXAM"]
    assert [i["code"] for i in exams] == ["ПМ.01.01(К)"]
    assert exams[0]["semesters"][0]["controlForm"] == "QUALIFICATION_EXAM"
    # Запасные курсы сетки (5–11) не превращаются в семестры: их столько, сколько в сроке обучения
    assert [s["number"] for s in result["semesters"]] == list(range(1, 9))
    assert [c["course"] for c in result["calendar"]] == [1]
    first, second = result["semesters"][:2]
    assert first["startDate"] == "2024-09-02" and first["endDate"] == "2025-02-09"
    # Занятия только в дни сессий: установочная 14–23 октября и три дня теории после аттестации в декабре
    assert first["weeks"]["theory"] == round((9 + 3) / 6, 2)
    assert first["weeks"]["exam"] == 0.5 and first["weeks"]["vacation"] == 2
    periods = [(p["code"], p["startDate"], p["endDate"]) for p in result["periods"]]
    assert ("Э", "2024-12-09", "2024-12-11") in periods
    assert ("К", "2025-06-30", "2025-08-30") in periods
    assert ("С", "2024-09-02", "2024-10-12") in periods
    assert second["weeks"]["theory"] == 2.5  # 2–18 июня без воскресений


def test_plx_unknown_activity_code_is_self_study(tmp_path: Path) -> None:
    """Неизвестный код вида деятельности (45 — в планах ВО новых версий) ставится как самостоятельная
    работа «С»: занятия не ставятся, а замечание указывает на дни графика для подсветки."""
    start = dt.date(2026, 8, 31)  # неделя 1 сентября 2026
    cells = []
    for i in range(52):
        code = "45" if i in (3, 4) else "12" if i >= 44 else "1"
        cells.append((i + 1, code, start + dt.timedelta(weeks=i)))
    cell_xml = "".join(
        f'<ПланыГрафикиЯчейки Код="-{w}" КодВидаДеятельности="{a}" НомерНедели="{w}" НомерЧастиНедели="1" '
        f'Курс="1" Семестр="1" КоличествоЧастейВНеделе="1" DateElementGYP="{d.isoformat()}T00:00:00" />'
        for w, a, d in cells
    )
    xml = f"""<?xml version="1.0" encoding="utf-8"?>
<Документ><dsMMISDB xmlns="http://tempuri.org/dsMMISDB.xsd">
<ООП Код="1" Шифр="06.03.01" Название="Биология" />
<Планы Код="-1" КодООП="1" ГодНачалаПодготовки="2026" ФормаОбучения="очная" СрокОбучения="4г" Квалификация="бакалавр" />
<ПланыСтроки Код="-5" КодПлана="-1" Дисциплина="Философия" ДисциплинаКод="Б1.О.01" />
{cell_xml}
</dsMMISDB></Документ>"""
    path = tmp_path / "plan.plx"
    path.write_text(xml, encoding="utf-8")
    result = import_plan_file(str(path))
    week4 = result["calendar"][0]["weeks"][3]
    assert week4["days"] == ["С"] * 6
    warning = next(w for w in result["warnings"] if "кодом 45" in w)
    assert "самостоятельная работа" in warning
    days = result["warningCells"][warning]
    assert len(days) == 12
    assert days[0] == {"course": 1, "date": "2026-09-21"}
    other = next(p for p in result["periods"] if p["type"] == "OTHER")
    assert (other["startDate"], other["endDate"]) == ("2026-09-21", "2026-10-03")
