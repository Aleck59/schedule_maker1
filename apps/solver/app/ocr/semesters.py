"""Разбор страниц «план по семестрам»: блоки «Семестр N» / «Итого за курс» с часами по видам работ."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .normalize import index_prefix, norm_index, parse_number, parse_period_weeks, similar
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
HOUR_FIELDS = BLOCK_COLUMNS[1:10]
HEADER_HINTS = {
    "total": ["всего"],
    "contact": ["кон такт", "контакт"],
    "lecture": ["лек"],
    "laboratory": ["лаб"],
    "practical": ["пр"],
    "seminar": ["сем"],
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


@dataclass
class SemesterPage:
    page: int
    semesters: list[int]
    course: int | None
    rows: list[RawRow]
    # Недели по семестрам: ТО, Э (строка «ДИСЦИПЛИНЫ»), каникулы
    weeks: dict[int, dict[str, float]]


def _block_key(number: int | None) -> str:
    return "course" if number is None else str(number)


def find_blocks(cells: list[Cell]) -> list[Block]:
    blocks: list[Block] = []
    for c in cells:
        m = re.search(r"Сем\w*\s*(\d{1,2})\b", c.text)
        if m and c.w > 200:
            blocks.append(Block(int(m.group(1)), c.x, c.x2, c.y2))
        elif re.search(r"Итого\s+за\s+курс", c.text, re.I) and c.w > 200:
            blocks.append(Block(None, c.x, c.x2, c.y2))
    blocks.sort(key=lambda b: b.x1)
    return blocks


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


def _cell_at(cells: list[Cell], x1: int, x2: int, y1: int, y2: int) -> Cell | None:
    best = None
    for c in cells:
        if x1 - 4 <= c.cx <= x2 + 4 and y1 - 4 <= c.cy <= y2 + 4:
            if best is None or abs(c.cx - (x1 + x2) / 2) < abs(best.cx - (x1 + x2) / 2):
                best = c
    return best


def parse_semester_page(page: int, cells: list[Cell]) -> SemesterPage | None:
    blocks = find_blocks(cells)
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
    for c in sorted(cells, key=lambda c: c.y):
        if c.y < header_bottom or not (index_x[0] - 6 <= c.cx <= index_x[1] + 6):
            continue
        code = norm_index(c.text, prev_prefix)
        if not code:
            continue
        prev_prefix = index_prefix(code)
        section = "disciplines"
        for y, name in sections:
            if c.cy > y:
                section = name
        if section == "end":
            continue
        name_cell = _cell_at(cells, name_x[0], name_x[1], c.y, c.y2)
        row = RawRow(
            code=code,
            name=name_cell.text if name_cell else "",
            page=page,
            y=c.y,
            index_box=c.box(),
            section=section,
        )
        for b in blocks:
            values: dict[str, RawValue] = {}
            for col, (x1, x2) in b.columns.items():
                v = _cell_at(cells, x1, x2, c.y, c.y2)
                if v is not None and not v.empty and v.text:
                    values[col] = RawValue(v.text, v.alt, v.box())
            row.values[_block_key(b.number)] = values
        rows.append(row)

    # Недели теоретического обучения и аттестации (строка «ДИСЦИПЛИНЫ (МОДУЛИ)»), каникулы
    weeks: dict[int, dict[str, float]] = {}
    discipline_row = next(iter(find_cells(cells, r"^ДИСЦИПЛИНЫ", flags=0)), None)
    vacation_row = next(iter(find_cells(cells, r"^КАНИКУЛЫ", flags=0)), None)
    for b in semester_blocks:
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

    numbers = [b.number for b in semester_blocks if b.number is not None]
    course = (max(numbers) + 1) // 2 if numbers else None
    return SemesterPage(page=page, semesters=numbers, course=course, rows=rows, weeks=weeks)
