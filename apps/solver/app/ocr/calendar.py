"""Разбор календарного учебного графика: таблицы по учебным годам (курсам), 52–53 недели,
коды недель (дней) Пн–Сб: пусто — теоретическое обучение, Э, К, У, П, Пд, Д, Г, =."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

import cv2
import numpy as np

from .normalize import parse_int
from .table import Cell, ink_box
from .tesseract import ocr_images

CODE_WHITELIST = "ЭКУПГДНд=*:"
DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб"]


@dataclass
class CalendarTable:
    page: int
    y: int
    start_year: int | None = None
    year_score: float = 0.0
    # Код на каждый день Пн–Сб каждой недели (индекс недели с 0)
    codes: list[list[str]] = field(default_factory=list)
    uncertain: list[dict[str, object]] = field(default_factory=list)
    day_ranges: list[tuple[int, int]] = field(default_factory=list)

    def day_at(self, y: float) -> int | None:
        for i, (y1, y2) in enumerate(self.day_ranges):
            if y1 - 3 <= y <= y2 + 3:
                return i
        return None


def cluster_rows(cells: list[Cell]) -> list[list[Cell]]:
    if not cells:
        return []
    heights = sorted(c.h for c in cells)
    tol = max(8, heights[len(heights) // 2] * 0.35)
    rows: list[list[Cell]] = []
    for c in sorted(cells, key=lambda c: c.cy):
        if rows and abs(np.mean([r.cy for r in rows[-1]]) - c.cy) < tol:
            rows[-1].append(c)
        else:
            rows.append([c])
    return [sorted(r, key=lambda c: c.x) for r in rows]


def _week_row(row: list[Cell]) -> list[Cell] | None:
    """Строка «Нед» с номерами недель 1…53; возвращает ячейки недель без подписи."""
    if len(row) < 40:
        return None
    widths = sorted(c.w for c in row)
    median = widths[len(widths) // 2]
    cells = (
        row[1:]
        if row[0].w > median * 1.4 or parse_int(row[0].text) is None and row[0].text[:1].isalpha()
        else row
    )
    hits = sum(1 for i, c in enumerate(cells) if parse_int(c.text) == i + 1)
    return cells if hits >= 25 else None


def _monday_of_first_week(year: int) -> dt.date:
    sep1 = dt.date(year, 9, 1)
    return sep1 - dt.timedelta(days=sep1.weekday())


def _guess_year(date_rows: list[list[tuple[int, int]]], hint: int | None) -> tuple[int | None, float]:
    """Год начала по числам месяца в строках Пн…Вс: [(индекс недели, число)] для каждого дня недели."""
    total = sum(len(r) for r in date_rows)
    if not total:
        return hint, 0.0
    best: tuple[int | None, float] = (None, 0.0)
    # Календарь повторяется через 5–11 лет: при равной точности выбирается год ближе к подсказке
    # (году начала подготовки) или к текущему году
    anchor = hint or dt.date.today().year
    years = sorted(range(1995, 2101), key=lambda y: abs(y - anchor))
    for year in years:
        monday = _monday_of_first_week(year)
        hits = 0
        for weekday, values in enumerate(date_rows):
            for week, value in values:
                if (monday + dt.timedelta(days=7 * week + weekday)).day == value:
                    hits += 1
        score = hits / total
        if score > best[1]:
            best = (year, score)
    return best


def _glyph_tokens(crop: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Рамки «слов» (одна или несколько букв в строке) внутри ячейки кода."""
    background = float(np.median(crop))
    dark = (crop < min(140.0, background - 70.0)).astype(np.uint8)
    n, _, stats, _ = cv2.connectedComponentsWithStats(dark, connectivity=8)
    boxes = []
    ch, cw = crop.shape
    for i in range(1, n):
        x, y, w, h, area = (int(v) for v in stats[i])
        if area < 10 or (w > cw * 0.9 and h < 6) or (h > ch * 0.9 and w < 6):
            continue
        boxes.append([x, y, x + w, y + h])
    boxes.sort(key=lambda b: (b[1] + b[3]) / 2)
    tokens: list[list[int]] = []
    for b in boxes:
        for t in tokens:
            bh = b[3] - b[1]
            same_line = min(t[3], b[3]) - max(t[1], b[1]) > -max(4, bh * 0.6)
            close = b[0] - t[2] < bh * 1.2 and t[0] - b[2] < bh * 1.2
            # Части одного знака друг над другом («=», «:»): почти совпадают по горизонтали
            overlap_x = min(t[2], b[2]) - max(t[0], b[0]) > 0.5 * min(t[2] - t[0], b[2] - b[0])
            stacked = overlap_x and max(t[1], b[1]) - min(t[3], b[3]) < 12
            if (same_line and close) or stacked:
                t[:] = [min(t[0], b[0]), min(t[1], b[1]), max(t[2], b[2]), max(t[3], b[3])]
                break
        else:
            tokens.append(list(b))
    return [tuple(t) for t in tokens if t[3] - t[1] >= 8]  # type: ignore[misc]


def looks_like_equals(piece: np.ndarray) -> bool:
    """Знак «=»: две (или более) тонкие горизонтальные черты одна над другой."""
    dark = (piece < 140).astype(np.uint8)
    n, _, stats, _ = cv2.connectedComponentsWithStats(dark, connectivity=8)
    bars = [s for s in stats[1:] if s[4] >= 10 and s[3] < s[2] * 0.45]
    others = [s for s in stats[1:] if s[4] >= 10 and s[3] >= s[2] * 0.45]
    return len(bars) >= 2 and not others


def normalize_code(text: str) -> str:
    t = text.strip().replace(" ", "")
    if not t:
        return "?"
    if "=" in t or t in {"-", "—", "_"}:
        return "="
    if "*" in t:
        return "*"
    if ":" in t:
        return ":"
    first = t[0].upper()
    mapping = {
        "Э": "Э",
        "Е": "Э",
        "З": "Э",
        "3": "Э",
        "Є": "Э",
        "К": "К",
        "K": "К",
        "У": "У",
        "Y": "У",
        "П": "П",
        "Ш": "П",
        "Л": "П",
        "Н": "П",
        "N": "П",
        "Г": "Г",
        "Т": "Г",
        "R": "Г",
        "Д": "Д",
    }
    code = mapping.get(first, "?")
    if code == "П" and len(t) > 1 and t[1].upper() == "Д":
        return "Пд"
    return code


def parse_calendar_page(
    page: int, gray: np.ndarray, cells: list[Cell], admission_year: int | None
) -> list[CalendarTable]:
    rows = cluster_rows(cells)
    tables: list[CalendarTable] = []
    jobs: list[tuple[CalendarTable, list[int], list[int], np.ndarray, tuple[int, int, int, int], float]] = []
    for row in rows:
        weeks = _week_row(row)
        if not weeks:
            continue
        label = row[0] if weeks[0] is not row[0] else None
        label_x = (label.x, label.x2) if label else (weeks[0].x - 110, weeks[0].x - 4)
        table = CalendarTable(page=page, y=weeks[0].y)
        week_ranges = [(c.x, c.x2) for c in weeks]

        # Дни Пн…Вс над строкой недель: подписи в левой колонке
        above = [c for c in cells if label_x[0] - 10 <= c.cx <= label_x[1] + 10 and c.y2 <= weeks[0].y + 4]
        above = sorted(above, key=lambda c: c.y)[-7:]
        date_rows: list[list[tuple[int, int]]] = []
        for lab in above:
            values = []
            for c in cells:
                if lab.y - 4 <= c.cy <= lab.y2 + 4 and c.x > label_x[1]:
                    v = parse_int(c.alt or c.text) if c.text else None
                    wi = next((i for i, (x1, x2) in enumerate(week_ranges) if x1 - 4 <= c.cx <= x2 + 4), None)
                    if v and wi is not None and 1 <= v <= 31:
                        values.append((wi, v))
            date_rows.append(values)
        hint = admission_year + len(tables) if admission_year else None
        table.start_year, table.year_score = _guess_year(date_rows if len(date_rows) == 7 else [], hint)

        # Дни Пн…Сб под строкой недель
        below = [c for c in cells if label_x[0] - 10 <= c.cx <= label_x[1] + 10 and c.y >= weeks[0].y2 - 4]
        below = sorted(below, key=lambda c: c.y)[:6]
        day_ranges = [(c.y, c.y2) for c in below]
        table.day_ranges = day_ranges
        table.codes = [[""] * 6 for _ in weeks]
        if len(day_ranges) < 6:
            tables.append(table)
            continue
        top, bottom = day_ranges[0][0] - 4, day_ranges[-1][1] + 4
        for c in cells:
            if not (top <= c.cy <= bottom) or c.cx < week_ranges[0][0] - 4:
                continue
            spans_w = [
                i for i, (x1, x2) in enumerate(week_ranges) if min(x2, c.x2) - max(x1, c.x) > (x2 - x1) * 0.5
            ]
            spans_d = [
                i for i, (y1, y2) in enumerate(day_ranges) if min(y2, c.y2) - max(y1, c.y) > (y2 - y1) * 0.5
            ]
            if not spans_w or not spans_d:
                continue
            crop = gray[c.y + 3 : c.y2 - 3, c.x + 3 : c.x2 - 3]
            if ink_box(crop) is None:
                continue
            for token in _glyph_tokens(crop):
                x1, y1, x2, y2 = token
                piece = crop[max(0, y1 - 3) : y2 + 3, max(0, x1 - 3) : x2 + 3]
                piece = cv2.copyMakeBorder(piece, 14, 14, 14, 14, cv2.BORDER_CONSTANT, value=255)
                center_y = c.y + 3 + (y1 + y2) / 2
                jobs.append((table, spans_w, spans_d, piece, (c.x, c.y, c.w, c.h), center_y))
        tables.append(table)

    texts = ocr_images([j[3] for j in jobs], lang="rus", psm=10, whitelist=CODE_WHITELIST)
    # Повторное распознавание неуверенных букв без ограничения набора символов
    retry = [i for i, t in enumerate(texts) if normalize_code(t) == "?"]
    if retry:
        again = ocr_images([jobs[i][3] for i in retry], lang="rus", psm=8)
        for i, t in zip(retry, again, strict=True):
            if normalize_code(t) != "?":
                texts[i] = t
            elif looks_like_equals(jobs[i][3]):
                texts[i] = "="
    # Группировка распознанных букв по ячейкам
    by_cell: dict[tuple[int, tuple[int, int, int, int]], list[tuple[str, float, list[int], list[int]]]] = {}
    for (table, spans_w, spans_d, _, box, center_y), text in zip(jobs, texts, strict=True):
        by_cell.setdefault((id(table), box), []).append((normalize_code(text), center_y, spans_w, spans_d))
    table_by_id = {id(t): t for t in tables}
    for (tid, box), tokens in by_cell.items():
        table = table_by_id[tid]
        for code, center_y, spans_w, spans_d in tokens:
            if len(tokens) == 1:
                days = spans_d
            else:
                # Несколько букв в одной ячейке: каждая относится к своему дню
                day = table.day_at(center_y)
                days = [day] if day is not None and day in spans_d else spans_d[:1]
            for w in spans_w:
                for d in days:
                    table.codes[w][d] = code
            if code == "?":
                table.uncertain.append({"weeks": spans_w, "days": days, "box": list(box), "page": table.page})
    return tables
