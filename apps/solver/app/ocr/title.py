"""Разбор титульного листа: специальность, квалификация, форма и срок обучения, год начала, ФГОС."""

from __future__ import annotations

import re

from .normalize import similar
from .table import Cell

CODE_RE = re.compile(r"\b(\d{2})[.,](\d{2})[.,](\d{2})\b")


def _label_value(text: str, label: str, threshold: float = 0.6) -> str | None:
    """Значение поля вида «Метка: значение», метка сравнивается нечётко (ошибки распознавания)."""
    if ":" not in text:
        return None
    head, value = text.split(":", 1)
    words = head.strip().split()
    if not words:
        return None
    if (
        similar(head.strip()[: len(label) + 4], label) >= threshold
        or similar(words[0], label.split()[0]) >= 0.7
    ):
        return value.strip(" .;") or None
    return None


def parse_title(cells: list[Cell], page_text: str) -> dict[str, object]:
    texts = [c.text for c in cells if c.text] + [
        line.strip() for line in page_text.splitlines() if line.strip()
    ]
    joined = "\n".join(texts)
    result: dict[str, object] = {}

    # Код и наименование специальности: «40.02.04 Юриспруденция»
    for line in texts:
        m = CODE_RE.search(line)
        if not m:
            continue
        code = ".".join(m.groups())
        result.setdefault("specialtyCode", code)
        name = line[m.end() :].strip(" .,-—")
        if len(name) >= 4 and re.match(r"^[А-ЯЁа-яё]", name) and "specialtyName" not in result:
            result["specialtyName"] = name
    for line in texts:
        for label, key in (
            ("Квалификация", "qualification"),
            ("Форма обучения", "studyFormText"),
            ("Срок получения образования", "durationText"),
            ("Уровень образования", "baseEducation"),
        ):
            value = _label_value(line, label)
            if value and key not in result:
                result[key] = value

    form = str(result.get("studyFormText", "")).lower()
    if "заоч" in form and "очно" in form:
        result["studyForm"] = "PART_TIME"
    elif "заоч" in form:
        result["studyForm"] = "EXTRAMURAL"
    elif form:
        result["studyForm"] = "FULL_TIME"

    duration = str(result.get("durationText", ""))
    m = re.search(r"(\d)\s*\S{0,3}\s*(\d{1,2})\s*м", duration)
    if m:
        result["durationMonths"] = int(m.group(1)) * 12 + int(m.group(2))
    else:
        m = re.search(r"(\d)\s*(г|л)", duration)
        if m:
            result["durationMonths"] = int(m.group(1)) * 12

    # Год начала подготовки и учебный год
    years = re.findall(r"(?<![\d.])(20\d{2})\s*[-–—]\s*(20\d{2})(?!\d)", joined)
    m = re.search(r"Год начала подготовки[^\n\d]*(20\d{2})", joined)
    if m:
        result["admissionYear"] = int(m.group(1))
    else:
        standalone = [int(line) for line in texts if re.fullmatch(r"20\d{2}", line)]
        if standalone:
            result["admissionYear"] = standalone[0]
        elif years:
            result["admissionYear"] = int(years[0][0])
    if years:
        result["academicYear"] = f"{years[0][0]}-{years[0][1]}"

    # ФГОС: «№ 798 от 27.10.2023» (не путать с протоколом утверждения плана)
    fgos = [
        m
        for line in texts
        if not re.search(r"протокол", line, re.I)
        for m in [re.search(r"№\s*(\d{1,5})\s*от\s*(\d{2})\.(\d{2})\.(\d{4})", line)]
        if m
    ]
    m = fgos[0] if fgos else None
    if m:
        result["fgosNumber"] = m.group(1)
        result["fgosDate"] = f"{m.group(4)}-{m.group(3)}-{m.group(2)}"

    # Направленность (профиль) — строка после наименования специальности
    lines = [line.strip() for line in page_text.splitlines() if line.strip()]
    for i, line in enumerate(lines):
        if CODE_RE.search(line) and len(line) > 10 and i + 1 < len(lines):
            nxt = lines[i + 1]
            words = nxt.split()
            if words and similar(words[0], "Направленность") > 0.7:
                nxt = " ".join(words[1:]).removeprefix("программы:").strip()
            if re.match(r"^[А-ЯЁ][а-яё]", nxt) and not CODE_RE.search(nxt) and len(nxt) < 120:
                result.setdefault("profile", nxt)
            break
    for line in lines:
        if re.search(r"(учреждение|колледж|техникум|филиал)", line, re.I) and len(line) > 15:
            result.setdefault("organization", line)
            break
    return result


def is_title_page(cells: list[Cell], page_text: str) -> bool:
    text = page_text.upper()
    return "УЧЕБНЫЙ ПЛАН" in text or ("КВАЛИФИКАЦ" in text and bool(CODE_RE.search(page_text)))
