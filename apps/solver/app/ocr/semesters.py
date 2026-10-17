"""Разбор страниц «план по семестрам»: блоки «Семестр N» / «Итого за курс» с часами по видам работ."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .normalize import index_prefix, norm_index, parse_number, parse_period_weeks, similar
from .sessions import SESSION_RE, session_semester
from .table import Cell, find_cells

# Колонки блока семестра слева направо
BLOCK_COLUMNS = [
    "control",
    "total",
    "contact",
    "lecture",
    "laboratory",
    "practical",
    "seminar",
    "individualProject",
    "selfStudy",
    "assessment",
    "weeks",
]
# Часы блока (без формы контроля и недель); консультации — отдельная колонка в части планов СПО
HOUR_FIELDS = [*BLOCK_COLUMNS[1:10], "consultation"]
HEADER_HINTS = {
    "total": ["всего"],
    "contact": ["кон такт", "контакт"],
    "lecture": ["лек"],
    "laboratory": ["лаб"],
    "practical": ["пр"],
    "seminar": ["сем"],
    "consultation": ["конс"],
    "individualProject": ["ип"],
    "selfStudy": ["ср"],
    "weeks": ["недель"],
}


@dataclass
class Block:
    """Блок колонок: семестр (number) или итог за курс (number = None)."""

    number: int | None
    x1: int
    x2: int
    title_bottom: int = 0
    columns: dict[str, tuple[int, int]] = field(default_factory=dict)
    # Блок сессии заочной формы (несколько сессий могут относиться к одному семестру)
    session: bool = False


@dataclass
class RawValue:
    text: str
    alt: str | None
    box: list[int]


@dataclass
class RawRow:
    code: str
    name: str
    page: int
    y: int
    index_box: list[int]
    # блок → колонка → значение
    values: dict[str, dict[str, RawValue]] = field(default_factory=dict)
    section: str = "disciplines"
    # Индекс не прочитан и восстановлен по предыдущей строке: исходный текст ячейки
    guessed_from: str | None = None


@dataclass
class SemesterPage:
    page: int
    semesters: list[int]
    course: int | None
    rows: list[RawRow]
    # Недели по семестрам: ТО, Э (строка «ДИСЦИПЛИНЫ»), каникулы
    weeks: dict[int, dict[str, float]]
    # Часы указаны по сессиям (заочная форма)
    sessions: bool = False


def _block_key(number: int | None) -> str:
    return "course" if number is None else str(number)


# Семестры с 10-го в программах планирования обозначаются буквами: A — 10, B — 11, …
HEX_SEMESTERS = {"A": 10, "А": 10, "B": 11, "В": 11, "C": 12, "С": 12, "D": 13, "E": 14, "Е": 14}


def semester_number(token: str) -> int:
    return HEX_SEMESTERS[token] if token in HEX_SEMESTERS else int(token)


def find_blocks(cells: list[Cell], course: int | None = None) -> list[Block]:
    blocks: list[Block] = []
    sessions: list[tuple[Cell, str]] = []
    for c in cells:
        m = re.search(r"Сем\w*\s*(\d{1,2}|[A-EАВСЕ])(?![\wА-Яа-я])", c.text)
        if m and c.w > 200:
            blocks.append(Block(semester_number(m.group(1)), c.x, c.x2, c.y2))
        elif re.search(r"Итого\s+за\s+курс", c.text, re.I) and c.w > 200:
            blocks.append(Block(None, c.x, c.x2, c.y2))
        elif c.w > 200 and (sm := SESSION_RE.search(c.text)):
            sessions.append((c, sm.group(1) or ""))
    # Заочная форма: сессии курса относятся к семестрам курса (установочная и зимняя — к нечётному)
    if sessions and course:
        sessions.sort(key=lambda x: x[0].x)
        for i, (c, name) in enumerate(sessions):
            number = session_semester(course, name, i, len(sessions))
            blocks.append(Block(number, c.x, c.x2, c.y2, session=True))
    blocks.sort(key=lambda b: b.x1)
    return blocks


def _merge_values(into: dict[str, RawValue], values: dict[str, RawValue]) -> None:
    """Две сессии одного семестра: часы складываются, формы контроля объединяются."""
    for col, v in values.items():
        prev = into.get(col)
        if prev is None:
            into[col] = v
            continue
        a, b = parse_number(prev.text), parse_number(v.text)
        if col != "control" and a is not None and b is not None:
            into[col] = RawValue(str(int(round(a + b))), None, prev.box)
        elif col == "control":
            into[col] = RawValue(f"{prev.text} {v.text}".strip(), None, prev.box)


def _leaf_headers(cells: list[Cell], block: Block, top: int, bottom: int) -> list[Cell]:
    inside = [
        c
        for c in cells
        if block.x1 - 8 <= c.cx <= block.x2 + 8
        and top <= c.cy <= bottom
        and c.w < (block.x2 - block.x1) * 0.5
    ]
    leaves = []
    for c in inside:
        # Ячейка-«шапка» над другими (например, «Академических часов») не является колонкой
        covers = [o for o in inside if o is not c and o.x >= c.x - 4 and o.x2 <= c.x2 + 4 and o.y > c.y2 - 6]
        if not covers:
            leaves.append(c)
    leaves.sort(key=lambda c: c.x)
    # Слияние дублей по x (ячейки одной колонки на разных уровнях)
    result: list[Cell] = []
    for c in leaves:
        if result and abs(result[-1].cx - c.cx) < 10:
            continue
        result.append(c)
    return result


def assign_columns(cells: list[Cell], block: Block, top: int, bottom: int) -> None:
    leaves = _leaf_headers(cells, block, top, bottom)
    if len(leaves) == len(BLOCK_COLUMNS):
        for name, c in zip(BLOCK_COLUMNS, leaves, strict=True):
            block.columns[name] = (c.x, c.x2)
        return
    # Неполная шапка: сопоставление по тексту, порядок колонок сохраняется
    controls = [c for c in leaves if similar(c.text.replace(" ", ""), "Контроль") > 0.7]
    if controls:
        block.columns["control"] = (controls[0].x, controls[0].x2)
        if len(controls) > 1:
            block.columns["assessment"] = (controls[-1].x, controls[-1].x2)
    for name, hints in HEADER_HINTS.items():
        for c in leaves:
            text = c.text.lower().replace(".", "").strip()
            if any(text == h or (len(h) > 2 and text.startswith(h)) for h in hints):
                block.columns.setdefault(name, (c.x, c.x2))
                break


def _index_like(text: str) -> bool:
    """Нечитаемый индекс: короткий текст с цифрами (не заголовок раздела)."""
    t = text.strip()
    return 2 <= len(t) <= 16 and bool(re.search(r"\d", t))


def _next_index(code: str, taken: set[str]) -> str:
    """Следующий индекс того же раздела: «СОО.01.04» → «СОО.01.05» (без совпадений с прочитанными)."""
    m = re.match(r"^(.*?)(\d+)(\(\w+\))?$", code)
    if not m:
        return code
    head, number, tail = m.group(1), int(m.group(2)), m.group(3) or ""
    width = len(m.group(2))
    candidate = code
    while candidate in taken or candidate == code:
        number += 1
        candidate = f"{head}{number:0{width}d}"
    return candidate + ("" if tail == "(К)" else "")


def _read_index(text: str, prev_prefix: str | None) -> tuple[str | None, str]:
    """Индекс строки и остаток текста (наименование, если ячейки слиты); номер строки отбрасывается."""
    code = norm_index(text, prev_prefix)
    if code:
        return code, ""
    tokens = text.split()
    for i, token in enumerate(tokens[:3]):
        code = norm_index(token, prev_prefix)
        if code and (i == 0 or re.fullmatch(r"\W*\w{0,2}\W*", " ".join(tokens[:i]))):
            return code, " ".join(tokens[i + 1 :])
    return None, ""


def _cell_at(cells: list[Cell], x1: int, x2: int, y1: int, y2: int) -> Cell | None:
    best = None
    for c in cells:
        if x1 - 4 <= c.cx <= x2 + 4 and y1 - 4 <= c.cy <= y2 + 4:
            if best is None or abs(c.cx - (x1 + x2) / 2) < abs(best.cx - (x1 + x2) / 2):
                best = c
    return best


def parse_semester_page(page: int, cells: list[Cell], course: int | None = None) -> SemesterPage | None:
    blocks = find_blocks(cells, course)
    semester_blocks = [b for b in blocks if b.number is not None]
    if not semester_blocks:
        return None
    header_top = min(b.title_bottom for b in blocks)
    first_total = find_cells(cells, r"^ИТОГО(?!\s+за)|^ДИСЦИПЛИНЫ", flags=0)
    first_total = [c for c in first_total if c.y > header_top]
    header_bottom = min((c.y for c in first_total), default=header_top + 400)
    for b in blocks:
        assign_columns(cells, b, b.title_bottom, header_bottom)

    # Колонки индекса и наименования
    index_hdr = next((c for c in cells if c.y < header_bottom and similar(c.text, "Индекс") > 0.7), None)
    name_hdr = next(
        (c for c in cells if c.y < header_bottom and similar(c.text[:12], "Наименование") > 0.6), None
    )
    first_x = semester_blocks[0].x1
    if name_hdr is None:
        return None
    index_x = (index_hdr.x, index_hdr.x2) if index_hdr else (name_hdr.x - 260, name_hdr.x - 4)
    name_x = (name_hdr.x, min(name_hdr.x2, first_x))

    # Разделы: дисциплины, практики, ГИА
    sections = sorted(
        [(c.y, "practices") for c in find_cells(cells, r"^ПРАКТИКИ", flags=0)]
        + [(c.y, "gia") for c in find_cells(cells, r"ГОСУДАРСТВЕННАЯ ИТОГОВАЯ")]
        + [(c.y, "end") for c in find_cells(cells, r"^КАНИКУЛЫ", flags=0)]
    )

    rows: list[RawRow] = []
    prev_prefix: str | None = None
    index_w = index_x[1] - index_x[0]
    prev_code: str | None = None
    seen_codes: set[str] = set()
    for c in sorted(cells, key=lambda c: c.y):
        if c.y < header_bottom:
            continue
        inside = index_x[0] - 6 <= c.cx <= index_x[1] + 6
        # Плохой скан: линия сетки не найдена — индекс слит с номером строки или с наименованием
        merged = (
            not inside
            and c.x <= index_x[0] + index_w * 0.5
            and c.x2 >= index_x[1] - 6
            and c.x2 <= name_x[1] + 30
        )
        if not inside and not merged:
            continue
        code, rest = _read_index(c.text, prev_prefix)
        guessed_from = None
        if not code and inside and prev_code and _index_like(c.text):
            # Индекс не прочитан, но строка есть: следующий номер после предыдущей строки
            name_probe = _cell_at(cells, name_x[0], name_x[1], c.y, c.y2)
            if name_probe and len(re.sub(r"[^А-Яа-яЁё]", "", name_probe.text)) >= 3:
                code = _next_index(prev_code, seen_codes)
                guessed_from = c.text
        if not code:
            continue
        prev_prefix = index_prefix(code)
        prev_code = code
        seen_codes.add(code)
        section = "disciplines"
        for y, name in sections:
            if c.cy > y:
                section = name
        if section == "end":
            continue
        name_cell = (
            None if merged and c.x2 > index_x[1] + 20 else _cell_at(cells, name_x[0], name_x[1], c.y, c.y2)
        )
        row = RawRow(
            code=code,
            name=name_cell.text if name_cell else rest,
            page=page,
            y=c.y,
            index_box=c.box(),
            section=section,
            guessed_from=guessed_from,
        )
        for b in blocks:
            values: dict[str, RawValue] = {}
            for col, (x1, x2) in b.columns.items():
                v = _cell_at(cells, x1, x2, c.y, c.y2)
                if v is not None and not v.empty and v.text:
                    values[col] = RawValue(v.text, v.alt, v.box())
            key = _block_key(b.number)
            if key in row.values:
                _merge_values(row.values[key], values)
            else:
                row.values[key] = values
        rows.append(row)

    # Недели теоретического обучения и аттестации (строка «ДИСЦИПЛИНЫ (МОДУЛИ)»), каникулы
    weeks: dict[int, dict[str, float]] = {}
    discipline_row = next(iter(find_cells(cells, r"^ДИСЦИПЛИНЫ", flags=0)), None)
    vacation_row = next(iter(find_cells(cells, r"^КАНИКУЛЫ", flags=0)), None)
    for b in semester_blocks:
        if b.session:
            weeks.setdefault(b.number, {})  # type: ignore[arg-type]
            continue
        info: dict[str, float] = {}
        col = b.columns.get("weeks")
        if col and discipline_row:
            v = _cell_at(cells, col[0], col[1], discipline_row.y, discipline_row.y2)
            if v and v.text:
                info.update(parse_period_weeks(v.text))
        if col and vacation_row:
            v = _cell_at(cells, col[0], col[1], vacation_row.y, vacation_row.y2)
            value = parse_number(v.text) if v else None
            if value is not None:
                info["vacation"] = round(value, 3)
        weeks[b.number] = info  # type: ignore[index]

    numbers = sorted({b.number for b in semester_blocks if b.number is not None})
    course = (max(numbers) + 1) // 2 if numbers else None
    return SemesterPage(
        page=page,
        semesters=numbers,
        course=course,
        rows=rows,
        weeks=weeks,
        sessions=any(b.session for b in blocks),
    )
