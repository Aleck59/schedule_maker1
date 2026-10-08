"""Командная строка вычислительного модуля (вызывается backend как подпроцесс).

    python -m app info                 — версии компонентов (JSON)
    python -m app solve < problem.json — решение задачи расписания, результат в stdout (JSON)
    python -m app recognize FILE...    — распознавание скана учебного плана (JSON)

Ход выполнения пишется в stderr строками ``PROGRESS {"fraction": 0.5, "message": "..."}``,
диагностические сообщения — обычными строками журнала.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time

from . import __version__

log = logging.getLogger("engine")


def progress(fraction: float, message: str) -> None:
    sys.stderr.write(
        "PROGRESS "
        + json.dumps({"fraction": round(fraction, 3), "message": message}, ensure_ascii=False)
        + "\n"
    )
    sys.stderr.flush()


def write_json(data: object) -> None:
    sys.stdout.write(json.dumps(data, ensure_ascii=False))
    sys.stdout.flush()


def cmd_info(_: argparse.Namespace) -> int:
    from .ocr.tesseract import tesseract_info

    info: dict[str, object] = {
        "version": os.getenv("APP_VERSION", __version__),
        "python": sys.version.split()[0],
    }
    try:
        import ortools

        info["ortools"] = ortools.__version__
    except ImportError:  # pragma: no cover - зависит от окружения
        info["ortools"] = None
    info["ocr"] = tesseract_info()
    write_json(info)
    return 0


def cmd_solve(_: argparse.Namespace) -> int:
    from .cpsat import solve
    from .models import Problem

    problem = Problem.model_validate_json(sys.stdin.buffer.read())
    required = sum(d.lessons_required for d in problem.demands)
    log.info(
        "Задача: режим %s, дней %d, групп %d, спрос %d пар (%d потоков), лимит %.0f с",
        problem.mode,
        len(problem.days),
        len(problem.groups),
        required,
        len(problem.demands),
        problem.time_limit_seconds,
    )
    started = time.monotonic()
    result = solve(problem)
    log.info(
        "Результат: %s, поставлено %d из %d за %.1f с",
        result.status,
        result.stats.placed_lessons,
        result.stats.required_lessons,
        time.monotonic() - started,
    )
    sys.stdout.write(result.model_dump_json(by_alias=True))
    sys.stdout.flush()
    return 0


def cmd_recognize(args: argparse.Namespace) -> int:
    from .ocr.plan import recognize_files

    write_json(recognize_files(args.files, on_progress=progress))
    return 0


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        stream=sys.stderr,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    parser = argparse.ArgumentParser(prog="python -m app", description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("info", help="версии компонентов").set_defaults(func=cmd_info)
    sub.add_parser("solve", help="решить задачу расписания (JSON из stdin)").set_defaults(func=cmd_solve)
    rec = sub.add_parser("recognize", help="распознать скан учебного плана (PDF, JPG, PNG)")
    rec.add_argument("files", nargs="+")
    rec.set_defaults(func=cmd_recognize)
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except Exception as exc:  # pragma: no cover - сообщение об ошибке для backend
        log.exception("Ошибка выполнения команды %s", args.command)
        sys.stderr.write(f"ERROR {exc}\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
