"""Вызов Tesseract OCR: пакетное распознавание множества небольших изображений одним процессом."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np

TESSERACT = os.getenv("TESSERACT_CMD", "tesseract")
# Изображений в одном вызове: модель загружается один раз на пакет
BATCH_SIZE = 120


def tesseract_info() -> dict[str, object]:
    """Версия Tesseract и установленные языки; ready — можно распознавать русский текст."""
    path = shutil.which(TESSERACT)
    if not path:
        return {"ready": False, "version": None, "languages": [], "error": "tesseract не установлен"}
    try:
        version = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=20)
        langs = subprocess.run([path, "--list-langs"], capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired) as exc:  # pragma: no cover - зависит от окружения
        return {"ready": False, "version": None, "languages": [], "error": str(exc)}
    match = re.search(r"tesseract\s+v?([\d.]+)", version.stdout + version.stderr)
    languages = [line.strip() for line in langs.stdout.splitlines()[1:] if line.strip()]
    return {
        "ready": "rus" in languages,
        "version": match.group(1) if match else None,
        "languages": languages,
        "error": None if "rus" in languages else "не установлен языковой пакет tesseract-ocr-rus",
    }


def _run_batch(paths: list[str], args: list[str], workdir: str, tag: str) -> list[str]:
    list_file = os.path.join(workdir, f"list-{tag}.txt")
    with open(list_file, "w", encoding="utf-8") as fh:
        fh.write("\n".join(paths) + "\n")
    env = {**os.environ, "OMP_THREAD_LIMIT": "1"}
    proc = subprocess.run(
        [TESSERACT, list_file, "stdout", *args], capture_output=True, text=True, env=env, timeout=600
    )
    if proc.returncode != 0:
        raise RuntimeError(f"Tesseract завершился с ошибкой: {proc.stderr.strip()[:300]}")
    pages = proc.stdout.split("\f")
    if len(pages) < len(paths):  # pragma: no cover - защитный код
        pages += [""] * (len(paths) - len(pages))
    return [p.strip() for p in pages[: len(paths)]]


def ocr_images(
    images: list[np.ndarray],
    *,
    lang: str = "rus",
    psm: int = 6,
    whitelist: str | None = None,
    workers: int | None = None,
) -> list[str]:
    """Распознаёт список изображений (оттенки серого), возвращает текст каждого."""
    if not images:
        return []
    args = ["-l", lang, "--psm", str(psm)]
    if whitelist:
        args += ["-c", f"tessedit_char_whitelist={whitelist}"]
    workers = workers or max(1, min(8, os.cpu_count() or 1))
    with tempfile.TemporaryDirectory(prefix="ocr-") as workdir:
        paths = []
        for i, img in enumerate(images):
            path = os.path.join(workdir, f"{i:05d}.png")
            cv2.imwrite(path, img)
            paths.append(path)
        chunks = [paths[i : i + BATCH_SIZE] for i in range(0, len(paths), BATCH_SIZE)]
        with ThreadPoolExecutor(max_workers=workers) as pool:
            results = pool.map(lambda c: _run_batch(c[1], args, workdir, str(c[0])), enumerate(chunks))
            return [text for chunk in results for text in chunk]


def ocr_text(image: np.ndarray, *, lang: str = "rus", psm: int = 3) -> str:
    """Распознаёт страницу целиком (для титульного листа и подписей таблиц)."""
    return ocr_images([image], lang=lang, psm=psm, workers=1)[0]


def detect_rotation(image: np.ndarray) -> int:
    """Угол поворота страницы (0, 90, 180, 270) по данным Tesseract OSD; 0 — если не определён."""
    h, w = image.shape[:2]
    scale = 1600 / max(h, w)
    small = cv2.resize(image, (int(w * scale), int(h * scale))) if scale < 1 else image
    with tempfile.TemporaryDirectory(prefix="osd-") as workdir:
        path = os.path.join(workdir, "page.png")
        cv2.imwrite(path, small)
        try:
            proc = subprocess.run(
                [TESSERACT, path, "stdout", "--psm", "0"], capture_output=True, text=True, timeout=60
            )
        except (OSError, subprocess.TimeoutExpired):  # pragma: no cover
            return 0
    rotate = re.search(r"Rotate:\s*(\d+)", proc.stdout)
    conf = re.search(r"Orientation confidence:\s*([\d.]+)", proc.stdout)
    if not rotate or not conf or float(conf.group(1)) < 2.0:
        return 0
    return int(rotate.group(1)) % 360
