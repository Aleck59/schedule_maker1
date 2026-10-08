"""Загрузка страниц (PDF, JPG, PNG, TIFF) и подготовка изображений к распознаванию."""

from __future__ import annotations

import logging
import math
import os

import cv2
import numpy as np

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


def load_pages(paths: list[str]) -> list[np.ndarray]:
    """Все страницы файлов в оттенках серого, в порядке следования."""
    pages: list[np.ndarray] = []
    for path in paths:
        ext = os.path.splitext(path)[1].lower()
        with open(path, "rb") as fh:
            head = fh.read(5)
        if ext == ".pdf" or head == b"%PDF-":
            pages.extend(_load_pdf(path))
        else:
            data = np.fromfile(path, dtype=np.uint8)
            img = cv2.imdecode(data, cv2.IMREAD_GRAYSCALE)
            if img is None:
                raise ValueError(f"Не удалось прочитать изображение {os.path.basename(path)}")
            pages.append(_fit(img))
    return pages


def _load_pdf(path: str) -> list[np.ndarray]:
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(path)
    pages = []
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
            pages.append(np.ascontiguousarray(arr))
            page.close()
    finally:
        pdf.close()
    return pages


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
    return gray
