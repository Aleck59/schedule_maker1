import { useEffect, useState } from "react";
import {
  ChevronDown,
  FileSpreadsheet,
  FileText,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/common/field";
import { EmptyState, LoadingState, Spinner } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-reference";
import { api, downloadFile, errorMessage } from "@/lib/api";
import { addDays, formatDate, weekStart } from "@/lib/format";
import { useApi } from "@/lib/query";
import type { PrintFormSettings } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

interface FormSheetInfo {
  key: string;
  specialtyId: string;
  title: string;
  profile: string | null;
  groupCodes: string[];
}

const EMPTY: PrintFormSettings = {
  approvals: [],
  footerPosition: "",
  footerName: "",
  profiles: {},
};

/**
 * Печатная форма расписания на неделю: бланк по специальности с грифами «Согласовано» и «Утверждаю»,
 * столбцы — курсы и группы, строки — дни и пары. Выгрузка в PDF для печати и в Excel для правки.
 */
export function PrintFormDialog({
  open,
  onOpenChange,
  periodId,
  initialWeek = "",
  permanentId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  periodId?: string;
  initialWeek?: string;
  /** Постоянное расписание: бланк типовой недели (дни без дат) */
  permanentId?: string;
}) {
  const qc = useQueryClient();
  const settings = useSettings();
  const [week, setWeek] = useState(initialWeek);
  const [weekLabel, setWeekLabel] = useState("");
  const [lessonTypes, setLessonTypes] = useState(false);
  const [form, setForm] = useState<PrintFormSettings>(EMPTY);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [signaturesOpen, setSignaturesOpen] = useState(false);
  const [busy, setBusy] = useState<"pdf" | "xlsx" | null>(null);
  const base = permanentId
    ? `/permanent-schedules/${permanentId}/form`
    : "/schedule-form";
  const sheets = useApi<FormSheetInfo[]>(
    ["schedule-form", week, periodId, permanentId],
    open ? `${base}/sheets` : null,
    permanentId ? undefined : { from: week, periodId },
  );

  useEffect(() => {
    if (open) setWeek(initialWeek);
  }, [open, initialWeek]);
  useEffect(() => {
    const saved = settings.data?.settings.printFormJson;
    if (open && saved) setForm(structuredClone(saved));
  }, [open, settings.data]);

  const list = sheets.data ?? [];
  const chosen = list.filter((s) => !excluded.has(s.key));
  const setApproval = (
    i: number,
    patch: Partial<PrintFormSettings["approvals"][number]>,
  ) =>
    setForm((f) => ({
      ...f,
      approvals: f.approvals.map((a, j) => (j === i ? { ...a, ...patch } : a)),
    }));

  const download = async (format: "pdf" | "xlsx") => {
    setBusy(format);
    try {
      // Подписи и профили запоминаются: в следующий раз бланк заполнится сам
      if (
        JSON.stringify(form) !==
        JSON.stringify(settings.data?.settings.printFormJson ?? EMPTY)
      ) {
        try {
          await api.patch("/settings", { printFormJson: form });
          void qc.invalidateQueries({ queryKey: ["settings"] });
        } catch (e) {
          // Без права менять настройки бланк всё равно печатается с введёнными подписями
          if (!permanentId) throw e;
        }
      }
      await downloadFile(
        `${base}/export`,
        {
          from: permanentId ? undefined : week,
          periodId: permanentId ? undefined : periodId,
          format,
          keys:
            chosen.length === list.length
              ? undefined
              : chosen.map((s) => s.key).join(","),
          weekLabel: permanentId ? undefined : weekLabel.trim() || undefined,
          lessonTypes: lessonTypes ? "true" : undefined,
        },
        format === "pdf" ? "Расписание.pdf" : "Расписание.xlsx",
      );
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {permanentId
              ? "Печатная форма постоянного расписания"
              : "Печатная форма расписания"}
          </DialogTitle>
          <DialogDescription>
            {permanentId
              ? "Типовая неделя по каждой специальности для утверждения руководством: курсы и группы — столбцами, дни недели и пары — строками."
              : "Бланк на неделю по каждой специальности: курсы и группы — столбцами, дни и пары — строками, с грифами согласования и утверждения."}
          </DialogDescription>
        </DialogHeader>

        <div className={cn("grid gap-3", !permanentId && "sm:grid-cols-3")}>
          {!permanentId && (
          <>
          <Field
            label="Неделя"
            hint={`${formatDate(week)} — ${formatDate(addDays(week, 6))}`}
          >
            <Input
              type="date"
              value={week}
              onChange={(e) =>
                e.target.value && setWeek(weekStart(e.target.value))
              }
            />
          </Field>
          <Field label="Подпись недели" hint="Например, «1 неделя»">
            <Input
              value={weekLabel}
              onChange={(e) => setWeekLabel(e.target.value)}
              placeholder="1 неделя"
              maxLength={60}
            />
          </Field>
          </>
          )}
          <Field label="Вид занятия">
            <label className="flex h-9 items-center gap-2 text-sm">
              <Switch checked={lessonTypes} onCheckedChange={setLessonTypes} />{" "}
              Указывать (лек., пр.)
            </label>
          </Field>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Специальности</div>
          {sheets.isLoading ? (
            <LoadingState rows={2} />
          ) : list.length === 0 ? (
            <EmptyState
              title={
                permanentId
                  ? "В постоянном расписании нет пар"
                  : "На этой неделе занятий нет"
              }
              description={
                permanentId
                  ? "Сформируйте сетку"
                  : "Выберите другую неделю или опубликуйте расписание"
              }
            />
          ) : (
            <div className="divide-y rounded-lg border">
              {list.map((s) => (
                <div
                  key={s.key}
                  className="grid gap-2 p-3 sm:grid-cols-[1fr_14rem] sm:items-center"
                >
                  <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={!excluded.has(s.key)}
                      onCheckedChange={(v) =>
                        setExcluded((prev) => {
                          const next = new Set(prev);
                          if (v) next.delete(s.key);
                          else next.add(s.key);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">{s.title}</span>
                      <span className="text-muted-foreground text-xs">
                        {s.groupCodes.join(", ")}
                      </span>
                    </span>
                  </label>
                  <Input
                    aria-label="Профиль"
                    placeholder="Профиль, например «Социально-экономический»"
                    value={form.profiles[s.specialtyId] ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        profiles: {
                          ...f.profiles,
                          [s.specialtyId]: e.target.value,
                        },
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          )}
          <p className="text-muted-foreground text-xs">
            «На базе основного / среднего общего образования» берётся из
            учебного плана группы.
          </p>
        </div>

        <div className="rounded-lg border">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-medium"
            onClick={() => setSignaturesOpen((v) => !v)}
            aria-expanded={signaturesOpen}
          >
            Грифы и подпись
            <ChevronDown
              className={cn(
                "size-4 transition-transform",
                signaturesOpen && "rotate-180",
              )}
            />
          </button>
          {signaturesOpen && (
            <div className="space-y-3 border-t p-3">
              {form.approvals.map((a, i) => (
                <div
                  key={i}
                  className="grid gap-2 sm:grid-cols-[9rem_1fr_10rem_auto]"
                >
                  <Input
                    aria-label="Гриф"
                    value={a.heading}
                    onChange={(e) =>
                      setApproval(i, { heading: e.target.value })
                    }
                    placeholder="УТВЕРЖДАЮ"
                  />
                  <Input
                    aria-label="Должность"
                    value={a.position}
                    onChange={(e) =>
                      setApproval(i, { position: e.target.value })
                    }
                    placeholder="И.о. директора филиала"
                  />
                  <Input
                    aria-label="Фамилия И.О."
                    value={a.name}
                    onChange={(e) => setApproval(i, { name: e.target.value })}
                    placeholder="Фамилия И.О."
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Убрать гриф"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        approvals: f.approvals.filter((_, j) => j !== i),
                      }))
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              {form.approvals.length < 3 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      approvals: [
                        ...f.approvals,
                        { heading: "ВНЕСЕНО", position: "", name: "" },
                      ],
                    }))
                  }
                >
                  <Plus /> Добавить гриф
                </Button>
              )}
              <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
                <Field label="Подпись внизу: должность">
                  <Input
                    value={form.footerPosition}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, footerPosition: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Фамилия И.О.">
                  <Input
                    value={form.footerName}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, footerName: e.target.value }))
                    }
                  />
                </Field>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => download("xlsx")}
            disabled={!!busy || chosen.length === 0}
          >
            {busy === "xlsx" ? <Spinner /> : <FileSpreadsheet />} Excel
          </Button>
          <Button
            onClick={() => download("pdf")}
            disabled={!!busy || chosen.length === 0}
          >
            {busy === "pdf" ? <Spinner /> : <FileText />} PDF для печати
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
