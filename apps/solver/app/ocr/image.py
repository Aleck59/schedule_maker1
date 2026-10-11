"""Загрузка страниц (PDF, JPG, PNG, TIFF) и подготовка изображений к распознаванию."""

from __future__ import annotations

import logging
import math
import os
from collections.abc import Iterator
from dataclasses import dataclass

import cv2
import numpy as np

from .pdftext import MIN_PAGE_GLYPHS, Glyph, is_scanned, page_glyphs
from .tesseract import detect_rotation

log = logging.getLogger("engine.ocr")

# Длинная сторона страницы после масштабирования, пикселей (~350 dpi для A4)
TARGET_LONG_SIDE = 4100
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}


def _fit(gray: np.ndarray) -> np.ndarray:
    h, w = gray.shape[:2]
    scale = TARGET_LONG_SIDE / max(h, w)
    if 0.85 < scale < 1.2:
        return gray
    interp = cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC
    return cv2.resize(gray, (round(w * scale), round(h * scale)), interpolation=interp)


@dataclass
class PageImage:
    """Страница в оттенках серого; glyphs — символы текстового слоя PDF (None — его нет)."""

    gray: np.ndarray
    glyphs: list[Glyph] | None = None


def _is_pdf(path: str) -> bool:
    with open(path, "rb") as fh:
        head = fh.read(5)
    return os.path.splitext(path)[1].lower() == ".pdf" or head == b"%PDF-"


def count_pages(paths: list[str]) -> int:
    total = 0
    for path in paths:
        if _is_pdf(path):
            import pypdfium2 as pdfium

            pdf = pdfium.PdfDocument(path)
            total += len(pdf)
            pdf.close()
        else:
            total += 1
    return total


def iter_pages(paths: list[str]) -> Iterator[PageImage]:
    """Страницы файлов по одной (в памяти не держатся все страницы сразу)."""
    for path in paths:
        if _is_pdf(path):
            yield from _iter_pdf(path)
        else:
            data = np.fromfile(path, dtype=np.uint8)
            img = cv2.imdecode(data, cv2.IMREAD_GRAYSCALE)
            if img is None:
                raise ValueError(f"Не удалось прочитать изображение {os.path.basename(path)}")
            yield PageImage(_fit(img))


def load_pages(paths: list[str]) -> list[np.ndarray]:
    """Все страницы файлов в оттенках серого, в порядке следования."""
    return [p.gray for p in iter_pages(paths)]


def _iter_pdf(path: str) -> Iterator[PageImage]:
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(path)
    try:
        for i in range(len(pdf)):
            page = pdf[i]
            w, h = page.get_size()
            scale = min(8.0, max(2.0, TARGET_LONG_SIDE / max(w, h)))
            bitmap = page.render(scale=scale, grayscale=True)
            arr = bitmap.to_numpy()
            if arr.ndim == 3 and arr.shape[2] >= 3:
                arr = cv2.cvtColor(arr[:, :, :3], cv2.COLOR_BGR2GRAY)
            elif arr.ndim == 3:
                arr = arr[:, :, 0]
            gray = np.ascontiguousarray(arr)
            # Скан с распознанным текстовым слоем обрабатывается как изображение: качество чужого
            # распознавания неизвестно, а собственное сопровождается проверкой сумм часов
            glyphs = [] if is_scanned(page) else page_glyphs(page, gray.shape[1], gray.shape[0])
            page.close()
            yield PageImage(gray, glyphs if len(glyphs) >= MIN_PAGE_GLYPHS else None)
    finally:
        pdf.close()


def ink_ratio(gray: np.ndarray) -> float:
    small = cv2.resize(gray, (800, max(1, round(800 * gray.shape[0] / gray.shape[1]))))
    return float(np.count_nonzero(small < 128)) / small.size


def is_blank(gray: np.ndarray) -> bool:
    return ink_ratio(gray) < 0.004


def binarize(gray: np.ndarray) -> np.ndarray:
    """Инвертированное бинарное изображение: чернила = 255."""
    return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 31, 15)


def line_masks(gray: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Маски горизонтальных и вертикальных линий таблиц."""
    h, w = gray.shape
    bw = binarize(gray)
    hor = cv2.morphologyEx(
        bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (max(20, w // 110), 1))
    )
    ver = cv2.morphologyEx(
        bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(20, h // 80)))
    )
    return hor, ver


def skew_angle(gray: np.ndarray) -> float:
    """Наклон страницы в градусах по длинным горизонтальным линиям (или строкам текста)."""
    h, w = gray.shape
    hor, _ = line_masks(gray)
    lines = cv2.HoughLinesP(hor, 1, np.pi / 1800, threshold=200, minLineLength=w // 6, maxLineGap=20)
    angles: list[float] = []
    if lines is not None:
        for x1, y1, x2, y2 in lines.reshape(-1, 4):
            angle = math.degrees(math.atan2(y2 - y1, x2 - x1))
            if abs(angle) < 10:
                angles.append(angle)
    if len(angles) >= 3:
        return float(np.median(angles))
    # Страница без таблиц: оценка по строкам текста
    bw = binarize(gray)
    smeared = cv2.dilate(bw, cv2.getStructuringElement(cv2.MORPH_RECT, (40, 3)))
    contours, _ = cv2.findContours(smeared, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for c in contours:
        (_, _), (cw, ch), angle = cv2.minAreaRect(c)
        if cw < ch:
            cw, ch, angle = ch, cw, angle - 90
        if cw > w / 8 and ch < cw / 8:
            angles.append(angle if angle <= 45 else angle - 90)
    angles = [a for a in angles if abs(a) < 10]
    return float(np.median(angles)) if angles else 0.0


def rotate(gray: np.ndarray, angle: float) -> np.ndarray:
    if abs(angle) < 0.05:
        return gray
    h, w = gray.shape
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(gray, m, (w, h), flags=cv2.INTER_CUBIC, borderValue=255)


def prepare(gray: np.ndarray) -> np.ndarray:
    """Поворот страницы в правильную ориентацию и устранение наклона."""
    turn = detect_rotation(gray)
    if turn == 90:
        gray = cv2.rotate(gray, cv2.ROTATE_90_CLOCKWISE)
    elif turn == 180:
        gray = cv2.rotate(gray, cv2.ROTATE_180)
    elif turn == 270:
        gray = cv2.rotate(gray, cv2.ROTATE_90_COUNTERCLOCKWISE)
    angle = skew_angle(gray)
    if abs(angle) >= 0.05:
        log.debug("Наклон страницы %.2f°", angle)
        gray = rotate(gray, angle)
    return crop_to_tables(gray)


def crop_to_tables(gray: np.ndarray) -> np.ndarray:
    """Мелкий скан (таблица занимает часть страницы): обрезка полей и увеличение до рабочего размера."""
    h, w = gray.shape
    hor, ver = line_masks(gray)
    ys, xs = np.nonzero(hor | ver)
    if len(xs) < 2000:
        return gray
    x1, x2 = (int(v) for v in np.percentile(xs, [0.2, 99.8]))
    y1, y2 = (int(v) for v in np.percentile(ys, [0.2, 99.8]))
    if (x2 - x1) > 0.7 * w or (y2 - y1) > 0.7 * h:
        return gray
    # Поле вокруг таблиц: заголовок страницы и подписи над таблицей
    mx, my = int(0.04 * (x2 - x1)), int(0.08 * (y2 - y1))
    crop = gray[max(0, y1 - my) : min(h, y2 + my), max(0, x1 - mx) : min(w, x2 + mx)]
    log.debug("Таблицы занимают часть страницы: обрезка %dx%d и увеличение", crop.shape[1], crop.shape[0])
    return _fit(crop)
