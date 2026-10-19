import { useEffect, useState, type PointerEvent } from "react";
import { Spinner } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/use-reference";
import { api } from "@/lib/api";
import { WEEKDAYS_SHORT } from "@/lib/labels";
import { useApi, useApiMutation } from "@/lib/query";
import type { AvailabilitySlot } from "@/lib/types";
import { cn } from "@/lib/utils";

type CellState = "available" | "preferred" | "undesired" | "unavailable";

const BRUSHES: Array<{
  state: CellState;
  label: string;
  hint: string;
  mark: string;
}> = [
  {
    state: "available",
    label: "Доступно",
    hint: "Можно ставить занятия",
    mark: "✓",
  },
  {
    state: "preferred",
    label: "Желательно",
    hint: "Генератор старается ставить сюда",
    mark: "★",
  },
  {
    state: "undesired",
    label: "Нежелательно",
    hint: "Ставится, только если иначе никак",
    mark: "−",
  },
  {
    state: "unavailable",
    label: "Недоступно",
    hint: "Жёсткий запрет",
    mark: "✕",
  },
];

const CELL_STYLE: Record<CellState, string> = {
  available:
    "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300",
  preferred: "bg-sky-200 font-semibold text-sky-900",
  undesired: "bg-amber-200 text-amber-900",
  unavailable: "bg-red-200 text-red-900 line-through",
};

/**
 * Сетка доступности (день недели × пара). Справа выбирается режим («кисть»),
 * затем ячейки закрашиваются нажатием или протягиванием; нажатие на день или пару закрашивает строку или столбец.
 */
export function AvailabilityEditor({
  path,
  editable,
  invalidateKey,
}: {
  path: string;
  editable: boolean;
  invalidateKey: unknown[];
}) {
  const settings = useSettings();
  const data = useApi<AvailabilitySlot[]>(["availability", path], path);
  const [cells, setCells] = useState<Record<string, CellState>>({});
  const [dirty, setDirty] = useState(false);
  const [brush, setBrush] = useState<CellState>("unavailable");
  const [painting, setPainting] = useState(false);
  const days = settings.data?.settings.workingDays ?? [1, 2, 3, 4, 5, 6];
  const lessons = settings.data?.settings.lessonsPerDay ?? 6;

  useEffect(() => {
    const map: Record<string, CellState> = {};
    for (const s of data.data ?? []) {
      const w = s.preferenceWeight ?? 0;
      map[`${s.weekday}-${s.lessonNumber}`] = !s.isAvailable
        ? "unavailable"
        : w > 0
          ? "preferred"
          : w < 0
            ? "undesired"
            : "available";
    }
    setCells(map);
    setDirty(false);
  }, [data.data]);

  useEffect(() => {
    if (!painting) return;
    const stop = () => setPainting(false);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [painting]);

  const save = useApiMutation(
    () => {
      const items = Object.entries(cells)
        .filter(([, v]) => v !== "available")
        .map(([k, v]) => {
          const [weekday, lessonNumber] = k.split("-").map(Number);
          return {
            weekday,
            lessonNumber,
            isAvailable: v !== "unavailable",
            preferenceWeight:
              v === "preferred" ? 5 : v === "undesired" ? -5 : 0,
          };
        });
      return api.post(path, { items });
    },
    {
      success: "Доступность сохранена",
      invalidate: [["availability", path], invalidateKey],
      onSuccess: () => setDirty(false),
    },
  );

  const paint = (keys: string[]) => {
    if (!editable) return;
    setCells((c) => {
      if (keys.every((k) => (c[k] ?? "available") === brush)) return c;
      const next = { ...c };
      for (const k of keys) next[k] = brush;
      return next;
    });
    setDirty(true);
  };
  const lessonNumbers = Array.from({ length: lessons }, (_, i) => i + 1);
  // Протягивание пальцем: pointerenter на сенсорных экранах не срабатывает, ищем ячейку под точкой касания
  const onPointerMove = (e: PointerEvent<HTMLTableElement>) => {
    if (!painting) return;
    const el = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-cell]");
    if (el?.dataset.cell) paint([el.dataset.cell]);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start gap-3">
        <div className="max-w-full space-y-3">
          <div className="overflow-x-auto">
            <table
              className="border-collapse text-xs select-none"
              onPointerMove={onPointerMove}
            >
              <thead>
                <tr>
                  <th className="p-1" />
                  {lessonNumbers.map((n) => (
                    <th key={n} className="w-14 p-1 text-center font-medium">
                      <button
                        type="button"
                        disabled={!editable}
                        onClick={() => paint(days.map((d) => `${d}-${n}`))}
                        className={cn(
                          "rounded px-1",
                          editable && "hover:bg-muted cursor-pointer",
                        )}
                        title={editable ? "Закрасить всю пару" : undefined}
                      >
                        {n} пара
                      </button>
                      {settings.data?.lessonTimes[n - 1] && (
                        <div className="text-muted-foreground text-[10px] leading-tight font-normal">
                          {settings.data.lessonTimes[n - 1].startTime}
                          <br />
                          {settings.data.lessonTimes[n - 1].endTime}
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d}>
                    <td className="pr-2 font-medium">
                      <button
                        type="button"
                        disabled={!editable}
                        onClick={() =>
                          paint(lessonNumbers.map((n) => `${d}-${n}`))
                        }
                        className={cn(
                          "rounded px-1",
                          editable && "hover:bg-muted cursor-pointer",
                        )}
                        title={editable ? "Закрасить весь день" : undefined}
                      >
                        {WEEKDAYS_SHORT[d]}
                      </button>
                    </td>
                    {lessonNumbers.map((n) => {
                      const key = `${d}-${n}`;
                      const state = cells[key] ?? "available";
                      return (
                        <td key={key} className="p-0.5">
                          <button
                            type="button"
                            data-cell={key}
                            disabled={!editable}
                            onPointerDown={(e) => {
                              if (!editable || e.button !== 0) return;
                              e.preventDefault();
                              setPainting(true);
                              paint([key]);
                            }}
                            onPointerEnter={() => painting && paint([key])}
                            onKeyDown={(e) =>
                              (e.key === "Enter" || e.key === " ") &&
                              (e.preventDefault(), paint([key]))
                            }
                            aria-label={`${WEEKDAYS_SHORT[d]}, ${n} пара: ${BRUSHES.find((b) => b.state === state)?.label}`}
                            className={cn(
                              "h-8 w-14 rounded border text-[10px] transition-colors duration-150",
                              CELL_STYLE[state],
                              editable
                                ? "cursor-pointer touch-none hover:ring-primary/50 hover:ring-2"
                                : "cursor-default",
                            )}
                          >
                            {BRUSHES.find((b) => b.state === state)?.mark}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!editable && (
            <div className="text-muted-foreground flex flex-wrap items-center gap-4 text-xs">
              {BRUSHES.map((b) => (
                <span key={b.state}>
                  {b.mark} {b.label.toLowerCase()}
                </span>
              ))}
            </div>
          )}
        </div>
        {editable && (
          <div className="bg-muted/30 w-40 shrink-0 space-y-1.5 rounded-xl border p-2">
            <div className="px-1 text-xs font-medium">Режим</div>
            <div
              className="space-y-1"
              role="radiogroup"
              aria-label="Режим закрашивания"
            >
              {BRUSHES.map((b) => (
                <button
                  key={b.state}
                  type="button"
                  role="radio"
                  aria-checked={brush === b.state}
                  title={b.hint}
                  onClick={() => setBrush(b.state)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors",
                    brush === b.state
                      ? "border-primary bg-primary/10 ring-primary/30 font-medium ring-2"
                      : "bg-card hover:bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded border text-[10px]",
                      CELL_STYLE[b.state],
                    )}
                  >
                    {b.mark}
                  </span>
                  {b.label}
                </button>
              ))}
            </div>
            <Button
              size="sm"
              className="w-full"
              onClick={() => save.mutate(undefined)}
              disabled={!dirty || save.isPending}
            >
              {save.isPending && <Spinner />} Сохранить
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground h-auto w-full py-1 text-[11px]"
              onClick={() => {
                setCells({});
                setDirty(true);
              }}
            >
              Сбросить всё
            </Button>
          </div>
        )}
      </div>
      {editable && (
        <p className="text-muted-foreground text-xs">
          Выберите режим справа, затем нажмите или протяните по ячейкам. Нажатие
          на день или пару закрашивает их целиком.
        </p>
      )}
    </div>
  );
}
