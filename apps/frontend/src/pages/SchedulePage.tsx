import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CalendarPlus,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  LayoutGrid,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Printer,
  Lock,
  Send,
  ShieldCheck,
  Trash2,
  Undo2,
  Unlock,
  X,
  Wand2,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Confirm } from "@/components/common/confirm";
import { PageHeader } from "@/components/common/page-header";
import { SimpleSelect } from "@/components/common/simple-select";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Spinner,
} from "@/components/common/states";
import { PeriodStatusBadge } from "@/components/common/status-badge";
import { CreateLessonDialog } from "@/components/schedule/create-lesson-dialog";
import { ConflictFixesDialog } from "@/components/schedule/conflict-fixes";
import { IssuesList } from "@/components/schedule/issues-list";
import { useLessonMove } from "@/components/schedule/lesson-move";
import { LessonDialog } from "@/components/schedule/lesson-dialog";
import { LessonTypeLegend } from "@/components/schedule/lesson-card";
import { MonthView } from "@/components/schedule/month-view";
import { PrintFormDialog } from "@/components/schedule/print-form-dialog";
import {
  ScheduleGrid,
  weekColumns,
  type GridColumn,
} from "@/components/schedule/week-grid";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useClassrooms,
  useGroups,
  usePeriods,
  useSettings,
  useTeachers,
} from "@/hooks/use-reference";
import { api, downloadFile, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  addDays,
  formatDate,
  formatDateLong,
  isoWeekday,
  today,
  weekStart,
  weekdayName,
} from "@/lib/format";
import { CANCELLATION_REASON_LABELS } from "@/lib/labels";
import { useApi, useApiMutation } from "@/lib/query";
import { cn } from "@/lib/utils";
import type {
  CalendarEvent,
  Lesson,
  SchedulePeriod,
  ValidationIssue,
  ValidationSummary,
} from "@/lib/types";

type View = "group" | "teacher" | "classroom" | "day" | "month";

export default function SchedulePage() {
  const { canEdit, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const periods = usePeriods();
  const settings = useSettings();
  const groups = useGroups();
  const teachers = useTeachers(user?.role !== "STUDENT");
  const classrooms = useClassrooms(
    user?.role !== "STUDENT" && user?.role !== "TEACHER",
  );

  const view =
    (params.get("view") as View) ||
    (user?.role === "TEACHER" ? "teacher" : "group");
  const periodId = params.get("period");
  const entityId = params.get(
    view === "teacher"
      ? "teacherId"
      : view === "classroom"
        ? "classroomId"
        : "groupId",
  );
  const [monthRange, setMonthRange] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createInitial, setCreateInitial] = useState<
    Record<string, string | number | undefined>
  >({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Контекстное меню пары (правый клик): массовое редактирование
  const [ctx, setCtx] = useState<{ lesson: Lesson; x: number; y: number } | null>(null);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [showValidation, setShowValidationRaw] = useState(false);
  // Панель с ошибками закрыта крестиком — до следующей проверки
  const [validationDismissed, setValidationDismissed] = useState(false);
  // Список несостыковок свёрнут под спойлер
  const [issuesOpen, setIssuesOpen] = useState(false);
  const setShowValidation = (show: boolean) => {
    setShowValidationRaw(show);
    setValidationDismissed(!show);
  };
  const [showFixes, setShowFixes] = useState(false);
  const [unpublishOpen, setUnpublishOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);

  const setParam = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  // Все группы колледжа одним списком; период (учебный план и семестр) определяется по выбранной группе и неделе
  const allGroups = useMemo(
    () =>
      [...(groups.data ?? [])]
        .filter((g) => g.isActive !== false)
        .sort((a, b) => a.code.localeCompare(b.code, "ru", { numeric: true })),
    [groups.data],
  );
  const refFrom =
    view === "day"
      ? (params.get("day") ?? today())
      : (params.get("week") ?? weekStart(today()));
  const refTo = view === "day" ? refFrom : addDays(refFrom, 6);
  const periodsOfProgram = (programId: string | undefined) =>
    (periods.data ?? []).filter(
      (p) => !p.semester.program || p.semester.program.id === programId,
    );
  const pickPeriod = (list: SchedulePeriod[]) => {
    const now = today();
    return (
      list.find((p) => p.startDate <= refTo && p.endDate >= refFrom) ??
      list.find((p) => now >= p.startDate && now <= p.endDate) ??
      [...list].sort(
        (a, b) =>
          Math.abs(Date.parse(a.startDate) - Date.parse(refFrom)) -
          Math.abs(Date.parse(b.startDate) - Date.parse(refFrom)),
      )[0]
    );
  };
  // Группы, для которых составлено расписание (есть хотя бы один период)
  const programsWithPeriods = useMemo(() => {
    const set = new Set<string>();
    for (const p of periods.data ?? [])
      if (p.semester.program) set.add(p.semester.program.id);
    return set;
  }, [periods.data]);
  const anyProgramPeriod = (periods.data ?? []).some(
    (p) => !p.semester.program,
  );
  const hasPeriod = (g: { educationalProgramId: string }) =>
    anyProgramPeriod || programsWithPeriods.has(g.educationalProgramId);
  const explicitPeriod = (periods.data ?? []).find((p) => p.id === periodId);
  const defaultGroup = useMemo(() => {
    if (explicitPeriod?.semester.program)
      return allGroups.find(
        (g) => g.educationalProgramId === explicitPeriod.semester.program!.id,
      );
    const now = today();
    const current = new Set(
      (periods.data ?? [])
        .filter((p) => now >= p.startDate && now <= p.endDate)
        .map((p) => p.semester.program?.id),
    );
    return (
      allGroups.find((g) => current.has(g.educationalProgramId)) ??
      allGroups.find(hasPeriod)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allGroups, periods.data, explicitPeriod]);
  const selectedGroup = allGroups.find((g) => g.id === params.get("groupId"));
  const groupForPeriod =
    selectedGroup && hasPeriod(selectedGroup) ? selectedGroup : defaultGroup;

  const period: SchedulePeriod | undefined = useMemo(() => {
    const list = groupForPeriod
      ? periodsOfProgram(groupForPeriod.educationalProgramId)
      : (periods.data ?? []);
    if (
      explicitPeriod &&
      list.includes(explicitPeriod) &&
      explicitPeriod.startDate <= refTo &&
      explicitPeriod.endDate >= refFrom
    )
      return explicitPeriod;
    if (explicitPeriod && !params.get("week") && !params.get("day"))
      if (list.includes(explicitPeriod)) return explicitPeriod;
    return pickPeriod(list) ?? (periods.data ?? [])[0];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periods.data, groupForPeriod, explicitPeriod, refFrom, refTo]);

  const week =
    params.get("week") ??
    (period
      ? weekStart(
          today() >= period.startDate && today() <= period.endDate
            ? today()
            : period.startDate,
        )
      : weekStart(today()));
  const day =
    params.get("day") ??
    (period && today() >= period.startDate && today() <= period.endDate
      ? today()
      : (period?.startDate ?? today()));

  // Сущность по умолчанию
  // Группы учебного плана текущего периода — столбцы режима «День»
  const periodGroups = useMemo(
    () =>
      allGroups.filter(
        (g) =>
          !period?.semester.program ||
          g.educationalProgramId === period.semester.program.id,
      ),
    [allGroups, period],
  );
  useEffect(() => {
    if (!period) return;
    // Без выбранной группы (или с группой без расписания) открывается первая группа с расписанием
    if (
      view === "group" &&
      defaultGroup &&
      (!selectedGroup || !hasPeriod(selectedGroup))
    ) {
      setParam({ groupId: defaultGroup.id });
    }
    if (view === "teacher" && !entityId) {
      const id =
        user?.role === "TEACHER" ? user.teacherId : teachers.data?.[0]?.id;
      if (id) setParam({ teacherId: id });
    }
    if (view === "classroom" && !entityId && classrooms.data?.[0])
      setParam({ classroomId: classrooms.data[0].id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, entityId, period, periodGroups, teachers.data, classrooms.data]);

  const range =
    view === "month"
      ? (monthRange ?? {
          from: addDays(period?.startDate ?? today(), 0),
          to: addDays(period?.startDate ?? today(), 41),
        })
      : view === "day"
        ? { from: day, to: day }
        : { from: week, to: addDays(week, 6) };

  const lessonQuery = useApi<Lesson[]>(
    ["lessons", view, period?.id, entityId, range.from, range.to],
    period && (view === "day" || view === "month" || entityId)
      ? "/schedule-lessons"
      : null,
    {
      // Месяц по всем группам — занятия всех учебных планов
      periodId:
        view === "teacher" ||
        view === "classroom" ||
        (view === "month" && !params.get("groupId"))
          ? undefined
          : period?.id,
      groupId:
        view === "group" || (view === "month" && params.get("groupId"))
          ? (params.get("groupId") ?? undefined)
          : undefined,
      teacherId: view === "teacher" ? (entityId ?? undefined) : undefined,
      classroomId: view === "classroom" ? (entityId ?? undefined) : undefined,
      from: range.from,
      to: range.to,
      // экзамены и зачёты из календарного графика — в сетке вместе с парами
      withAssessments: "true",
    },
  );
  const lessons = lessonQuery.data ?? [];
  const lessonCount = lessons.filter((l) => !l.assessment).length;

  const events = useApi<CalendarEvent[]>(
    ["calendar-events", range.from, range.to, period?.semester.program?.id],
    period ? "/calendar-events" : null,
    {
      from: range.from,
      to: range.to,
      programId: period?.semester.program?.id,
    },
  );
  const blocked = useMemo(() => {
    const map: Record<string, string> = {};
    const group = allGroups.find((g) => g.id === params.get("groupId"));
    for (const e of events.data ?? []) {
      if (!e.blocksSchedule || e.teacherId) continue;
      if (
        view === "group" &&
        e.studentGroupId &&
        e.studentGroupId !== group?.id
      )
        continue;
      for (
        let d = e.startDate.slice(0, 10);
        d <= e.endDate.slice(0, 10);
        d = addDays(d, 1)
      ) {
        if (d >= range.from && d <= range.to) map[d] = e.title;
      }
    }
    return map;
  }, [events.data, allGroups, params, view, range.from, range.to]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["lessons"] });
    void qc.invalidateQueries({ queryKey: ["hour-control"] });
    void qc.invalidateQueries({ queryKey: ["validation"] });
  };

  const move = useLessonMove();

  const validation = useApi<ValidationIssue[]>(
    ["validation", period?.id],
    period && canEdit
      ? `/schedule-periods/${period.id}/validation-results`
      : null,
  );
  const validate = useApiMutation(
    () =>
      api.post<ValidationSummary>(`/schedule-periods/${period!.id}/validate`),
    {
      success: (r) =>
        `Проверка завершена: ошибок ${r.errors}, предупреждений ${r.warnings}`,
      invalidate: [["validation"], ["schedule-periods"]],
      onSuccess: () => setShowValidation(true),
    },
  );
  const publish = useApiMutation(
    () => api.post(`/schedule-periods/${period!.id}/publish`),
    {
      success:
        "Расписание опубликовано. Студенты и преподаватели получили уведомления",
      invalidate: [["schedule-periods"], ["validation"]],
      onError: (e) => {
        toast.error(errorMessage(e), { duration: 8000 });
        setShowValidation(true);
        void qc.invalidateQueries({ queryKey: ["validation"] });
        return true;
      },
    },
  );
  const unpublish = useApiMutation(
    () => api.post(`/schedule-periods/${period!.id}/unpublish`),
    {
      success: "Публикация снята",
      invalidate: [["schedule-periods"]],
    },
  );

  const bulk = useApiMutation(
    ({
      ids,
      ...vars
    }: {
      ids?: string[];
      action: string;
      patch?: Record<string, unknown>;
      reason?: string;
    }) =>
      api.post<{
        processed: number;
        succeeded: number;
        failed: Array<{ message?: string }>;
      }>("/schedule-lessons/bulk", {
        ids: ids ?? [...selected],
        ...vars,
      }),
    {
      success: (r) =>
        `Обработано: ${r.succeeded} из ${r.processed}${r.failed.length ? `. Ошибки: ${r.failed[0]?.message}` : ""}`,
      onSuccess: () => {
        setSelected(new Set());
        invalidate();
      },
    },
  );

  const columns: GridColumn[] = useMemo(() => {
    const workingDays = settings.data?.settings.workingDays ?? [
      1, 2, 3, 4, 5, 6,
    ];
    if (view === "day") {
      return periodGroups.map((g) => ({
        key: g.id,
        date: day,
        title: g.code,
        subtitle: `${g.studentCount} чел.`,
        blocked: blocked[day] ?? null,
        match: (l: Lesson) => l.studentGroupId === g.id,
      }));
    }
    return weekColumns(week, workingDays, view === "group" ? blocked : {});
  }, [view, periodGroups, day, week, blocked, settings.data]);

  const groupOptions = allGroups.map((g) => ({
    value: g.id,
    label: g.code,
    disabled: !hasPeriod(g),
    hint: hasPeriod(g) ? undefined : "расписание ещё не составлено",
  }));
  const entityOptions =
    view === "teacher"
      ? (teachers.data ?? []).map((t) => ({ value: t.id, label: t.fullName }))
      : view === "classroom"
        ? (classrooms.data ?? []).map((c) => ({
            value: c.id,
            label: `${c.code} — ${c.name}`,
          }))
        : groupOptions;

  const exportPdf = async (whole: boolean) => {
    if (!period) return;
    const kind =
      view === "teacher"
        ? "teacher"
        : view === "classroom"
          ? "classroom"
          : "group";
    const id =
      view === "teacher"
        ? entityId
        : view === "classroom"
          ? entityId
          : (params.get("groupId") ?? periodGroups[0]?.id);
    if (!id) return;
    try {
      await downloadFile(
        `/schedule-periods/${period.id}/export/${kind}/${id}/pdf`,
        whole ? undefined : { from: week, to: addDays(week, 6) },
        "Расписание.pdf",
      );
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  // Постоянное расписание (типовая неделя) открывается отсюда, отдельного пункта меню нет
  const showPermanent =
    !!user && ["ADMIN", "DISPATCHER", "MANAGER"].includes(user.role);

  if (periods.isLoading) return <LoadingState rows={8} />;
  if (periods.error)
    return (
      <ErrorState error={periods.error} onRetry={() => periods.refetch()} />
    );
  if (!period) {
    return (
      <EmptyState
        title="Периоды расписания не созданы"
        description="Составьте расписание в разделе «Составление» — периоды создадутся автоматически"
        action={
          showPermanent && (
            <Button variant="outline" asChild>
              <Link to="/schedule/permanent">
                <CalendarClock /> Постоянное расписание
              </Link>
            </Button>
          )
        }
      />
    );
  }

  const errorsCount = (validation.data ?? []).filter(
    (v) => v.severity === "ERROR",
  ).length;
  const editable = canEdit && period.status !== "ARCHIVED";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Расписание"
        description={`${formatDate(period.startDate)} — ${formatDate(period.endDate)}`}
        actions={
          <>
            <PeriodStatusBadge status={period.status} />
            {showPermanent && (
              <Button variant="outline" asChild>
                <Link to="/schedule/permanent">
                  <CalendarClock /> Постоянное
                </Link>
              </Button>
            )}
            {canEdit && (
              <>
                <Button
                  variant="outline"
                  onClick={() => validate.mutate(undefined)}
                  disabled={validate.isPending}
                >
                  {validate.isPending ? <Spinner /> : <ShieldCheck />} Проверить
                </Button>
                {period.status !== "PUBLISHED" && (
                  <Button
                    onClick={() => publish.mutate(undefined)}
                    disabled={publish.isPending}
                  >
                    {publish.isPending ? <Spinner /> : <Send />} Опубликовать
                  </Button>
                )}
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" aria-label="Ещё">
                  <MoreHorizontal />{" "}
                  <span className="hidden sm:inline">Ещё</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to={`/schedule/week?week=${week}`}>
                    <LayoutGrid /> Полное расписание на неделю
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Экспорт в PDF</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => exportPdf(false)}>
                  <FileText /> Текущая неделя
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportPdf(true)}>
                  <FileText /> Весь период
                </DropdownMenuItem>
                {user?.role !== "TEACHER" && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setPrintOpen(true)}>
                      <Printer /> Печатная форма на неделю…
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Экспорт в Excel</DropdownMenuLabel>
                    <DropdownMenuItem
                      onClick={() =>
                        downloadFile(
                          `/schedule-periods/${period.id}/export/excel`,
                          undefined,
                          "Расписание.xlsx",
                        ).catch((e) => toast.error(errorMessage(e)))
                      }
                    >
                      <FileSpreadsheet /> Период целиком
                    </DropdownMenuItem>
                  </>
                )}
                {canEdit && period.status === "PUBLISHED" && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setUnpublishOpen(true)}>
                      <Undo2 /> Снять с публикации
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <PrintFormDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        periodId={period.id}
        initialWeek={week}
      />

      <Confirm
        open={unpublishOpen}
        onOpenChange={setUnpublishOpen}
        title="Снять расписание с публикации?"
        description="Студенты и преподаватели перестанут видеть это расписание."
        onConfirm={() => unpublish.mutate(undefined)}
      />

      {canEdit &&
        (showValidation || (errorsCount > 0 && !validationDismissed)) &&
        validation.data && (
        <Alert
          variant={
            errorsCount
              ? "destructive"
              : validation.data.length
                ? "warning"
                : "success"
          }
        >
          <AlertTitle className="flex items-center justify-between">
            <span>
              Проверка расписания: ошибок {errorsCount}, предупреждений{" "}
              {validation.data.filter((v) => v.severity === "WARNING").length}
              {errorsCount > 0 &&
                (period.status === "PUBLISHED"
                  ? " — расписание уже опубликовано, исправьте ошибки"
                  : " — публикация заблокирована")}
            </span>
            <span className="flex items-center gap-1">
              {validation.data.some(
                (v) =>
                  v.severity === "ERROR" ||
                  v.validationType === "ONLINE_EXPECTED",
              ) && (
                <Button size="sm" onClick={() => setShowFixes(true)}>
                  <Wand2 /> Как исправить
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setShowValidation(false)}
                aria-label="Скрыть результаты проверки"
              >
                <X />
              </Button>
            </span>
          </AlertTitle>
          <AlertDescription>
            {validation.data.length === 0 ? (
              "Ошибок и предупреждений нет"
            ) : (
              <div className="w-full">
                <button
                  type="button"
                  onClick={() => setIssuesOpen((v) => !v)}
                  aria-expanded={issuesOpen}
                  className="hover:bg-foreground/5 -ml-2 flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium transition-colors"
                >
                  <ChevronDown
                    className={cn(
                      "size-4 transition-transform duration-300",
                      issuesOpen && "rotate-180",
                    )}
                  />
                  {issuesOpen ? "Скрыть несостыковки" : "Показать несостыковки"}
                  <span className="opacity-70">({validation.data.length})</span>
                </button>
                <div
                  className={cn(
                    "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
                    issuesOpen
                      ? "grid-rows-[1fr] opacity-100"
                      : "grid-rows-[0fr] opacity-0",
                  )}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div className="mt-2 max-h-56 overflow-y-auto pr-1">
                      <IssuesList issues={validation.data} max={100} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      {period && canEdit && (
        <ConflictFixesDialog
          periodId={period.id}
          open={showFixes}
          onOpenChange={setShowFixes}
          onChanged={invalidate}
        />
      )}

      <Card className="py-3">
        <CardContent className="flex flex-wrap items-center gap-2 px-3">
          <Tabs value={view} onValueChange={(v) => setParam({ view: v })}>
            <TabsList className="h-auto flex-wrap">
              <TabsTrigger value="group">Группа</TabsTrigger>
              {user?.role !== "STUDENT" && (
                <TabsTrigger value="teacher">Преподаватель</TabsTrigger>
              )}
              {canEdit || user?.role === "MANAGER" ? (
                <TabsTrigger value="classroom">Аудитория</TabsTrigger>
              ) : null}
              <TabsTrigger value="day">День</TabsTrigger>
              <TabsTrigger value="month">Месяц</TabsTrigger>
            </TabsList>
          </Tabs>
          {(view === "group" ||
            view === "teacher" ||
            view === "classroom" ||
            view === "month") && (
            <div className="w-full sm:w-80 lg:w-96">
              <SimpleSelect
                searchable
                value={view === "month" ? params.get("groupId") : entityId}
                onChange={(v) =>
                  setParam(
                    view === "teacher"
                      ? { teacherId: v }
                      : view === "classroom"
                        ? { classroomId: v }
                        : { groupId: v, period: null },
                  )
                }
                allowEmpty={view === "month"}
                emptyLabel="Все группы"
                options={view === "month" ? groupOptions : entityOptions}
                placeholder="Выберите…"
              />
            </div>
          )}
          {view !== "month" && (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                onClick={() =>
                  view === "day"
                    ? setParam({ day: addDays(day, -1) })
                    : setParam({ week: addDays(week, -7) })
                }
                aria-label="Назад"
              >
                <ChevronLeft />
              </Button>
              <Input
                type="date"
                className="w-40"
                value={view === "day" ? day : week}
                onChange={(e) =>
                  e.target.value &&
                  (view === "day"
                    ? setParam({ day: e.target.value })
                    : setParam({ week: weekStart(e.target.value) }))
                }
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() =>
                  view === "day"
                    ? setParam({ day: addDays(day, 1) })
                    : setParam({ week: addDays(week, 7) })
                }
                aria-label="Вперёд"
              >
                <ChevronRight />
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  setParam({ week: weekStart(today()), day: today() })
                }
              >
                Сегодня
              </Button>
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {editable && (
              <Button
                aria-label="Добавить занятие"
                onClick={() => {
                  setCreateInitial({
                    groupId: params.get("groupId") ?? undefined,
                    date: view === "day" ? day : week,
                  });
                  setCreateOpen(true);
                }}
              >
                <CalendarPlus />{" "}
                <span className="hidden sm:inline">Добавить занятие</span>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {editable && selected.size > 0 && (
        <BulkBar
          count={selected.size}
          pending={bulk.isPending}
          onAction={(action, extra) =>
            action === "delete"
              ? setDeleteIds([...selected])
              : bulk.mutate({ action, ...extra })
          }
          onClear={() => setSelected(new Set())}
        />
      )}

      {editable && (
        <LessonContextMenu
          ctx={ctx}
          onClose={() => setCtx(null)}
          selected={selected}
          visibleIds={lessons.filter((l) => !l.assessment).map((l) => l.id)}
          pending={bulk.isPending}
          onOpenLesson={(id) => setLessonId(id)}
          onSelect={setSelected}
          onAction={(ids, action) =>
            action === "delete"
              ? setDeleteIds(ids)
              : bulk.mutate({ ids, action })
          }
        />
      )}
      <Confirm
        open={!!deleteIds}
        onOpenChange={(o) => !o && setDeleteIds(null)}
        title={
          deleteIds?.length === 1
            ? "Удалить занятие?"
            : `Удалить занятий: ${deleteIds?.length ?? 0}?`
        }
        destructive
        confirmText="Удалить"
        onConfirm={() => {
          if (deleteIds) bulk.mutate({ ids: deleteIds, action: "delete" });
          setDeleteIds(null);
        }}
      />

      {view === "day" && (
        <div className="text-sm font-medium">
          {weekdayName(isoWeekday(day))}, {formatDateLong(day)}
          {blocked[day] ? ` — ${blocked[day]}` : ""}
        </div>
      )}

      {lessonQuery.isLoading ? (
        <LoadingState rows={8} />
      ) : lessonQuery.error ? (
        <ErrorState
          error={lessonQuery.error}
          onRetry={() => lessonQuery.refetch()}
        />
      ) : view === "month" ? (
        <MonthView
          lessons={lessons}
          initialDate={
            period.startDate > today() || period.endDate < today()
              ? period.startDate
              : today()
          }
          onLessonClick={(l) => setLessonId(l.id)}
          onDatesChange={(from, to) =>
            setMonthRange((r) =>
              r?.from === from && r?.to === to ? r : { from, to },
            )
          }
          showGroup={!params.get("groupId")}
        />
      ) : (
        <ScheduleGrid
          columns={columns}
          lessonTimes={settings.data?.lessonTimes ?? []}
          lessonsPerDay={settings.data?.settings.lessonsPerDay ?? 6}
          lessons={lessons}
          mode={view === "day" ? "day" : view}
          editable={editable}
          sameColumnOnly={view === "day"}
          onLessonClick={(l) => setLessonId(l.id)}
          onMove={(lesson, date, lessonNumber) =>
            move.move({ lesson, date, lessonNumber })
          }
          onCellClick={(date, lessonNumber, col) => {
            setCreateInitial({
              date,
              lessonNumber,
              groupId:
                view === "day"
                  ? col.key
                  : view === "group"
                    ? (params.get("groupId") ?? undefined)
                    : undefined,
              teacherId:
                view === "teacher" ? (entityId ?? undefined) : undefined,
              classroomId:
                view === "classroom" ? (entityId ?? undefined) : undefined,
            });
            setCreateOpen(true);
          }}
          onLessonContextMenu={
            editable
              ? (lesson, e) => setCtx({ lesson, x: e.clientX, y: e.clientY })
              : undefined
          }
          selectedIds={selected.size > 0 ? selected : undefined}
          onToggleSelect={
            selected.size > 0
              ? (id) =>
                  setSelected((s) => {
                    const n = new Set(s);
                    if (n.has(id)) n.delete(id);
                    else n.add(id);
                    return n;
                  })
              : undefined
          }
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <LessonTypeLegend />
        <div className="text-muted-foreground text-xs">
          Занятий на экране: {lessonCount}
          {editable &&
            view !== "month" &&
            " · перетащите карточку, чтобы перенести занятие; правый клик — массовое редактирование"}
        </div>
      </div>

      <LessonDialog
        lessonId={lessonId}
        open={!!lessonId}
        onOpenChange={(o) => !o && setLessonId(null)}
        onChanged={invalidate}
      />
      <CreateLessonDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        period={period}
        initial={createInitial}
        onCreated={invalidate}
      />

      {move.panel}
    </div>
  );
}

function BulkBar({
  count,
  pending,
  onAction,
  onClear,
}: {
  count: number;
  pending: boolean;
  onAction: (
    action: string,
    extra?: { patch?: Record<string, unknown>; reason?: string },
  ) => void;
  onClear: () => void;
}) {
  const classrooms = useClassrooms();
  const teachers = useTeachers();
  const [classroomId, setClassroomId] = useState<string | null>(null);
  const [teacherId, setTeacherId] = useState<string | null>(null);
  const [shift, setShift] = useState("7");
  const [reason, setReason] = useState("OTHER");
  return (
    <Card className="border-primary/40 py-3">
      <CardContent className="flex flex-wrap items-center gap-2 px-3">
        <Badge>{count}</Badge>
        <span className="text-sm font-medium">выбрано</span>
        <div className="w-44">
          <SimpleSelect
            value={classroomId}
            onChange={setClassroomId}
            placeholder="Аудитория…"
            options={(classrooms.data ?? []).map((c) => ({
              value: c.id,
              label: c.code,
            }))}
            size="sm"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={!classroomId || pending}
          onClick={() => onAction("update", { patch: { classroomId } })}
        >
          Сменить аудиторию
        </Button>
        <div className="w-52">
          <SimpleSelect
            value={teacherId}
            onChange={setTeacherId}
            placeholder="Преподаватель…"
            options={(teachers.data ?? []).map((t) => ({
              value: t.id,
              label: t.fullName,
            }))}
            size="sm"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={!teacherId || pending}
          onClick={() => onAction("update", { patch: { teacherId } })}
        >
          Сменить преподавателя
        </Button>
        <Input
          className="h-8 w-16"
          type="number"
          value={shift}
          onChange={(e) => setShift(e.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            onAction("update", { patch: { shiftDays: Number(shift) } })
          }
        >
          Сдвинуть на дни
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => onAction("lock")}
        >
          <Lock /> Закрепить
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => onAction("unlock")}
        >
          <Unlock /> Открепить
        </Button>
        <div className="w-48">
          <SimpleSelect
            value={reason}
            onChange={(v) => setReason(v ?? "OTHER")}
            options={Object.entries(CANCELLATION_REASON_LABELS).map(
              ([value, label]) => ({ value, label }),
            )}
            size="sm"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => onAction("cancel", { reason })}
        >
          Отменить
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={pending}
          onClick={() => onAction("delete")}
        >
          <Trash2 /> Удалить
        </Button>
        <Button size="sm" variant="ghost" onClick={onClear}>
          Сбросить выбор
        </Button>
      </CardContent>
    </Card>
  );
}

/** Контекстное меню пары (правый клик): выбор занятий и массовые действия */
function LessonContextMenu({
  ctx,
  onClose,
  selected,
  visibleIds,
  pending,
  onOpenLesson,
  onSelect,
  onAction,
}: {
  ctx: { lesson: Lesson; x: number; y: number } | null;
  onClose: () => void;
  selected: Set<string>;
  visibleIds: string[];
  pending: boolean;
  onOpenLesson: (id: string) => void;
  onSelect: (next: Set<string>) => void;
  onAction: (ids: string[], action: "lock" | "unlock" | "delete") => void;
}) {
  const lesson = ctx?.lesson;
  const isSelected = !!lesson && selected.has(lesson.id);
  // Действия применяются к выделенным занятиям, если пара входит в выделение, иначе — к ней одной
  const targets = lesson
    ? isSelected
      ? [...selected]
      : [lesson.id]
    : [];
  const many = targets.length > 1;
  return (
    <DropdownMenu
      open={!!ctx}
      onOpenChange={(o) => !o && onClose()}
      modal={false}
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          className="pointer-events-none fixed size-0"
          style={{ left: ctx?.x ?? 0, top: ctx?.y ?? 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={2}
        className="w-72"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {lesson && (
          <>
            <DropdownMenuLabel className="line-clamp-2 text-xs font-medium">
              {lesson.semesterItem.curriculumItem.name}
              <span className="text-muted-foreground block font-normal">
                {lesson.studentGroup.code} · {formatDate(lesson.date)} ·{" "}
                {lesson.lessonNumber} пара
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onOpenLesson(lesson.id)}>
              <FileText /> Открыть занятие
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                const next = new Set(selected);
                if (isSelected) next.delete(lesson.id);
                else next.add(lesson.id);
                onSelect(next);
              }}
            >
              <ListChecks />
              {isSelected ? "Снять выделение" : "Выделить"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onSelect(new Set([...selected, ...visibleIds]))}
            >
              <CheckSquare /> Выделить все на экране
            </DropdownMenuItem>
            {selected.size > 0 && (
              <DropdownMenuItem onSelect={() => onSelect(new Set())}>
                <X /> Сбросить выделение ({selected.size})
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
              {many ? `Выделенные занятия: ${targets.length}` : "Это занятие"}
            </DropdownMenuLabel>
            <DropdownMenuItem
              disabled={pending}
              onSelect={() => onAction(targets, "lock")}
            >
              <Lock /> Закрепить
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={pending}
              onSelect={() => onAction(targets, "unlock")}
            >
              <Unlock /> Открепить
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={pending}
              onSelect={() => onAction(targets, "delete")}
            >
              <Trash2 /> Удалить…
            </DropdownMenuItem>
            {!isSelected && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => onSelect(new Set([...selected, lesson.id]))}
                >
                  <Pencil /> Массовое редактирование…
                </DropdownMenuItem>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
