"""Проверка сумм часов и исправление ошибок распознавания чисел.

Уравнения для каждого блока (семестр, итог за курс):
    контактная работа = лекции + лабораторные + практические + семинары
    всего = контактная работа + индивидуальный проект + самостоятельная работа + контроль
и для каждой колонки: семестр (нечётный) + семестр (чётный) = итог за курс.
Если с прочитанными значениями равенства не выполняются, перебираются вторые прочтения
ячеек; если и это не помогает — ищется единственная ячейка, исправление которой
выполняет все равенства. Иначе ячейки помечаются как требующие проверки."""

from __future__ import annotations

from dataclasses import dataclass, field
from itertools import product

from .normalize import parse_int

Key = tuple[str, str]  # (блок, поле)


@dataclass
class Num:
    value: int | None
    candidates: list[int]
    read: str = ""
    box: list[int] | None = None
    page: int | None = None
    status: str = "ok"  # ok | corrected | uncertain | unreadable


@dataclass
class Equation:
    lhs: Key
    rhs: list[Key]

    def keys(self) -> list[Key]:
        return [self.lhs, *self.rhs]


@dataclass
class CheckResult:
    values: dict[Key, Num] = field(default_factory=dict)
    failed: list[Equation] = field(default_factory=list)


def make_num(text: str | None, alt: str | None, box: list[int] | None = None, page: int | None = None) -> Num:
    if not text:
        return Num(0, [0])
    candidates = []
    for t in (text, alt):
        v = parse_int(t)
        if v is not None and v not in candidates:
            candidates.append(v)
    if not candidates:
        return Num(None, [], read=text, box=box, page=page, status="unreadable")
    return Num(candidates[0], candidates, read=text, box=box, page=page)


def build_equations(blocks: list[str], sem_blocks: list[str], fields_contact: list[str]) -> list[Equation]:
    eqs: list[Equation] = []
    for b in blocks:
        eqs.append(Equation((b, "contact"), [(b, f) for f in fields_contact]))
        eqs.append(
            Equation(
                (b, "total"), [(b, "contact"), (b, "individualProject"), (b, "selfStudy"), (b, "assessment")]
            )
        )
    if "course" in blocks and len(sem_blocks) == 2:
        for f in [
            "total",
            "contact",
            "lecture",
            "laboratory",
            "practical",
            "seminar",
            "individualProject",
            "selfStudy",
            "assessment",
        ]:
            eqs.append(Equation(("course", f), [(sem_blocks[0], f), (sem_blocks[1], f)]))
    return eqs


def _holds(eq: Equation, vals: dict[Key, int | None]) -> bool:
    parts = [vals.get(k, 0) for k in eq.rhs]
    lhs = vals.get(eq.lhs, 0)
    if lhs is None or any(p is None for p in parts):
        return False
    return lhs == sum(parts)  # type: ignore[arg-type]


def _all_hold(eqs: list[Equation], vals: dict[Key, int | None]) -> bool:
    return all(_holds(eq, vals) for eq in eqs)


def _solve_for(key: Key, eq: Equation, vals: dict[Key, int | None]) -> int | None:
    if key == eq.lhs:
        parts = [vals.get(k, 0) for k in eq.rhs]
        return None if any(p is None for p in parts) else sum(parts)  # type: ignore[arg-type]
    lhs = vals.get(eq.lhs, 0)
    others = [vals.get(k, 0) for k in eq.rhs if k != key]
    if lhs is None or any(p is None for p in others):
        return None
    return lhs - sum(others)  # type: ignore[operator]


def resolve(nums: dict[Key, Num], eqs: list[Equation]) -> CheckResult:
    """Подбирает значения, удовлетворяющие равенствам; меняет статус и value у Num."""
    for eq in eqs:
        for k in eq.keys():
            nums.setdefault(k, Num(0, [0]))
    vals: dict[Key, int | None] = {k: n.value for k, n in nums.items()}

    # 1. Нечитаемые ячейки: последовательно вычисляются из равенств с одним неизвестным
    changed = True
    while changed:
        changed = False
        for eq in eqs:
            unknown = [k for k in eq.keys() if vals.get(k) is None]
            if len(unknown) == 1:
                v = _solve_for(unknown[0], eq, vals)
                if v is not None and v >= 0:
                    vals[unknown[0]] = v
                    nums[unknown[0]].value = v
                    nums[unknown[0]].status = "corrected"
                    changed = True
    if _all_hold(eqs, vals):
        return CheckResult(nums)

    # 2. Перебор вторых прочтений (минимум замен)
    variable = [k for k, n in nums.items() if len(n.candidates) > 1]
    if variable and len(variable) <= 12:
        best: tuple[int, dict[Key, int | None]] | None = None
        for combo in product(*(range(len(nums[k].candidates)) for k in variable)):
            swaps = sum(1 for i in combo if i)
            if not swaps or (best and swaps >= best[0]):
                continue
            trial = dict(vals)
            for k, i in zip(variable, combo, strict=True):
                trial[k] = nums[k].candidates[i]
            if _all_hold(eqs, trial):
                best = (swaps, trial)
        if best:
            for k in variable:
                if best[1][k] != vals[k]:
                    nums[k].value = best[1][k]
                    nums[k].status = "corrected"
            return CheckResult(nums)

    # 3. Единственная ячейка, исправление которой выполняет все равенства
    failing = [eq for eq in eqs if not _holds(eq, vals)]
    involved = {k for eq in failing for k in eq.keys()}
    solutions: list[tuple[Key, int]] = []
    for k in involved:
        own = [eq for eq in eqs if k in eq.keys()]
        options = {_solve_for(k, eq, vals) for eq in own}
        if len(options) != 1:
            continue
        v = options.pop()
        if v is None or v < 0 or v == vals.get(k):
            continue
        trial = dict(vals)
        trial[k] = v
        if _all_hold(eqs, trial):
            solutions.append((k, v))
    if len(solutions) == 1:
        k, v = solutions[0]
        nums[k].value = v
        nums[k].status = "corrected"
        return CheckResult(nums)

    for k in involved:
        if nums[k].status == "ok" and (nums[k].read or nums[k].value):
            nums[k].status = "uncertain"
        elif nums[k].status == "unreadable":
            nums[k].status = "uncertain"
    return CheckResult(nums, failing)
