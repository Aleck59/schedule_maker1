"""Текстовый слой цифровых PDF (выгрузки из программ планирования, документы с OCR-слоем).

Символы берутся из PDF вместе с координатами и раскладываются по ячейкам таблиц, найденным
на отрисованной странице, — распознавание изображения для таких страниц не требуется.
Штамп электронной подписи, который добавляется поверх каждой страницы, в текст не попадает.
"""

from __future__ import annotations

import ctypes
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    from .table import Cell

# Минимум символов (без штампа подписи), при котором страница считается цифровой
MIN_PAGE_GLYPHS = 40
STAMP_START = "Документ подписан"
STAMP_KEY_RE = re.compile(r"[0-9a-f]{32,64}")


@dataclass(frozen=True)
class Glyph:
    ch: str
    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def cx(self) -> float:
        return (self.x1 + self.x2) / 2

    @property
    def cy(self) -> float:
        return (self.y1 + self.y2) / 2

    @property
    def h(self) -> float:
        return self.y2 - self.y1


def _stamp_range(text: str) -> range | None:
    """Индексы символов штампа электронной подписи: от «Документ подписан…» до ключа подписи."""
    start = text.find(STAMP_START)
    if start < 0:
        return None
    key = STAMP_KEY_RE.search(text, start)
    end = key.end() if key and key.start() - start < 600 else min(len(text), start + 400)
    return range(start, end)


def page_glyphs(page: object, width: int, height: int) -> list[Glyph]:
    """Символы страницы в координатах изображения шириной width и высотой height."""
    import pypdfium2.raw as raw

    textpage = page.get_textpage()  # type: ignore[attr-defined]
    try:
        n = textpage.count_chars()
        if n <= 0:
            return []
        text = textpage.get_text_range(0, n)
        stamp = _stamp_range(text) if len(text) == n else None
        glyphs: list[Glyph] = []
        dx, dy = ctypes.c_int(), ctypes.c_int()

        def to_device(x: float, y: float) -> tuple[int, int]:
            raw.FPDF_PageToDevice(page.raw, 0, 0, width, height, 0, x, y, dx, dy)  # type: ignore[attr-defined]
            return dx.value, dy.value

        for i in range(n):
            if stamp and i in stamp:
                continue
            code = raw.FPDFText_GetUnicode(textpage.raw, i)
            if code == 0 or raw.FPDFText_IsGenerated(textpage.raw, i) == 1:
                continue
            ch = chr(code)
            if ch.isspace() or not ch.isprintable():
                continue
            left, bottom, right, top = textpage.get_charbox(i, loose=True)
            if right <= left or top <= bottom:
                # Шрифт без метрик: точная рамка символа
                left, bottom, right, top = textpage.get_charbox(i, loose=False)
                if right <= left or top <= bottom:
                    continue
            ax, ay = to_device(left, top)
            bx, by = to_device(right, bottom)
            x1, x2 = sorted((ax, bx))
            y1, y2 = sorted((ay, by))
            glyphs.append(Glyph(ch, x1, y1, x2, y2))
        return glyphs
    finally:
        textpage.close()


def is_scanned(page: object) -> bool:
    """Страница — изображение скана (текстовый слой, если есть, получен распознаванием)."""
    import pypdfium2.raw as raw

    width, height = page.get_size()  # type: ignore[attr-defined]
    area = width * height
    left, bottom, right, top = (ctypes.c_float() for _ in range(4))
    for k in range(raw.FPDFPage_CountObjects(page.raw)):  # type: ignore[attr-defined]
        obj = raw.FPDFPage_GetObject(page.raw, k)  # type: ignore[attr-defined]
        if raw.FPDFPageObj_GetType(obj) != raw.FPDF_PAGEOBJ_IMAGE:
            continue
        if not raw.FPDFPageObj_GetBounds(obj, left, bottom, right, top):
            continue
        if (right.value - left.value) * (top.value - bottom.value) > 0.5 * area:
            return True
    return False


def _lines(glyphs: list[Glyph]) -> list[list[Glyph]]:
    """Строки текста: символы, близкие по вертикали, слева направо."""
    if not glyphs:
        return []
    heights = sorted(g.h for g in glyphs)
    tol = max(2.0, heights[len(heights) // 2] * 0.45)
    lines: list[list[Glyph]] = []
    centers: list[float] = []
    for g in sorted(glyphs, key=lambda g: g.cy):
        for i, c in enumerate(centers):
            if abs(c - g.cy) <= tol:
                lines[i].append(g)
                centers[i] = (c * (len(lines[i]) - 1) + g.cy) / len(lines[i])
                break
        else:
            lines.append([g])
            centers.append(g.cy)
    order = sorted(range(len(lines)), key=lambda i: centers[i])
    return [sorted(lines[i], key=lambda g: g.x1) for i in order]


def _join(line: list[Glyph], segment_gap: float | None = None) -> list[str]:
    """Текст строки; при segment_gap строка делится на фрагменты по большим промежуткам."""
    if not line:
        return []
    h = float(np.median([g.h for g in line]))
    segments: list[str] = []
    current = line[0].ch
    for prev, g in zip(line, line[1:], strict=False):
        gap = g.x1 - prev.x2
        if segment_gap is not None and gap > segment_gap * h:
            segments.append(current)
            current = g.ch
            continue
        current += (" " if gap > 0.16 * h else "") + g.ch
    segments.append(current)
    return segments


def text_of(glyphs: list[Glyph]) -> str:
    """Текст ячейки: строки через пробел, перенос слова со знаком «-» склеивается."""
    out = ""
    for line in _lines(glyphs):
        part = " ".join(_join(line))
        if out.endswith("-") and part[:1].islower():
            out = out[:-1] + part
        else:
            out = f"{out} {part}" if out else part
    return re.sub(r"\s+", " ", out).strip()


def page_text(glyphs: list[Glyph]) -> str:
    """Текст страницы по строкам; далеко отстоящие фрагменты строки разделены двумя пробелами."""
    return "\n".join("  ".join(_join(line, segment_gap=2.5)) for line in _lines(glyphs))


def fill_cells(cells: list[Cell], labels: np.ndarray, label_of: dict[int, Cell], glyphs: list[Glyph]) -> None:
    """Заполняет текст ячеек символами текстового слоя (по положению центра символа)."""
    h, w = labels.shape
    inside: dict[int, list[Glyph]] = {}
    for g in glyphs:
        x, y = int(g.cx), int(g.cy)
        if not (0 <= x < w and 0 <= y < h):
            continue
        label = int(labels[y, x])
        if label in label_of:
            inside.setdefault(label, []).append(g)
    for label, cell in label_of.items():
        own = inside.get(label, [])
        cell.text = text_of(own)
        cell.empty = not cell.text
        cell.alt = None
        if own:
            # Строки символов (для кодов календарного графика: несколько дней в одной ячейке)
            cell.meta["lines"] = [
                (" ".join(_join(line)), float(np.mean([g.cy for g in line]))) for line in _lines(own)
            ]
    for c in cells:
        if not c.text:
            c.empty = True
