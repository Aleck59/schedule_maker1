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
    # Высшее образование (бакалавриат, специалитет, магистратура)
    "Б1": "Дисциплины (модули)",
    "Б2": "Практика",
    "Б3": "Государственная итоговая аттестация",
    "К.М": "Комплексные модули",
}
PROFESSIONAL_PREFIXES = {"ПМ", "МДК", "УП", "ПП", "ПДП", "П"}
KNOWN_PREFIXES = sorted(set(CYCLE_NAMES) | PROFESSIONAL_PREFIXES, key=len, reverse=True)

INDEX_RE = re.compile(r"^([А-ЯЁ]{1,4})\.?((?:\d{1,2})(?:\.\d{1,2}){0,2})(\([А-ЯЁ]\))?$")


def to_cyrillic(text: str) -> str:
    return text.translate(LAT2CYR)


# Индексы плана высшего образования: «Б1.О.01», «Б1.В.ДВ.01.02», «Б2.О.01(У)», «Б3.01(Д)», «ФТД.В.01», «К.М.01.01»
VO_INDEX_RE = re.compile(r"^(?:Б[123]|ФТД|К\.М)(?:\.(?:О|В|Б|Ч|ДВ|\d{2}))+(?:\((?:У|П|Пд|Н|Д|Г)\))?$")
VO_SUFFIXES = {"У": "У", "П": "П", "ПД": "Пд", "Н": "Н", "Д": "Д", "Г": "Г"}


def norm_vo_index(text: str) -> str | None:
    """Индекс элемента плана высшего образования или None."""
    t = to_cyrillic(text.strip()).upper().replace(" ", "").replace(",", ".").rstrip(".")
    # «Б1» нередко распознаётся как «Ы», «Б» — как «6»
    t = re.sub(r"^Ы\.?", "Б1.", t)
    t = re.sub(r"^6([123])", r"Б\1", t)
    m = re.match(r"^(Б[123]|ФТД|К\.?М)\.?(.*)$", t)
    if not m or len(t) > 26:
        return None
    head = "К.М" if m.group(1).startswith("К") else m.group(1)
    rest = m.group(2)
    suffix = ""
    sm = re.search(r"\(([А-ЯЁ]{1,2})\)?$", rest)
    if sm:
        key = sm.group(1)
        if key not in VO_SUFFIXES:
            return None
        suffix = f"({VO_SUFFIXES[key]})"
        rest = rest[: sm.start()]
    segments = [s for s in rest.split(".") if s]
    if not segments:
        return None
    out: list[str] = []
    for i, seg in enumerate(segments):
        if seg == "ДВ":
            out.append(seg)
        elif i == 0 and head in ("Б1", "Б2", "ФТД") and seg in ("О", "0", "В", "8", "08", "Б"):
            # Часть плана: О — обязательная, В — формируемая участниками («В» читается как «8»),
            # Б — базовая (планы прежних стандартов)
            out.append({"0": "О", "8": "В", "08": "В"}.get(seg, seg))
        elif seg == "Ч" and i == 0:
            out.append(seg)
        else:
            digits = seg.replace("О", "0").replace("З", "3").replace("Ю", "10").replace("Б", "6")
            if not re.fullmatch(r"\d{1,2}", digits):
                return None
            out.append(f"{int(digits):02d}")
    code = f"{head}.{'.'.join(out)}{suffix}"
    return code if VO_INDEX_RE.match(code) else None


def is_vo_index(code: str) -> bool:
    return bool(VO_INDEX_RE.match(code))


def norm_index(text: str, prev_prefix: str | None = None) -> str | None:
    """Индекс элемента плана («СГ.01», «МДК.02.01», «ПМ.01.01(К)», «ГИА.01(Г)», «Б1.О.01») или None."""
    t = to_cyrillic(text.strip()).upper().replace(" ", "").replace(",", ".")
    t = t.rstrip(".")
    if not t or len(t) > 26:
        return None
    if re.match(r"^(Б[123]|Ы|6[123]|ФТД\.|К\.?М\.)", t) or (prev_prefix or "") in ("Б1", "Б2", "Б3", "К.М"):
        vo = norm_vo_index(t)
        if vo or not re.match(r"^(ФТД|К)", t):
            return vo
    if len(t) > 18:
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
    if not INDEX_RE.match(code):
        return None
    # Номера в индексах — двузначные: «СОО.1.05» → «СОО.01.05»; одиночный «0» — недочитанный номер
    m = re.match(r"^([А-ЯЁ]+)\.([\d.]+)(\(.\))?$", code)
    if m:
        parts = m.group(2).split(".")
        if any(p == "0" for p in parts):
            return None
        code = f"{m.group(1)}.{'.'.join(p.zfill(2) for p in parts)}{m.group(3) or ''}"
    return code


def index_prefix(code: str) -> str:
    if code.startswith("К.М"):
        return "К.М"
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
