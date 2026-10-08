"""Поиск ячеек таблиц по линиям сетки и распознавание их содержимого."""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass, field

import cv2
import numpy as np

from .image import line_masks
from .tesseract import ocr_images

NUMERIC_RE = re.compile(r"^[\d\s,./():ТОЭтоэ-]+$")


@dataclass
class Cell:
    x: int
    y: int
    w: int
    h: int
    text: str = ""
    # Второе прочтение числа (другая предобработка), если отличается от основного
    alt: str | None = None
    empty: bool = False
    meta: dict[str, object] = field(default_factory=dict)

    @property
    def x2(self) -> int:
        return self.x + self.w

    @property
    def y2(self) -> int:
        return self.y + self.h

    @property
    def cx(self) -> float:
        return self.x + self.w / 2

    @property
    def cy(self) -> float:
        return self.y + self.h / 2

    def box(self) -> list[int]:
        return [self.x, self.y, self.w, self.h]


def detect_cells(gray: np.ndarray, min_size: int = 14) -> list[Cell]:
    """Ячейки — связные области внутри линий сетки."""
    h, w = gray.shape
    hor, ver = line_masks(gray)
    grid = cv2.dilate(hor | ver, np.ones((3, 3), np.uint8))
    n, _, stats, _ = cv2.connectedComponentsWithStats(255 - grid, connectivity=4)
    cells = []
    for i in range(1, n):
        x, y, cw, ch, area = (int(v) for v in stats[i])
        if cw < min_size or ch < min_size or cw > w * 0.7 or ch > h * 0.4:
            continue
        if area < 0.6 * cw * ch:
            continue
        cells.append(Cell(x, y, cw, ch))
    cells.sort(key=lambda c: (c.y, c.x))
    return cells


def _crop(gray: np.ndarray, c: Cell, inset: int = 3) -> np.ndarray:
    return gray[c.y + inset : c.y2 - inset, c.x + inset : c.x2 - inset]


def ink_box(crop: np.ndarray) -> tuple[int, int, int, int] | None:
    """Рамка «чернил» в ячейке (без фона и заливки); None — ячейка пустая."""
    if crop.size == 0:
        return None
    background = float(np.median(crop))
    threshold = min(140.0, background - 70.0)
    dark = (crop < threshold).astype(np.uint8)
    if dark.sum() < 12:
        return None
    n, _, stats, _ = cv2.connectedComponentsWithStats(dark, connectivity=8)
    boxes = []
    ch, cw = crop.shape
    for i in range(1, n):
        x, y, bw, bh, area = (int(v) for v in stats[i])
        # Остатки рамки по краям ячейки и мелкий шум не учитываются; тонкие штрихи («=», «-») —
        # только вдали от краёв
        if area < 6 or (bh < 6 and bw < 8):
            continue
        if (bw > cw * 0.9 and bh < 6) or (bh > ch * 0.9 and bw < 6):
            continue
        thin = bh < 6 or bw < 6
        if thin and (y <= 1 or y + bh >= ch - 1 or x <= 1 or x + bw >= cw - 1):
            continue
        boxes.append((x, y, x + bw, y + bh))
    if not boxes:
        return None
    x1 = min(b[0] for b in boxes)
    y1 = min(b[1] for b in boxes)
    x2 = max(b[2] for b in boxes)
    y2 = max(b[3] for b in boxes)
    if y2 - y1 < 9 and x2 - x1 < 12:
        return None
    return x1, y1, x2, y2


def _pad(img: np.ndarray, pad: int = 12) -> np.ndarray:
    return cv2.copyMakeBorder(img, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=255)


def _clean(crop: np.ndarray) -> np.ndarray:
    """Убирает серую заливку ячейки: фон делается белым."""
    background = float(np.median(crop))
    if background >= 235:
        return crop
    out = crop.astype(np.float32)
    out = np.clip((out - 0) * (255.0 / max(background, 1.0)), 0, 255)
    return out.astype(np.uint8)


def text_crop(gray: np.ndarray, c: Cell) -> np.ndarray | None:
    crop = _crop(gray, c)
    box = ink_box(crop)
    if box is None:
        return None
    x1, y1, x2, y2 = box
    m = 4
    piece = crop[max(0, y1 - m) : y2 + m, max(0, x1 - m) : x2 + m]
    return _pad(_clean(piece))


def digits_crop(piece: np.ndarray) -> np.ndarray:
    """Вариант для повторного распознавания чисел: увеличение и бинаризация."""
    big = cv2.resize(piece, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    _, bw = cv2.threshold(big, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return bw


def ocr_cells(gray: np.ndarray, cells: Iterable[Cell], *, numeric_second_pass: bool = True) -> None:
    """Заполняет text (и alt для чисел) у ячеек; пустые ячейки помечаются empty."""
    targets: list[tuple[Cell, np.ndarray]] = []
    for c in cells:
        piece = text_crop(gray, c)
        if piece is None:
            c.empty = True
            c.text = ""
            continue
        targets.append((c, piece))
    texts = ocr_images([p for _, p in targets], lang="rus", psm=6)
    for (c, _), t in zip(targets, texts, strict=True):
        c.text = normalize_space(t)
    if not numeric_second_pass:
        return
    numeric = [(c, p) for c, p in targets if c.text and looks_numeric(c.text)]
    alts = ocr_images([digits_crop(p) for _, p in numeric], lang="eng", psm=7, whitelist="0123456789,./")
    for (c, _), t in zip(numeric, alts, strict=True):
        t = t.replace(" ", "")
        if t and t != c.text.replace(" ", ""):
            c.alt = t


def looks_numeric(text: str) -> bool:
    t = text.replace(" ", "")
    return bool(t) and sum(ch.isdigit() for ch in t) >= max(1, len(t) // 2) and bool(NUMERIC_RE.match(t))


def normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("|", " ")).strip()


def cells_in(cells: Iterable[Cell], x1: float, x2: float, y1: float, y2: float) -> list[Cell]:
    """Ячейки, центр которых лежит в прямоугольнике."""
    return [c for c in cells if x1 <= c.cx <= x2 and y1 <= c.cy <= y2]


def find_cells(cells: Iterable[Cell], pattern: str, flags: int = re.IGNORECASE) -> list[Cell]:
    rx = re.compile(pattern, flags)
    return [c for c in cells if c.text and rx.search(c.text)]


def crop_png(gray: np.ndarray, box: list[int], margin: int = 6, max_width: int = 360) -> bytes:
    """Фрагмент скана для показа в интерфейсе проверки (PNG)."""
    x, y, w, h = box
    piece = gray[max(0, y - margin) : y + h + margin, max(0, x - margin) : x + w + margin]
    if piece.shape[1] > max_width:
        scale = max_width / piece.shape[1]
        piece = cv2.resize(
            piece, (max_width, max(1, round(piece.shape[0] * scale))), interpolation=cv2.INTER_AREA
        )
    ok, buf = cv2.imencode(".png", piece)
    return buf.tobytes() if ok else b""
