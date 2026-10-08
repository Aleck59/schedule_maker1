"""Нормализация распознанного текста: индексы дисциплин, числа, формы контроля, недели."""

from __future__ import annotations

import difflib
import re
from fractions import Fraction

# Латинские буквы, похожие на кириллические (частая ошибка распознавания)
LAT2CYR = str.maketrans("ABCEHKMOPTXYabcehkmoptxy", "АВСЕНКМОРТХУавсенкмортху")
DIGIT_LIKE = str.maketrans(
    {
        "О": "0",
        "о": "0",
        "O": "0",
        "o": "0",
        "З": "3",
        "з": "3",
        "l": "1",
        "I": "1",
        "|": "1",
        "б": "6",
        "Б": "6",
        "S": "5",
        "B": "8",
    }
)

# Префиксы индексов учебного плана СПО и названия циклов по умолчанию
CYCLE_NAMES = {
    "СОО": "Среднее общее образование",
    "ОО": "Общеобразовательный цикл",
    "ООД": "Общеобразовательные дисциплины",
    "ОУД": "Общеобразовательные учебные дисциплины",
    "ОУП": "Общеобразовательные учебные предметы",
    "УД": "Учебные дисциплины",
    "ОГСЭ": "Общий гуманитарный и социально-экономический цикл",
    "ЕН": "Математический и общий естественнонаучный цикл",
    "СГ": "Социально-гуманитарный цикл",
    "ОП": "Общепрофессиональный цикл",
    "П": "Профессиональный цикл",
    "ГИА": "Государственная итоговая аттестация",
    "ФТД": "Факультативные дисциплины",
}
PROFESSIONAL_PREFIXES = {"ПМ", "МДК", "УП", "ПП", "ПДП", "П"}
KNOWN_PREFIXES = sorted(set(CYCLE_NAMES) | PROFESSIONAL_PREFIXES, key=len, reverse=True)

INDEX_RE = re.compile(r"^([А-ЯЁ]{1,4})\.?((?:\d{1,2})(?:\.\d{1,2}){0,2})(\([А-ЯЁ]\))?$")


def to_cyrillic(text: str) -> str:
    return text.translate(LAT2CYR)


def norm_index(text: str, prev_prefix: str | None = None) -> str | None:
    """Индекс элемента плана («СГ.01», «МДК.02.01», «ПМ.01.01(К)», «ГИА.01(Г)») или None."""
    t = to_cyrillic(text.strip()).upper().replace(" ", "").replace(",", ".")
    t = t.rstrip(".")
    if not t or len(t) > 18:
        return None
    # Буквенная часть до первой точки или цифры; ведущий ноль — это «О»
    m = re.match(r"^([А-ЯЁ0]{1,5})\.?(.*)$", t)
    if not m:
        return None
    letters, rest = m.group(1).replace("0", "О"), m.group(2)
    rest = rest.replace("О", "0").replace("З", "3")
    rest = re.sub(r"\(([А-ЯЁ0-9])\)?$", lambda x: "(" + x.group(1).replace("0", "О") + ")", rest)
    rest = rest.replace("(Х)", "(К)").replace("(1)", "(Г)")
    if letters not in KNOWN_PREFIXES:
        candidates = difflib.get_close_matches(letters, KNOWN_PREFIXES, n=3, cutoff=0.5)
        if not candidates:
            return None
        # Лишняя буква в конце («ОПП» → «ОП») вероятнее, чем в начале
        prefixed = [c for c in candidates if letters.startswith(c)]
        if prev_prefix in candidates:
            letters = prev_prefix
        elif prefixed:
            letters = max(prefixed, key=len)
        else:
            letters = candidates[0]
    code = f"{letters}.{rest}"
    return code if INDEX_RE.match(code) else None


def index_prefix(code: str) -> str:
    return code.split(".", 1)[0]


def parse_int(text: str | None) -> int | None:
    """Целое число из ячейки; None — не число."""
    if not text:
        return None
    t = text.translate(DIGIT_LIKE).replace(" ", "").strip(".-_—")
    if not t:
        return None
    if re.fullmatch(r"\d{1,5}", t):
        return int(t)
    return None


def parse_number(text: str | None) -> float | None:
    """Дробное число («33,97», «20 4/6»)."""
    if not text:
        return None
    t = text.translate(DIGIT_LIKE).strip()
    m = re.fullmatch(r"(\d+)\s+(\d+)\s*/\s*(\d+)", t)
    if m and int(m.group(3)):
        return int(m.group(1)) + int(m.group(2)) / int(m.group(3))
    m = re.fullmatch(r"(\d+)\s*/\s*(\d+)", t)
    if m and int(m.group(2)):
        return int(m.group(1)) / int(m.group(2))
    t = t.replace(",", ".").replace(" ", "")
    try:
        return float(t)
    except ValueError:
        return None


def parse_fraction_weeks(text: str) -> float | None:
    """Недели в форме «18 2/3», «1/2», «2»."""
    t = text.translate(DIGIT_LIKE).strip()
    m = re.fullmatch(r"(\d+)?\s*(?:(\d)\s*/\s*(\d))?", t)
    if not m or not (m.group(1) or m.group(2)):
        return None
    value = Fraction(int(m.group(1) or 0))
    if m.group(2) and int(m.group(3)):
        value += Fraction(int(m.group(2)), int(m.group(3)))
    return float(value)


def parse_period_weeks(text: str) -> dict[str, float]:
    """«ТО: 18 2/3 Э: 2» → {"theory": 18.67, "exam": 2}."""
    t = to_cyrillic(text).upper().replace(";", ":")
    result: dict[str, float] = {}
    m = re.search(r"Т[О0]\s*:\s*(\d\s*/\s*\d|\d+(?:\s+\d\s*/\s*\d)?)", t)
    if m:
        value = parse_fraction_weeks(m.group(1))
        if value is not None:
            result["theory"] = round(value, 3)
    m = re.search(r"[Э3З]\s*:\s*(\d\s*/\s*\d|\d+(?:\s+\d\s*/\s*\d)?)", t[m.end() if m else 0 :])
    if m:
        value = parse_fraction_weeks(m.group(1))
        if value is not None:
            result["exam"] = round(value, 3)
    return result


CONTROL_TOKENS = [
    ("ЗАО", "DIFFERENTIATED_CREDIT"),
    ("ЭК", "EXAM"),
    ("ЗА", "CREDIT"),
    ("ДР", "OTHER"),
    ("КП", "COURSE_PROJECT"),
    ("КР", "COURSE_PROJECT"),
]
CONTROL_PRIORITY = [
    "QUALIFICATION_EXAM",
    "EXAM",
    "DIFFERENTIATED_CREDIT",
    "CREDIT",
    "OTHER",
    "COURSE_PROJECT",
]


def _control_token(token: str) -> list[str]:
    t = token.replace("3", "З").replace("0", "О")
    t = re.sub(r"\(-?\d*\)?|\[.*$", "", t)
    if t in {"ЗАО", "ЗАД", "ЗАБ", "З2О", "ЗАQ", "ЗАС"}:
        return ["DIFFERENTIATED_CREDIT"]
    t = re.sub(r"\d", "", t)
    forms: list[str] = []
    i = 0
    while i < len(t):
        for prefix, form in CONTROL_TOKENS:
            if t.startswith(prefix, i):
                if form not in forms:
                    forms.append(form)
                i += len(prefix)
                break
        else:
            i += 1
    return forms


def parse_control(text: str | None) -> list[str]:
    """Формы контроля из ячейки «Контроль»: «Эк», «За КР», «ЗаО(2)», «Эк ЗаО(2)», «Др»."""
    if not text:
        return []
    forms: list[str] = []
    for token in to_cyrillic(text).upper().split():
        for form in _control_token(token):
            if form not in forms:
                forms.append(form)
    return forms


def main_control(forms: list[str]) -> str:
    for form in CONTROL_PRIORITY:
        if form in forms:
            return form
    return "NONE"


def similar(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a.lower(), b.lower()).ratio()
