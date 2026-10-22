import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Info, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Confirm } from '@/components/common/confirm';
import { Field } from '@/components/common/field';
import { PageHeader } from '@/components/common/page-header';
import { SimpleSelect } from '@/components/common/simple-select';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  HOLIDAY_DAY_KIND_LABELS,
  HOLIDAY_KIND_LABELS,
  HOLIDAY_MONTHS,
  holidayDateLabel,
  monthMatrix,
  type HolidayDayKind,
} from '@/lib/holidays';
import { useApi, useApiMutation } from '@/lib/query';
import { cn } from '@/lib/utils';

interface HolidayDay {
  date: string;
  kind: HolidayDayKind;
  title: string;
  reason: string;
}

interface HolidayCalendar {
  year: number;
  workingDays: number[];
  days: HolidayDay[];
  daysOff: string[];
  warnings: string[];
  autoTransfer: boolean;
  weekMode: 'FIVE_DAY' | 'SIX_DAY';
  synced: boolean;
  summary: {
    workingDays: number;
    daysOff: number;
    holidays: number;
    transferredDaysOff: number;
    workingWeekends: number;
    shortenedDays: number;
  };
}

interface Holiday {
  id: string;
  title: string;
  kind: 'FEDERAL' | 'REGIONAL' | 'CUSTOM';
  month: number | null;
  day: number | null;
  date: string | null;
  transferable: boolean;
  active: boolean;
  notes: string | null;
}

interface Transfer {
  id: string;
  fromDate: string;
  toDate: string;
  basis: string | null;
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const DAY_STYLE: Record<HolidayDayKind, string> = {
  HOLIDAY: 'bg-red-500 text-white font-semibold',
  TRANSFERRED_DAY_OFF: 'bg-orange-200 text-orange-950 dark:bg-orange-500/40 dark:text-orange-50',
  WORKING_WEEKEND: 'ring-2 ring-inset ring-emerald-500 text-foreground',
  SHORTENED: 'text-foreground',
};

const INVALIDATE = [['holidays'], ['holiday-calendar'], ['holiday-transfers'], ['calendar-events'], ['calendar-graph']];

export default function HolidaysPage() {
  const { canEdit } = useAuth();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [dialog, setDialog] = useState<{ holiday?: Holiday } | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const calendar = useApi<HolidayCalendar>(['holiday-calendar', year], `/holidays/calendar/${year}`);
  const holidays = useApi<Holiday[]>(['holidays'], '/holidays');
  const transfers = useApi<Transfer[]>(['holiday-transfers', year], '/holidays/transfers', { year });

  const toggle = useApiMutation((v: { id: string; patch: Partial<Holiday> }) => api.patch(`/holidays/${v.id}`, v.patch), {
    success: 'Сохранено, календарь пересчитан',
    invalidate: INVALIDATE,
  });
  const removeHoliday = useApiMutation((id: string) => api.delete(`/holidays/${id}`), {
    success: 'Праздник удалён',
    invalidate: INVALIDATE,
  });
  const removeTransfer = useApiMutation((id: string) => api.delete(`/holidays/transfers/${id}`), {
    success: 'Перенос удалён',
    invalidate: INVALIDATE,
  });
  const setAutoTransfer = useApiMutation((autoTransfer: boolean) => api.put('/holidays/settings', { autoTransfer }), {
    success: 'Правило переноса сохранено',
    invalidate: INVALIDATE,
  });
  const restore = useApiMutation(() => api.post('/holidays/restore-defaults'), {
    success: 'Федеральные праздники и переносы восстановлены',
    invalidate: INVALIDATE,
  });
  const apply = useApiMutation(() => api.post(`/holidays/calendar/${year}/apply`), {
    success: 'Нерабочие дни добавлены в календарный график',
    invalidate: INVALIDATE,
  });

  const c = calendar.data;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Праздники"
        description="Нерабочие праздничные дни и переносы выходных — в эти дни занятия не ставятся"
        actions={
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Предыдущий год" onClick={() => setYear((y) => y - 1)}>
              <ChevronLeft />
            </Button>
            <span className="w-14 text-center text-lg font-semibold tabular-nums">{year}</span>
            <Button variant="ghost" size="icon" aria-label="Следующий год" onClick={() => setYear((y) => y + 1)}>
              <ChevronRight />
            </Button>
          </div>
        }
      />

      {calendar.isLoading ? (
        <LoadingState rows={6} />
      ) : calendar.error || !c ? (
        <ErrorState error={calendar.error} onRetry={() => calendar.refetch()} />
      ) : (
        <>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            <span>
              <b className="text-foreground tabular-nums">{c.summary.workingDays}</b> рабочих дней
            </span>
            <span>
              <b className="text-foreground tabular-nums">{c.summary.holidays}</b> праздничных
            </span>
            <span>
              <b className="text-foreground tabular-nums">{c.summary.transferredDaysOff}</b> перенесённых выходных
            </span>
            {c.summary.workingWeekends > 0 && (
              <span>
                <b className="text-foreground tabular-nums">{c.summary.workingWeekends}</b> рабочих выходных
              </span>
            )}
            <span>
              <b className="text-foreground tabular-nums">{c.summary.shortenedDays}</b> сокращённых
            </span>
            <Badge variant="muted">{c.weekMode === 'SIX_DAY' ? 'Шестидневная неделя' : 'Пятидневная неделя'}</Badge>
          </div>

          {c.warnings.length > 0 && (
            <ul className="text-muted-foreground space-y-1 text-xs">
              {c.warnings.map((w) => (
                <li key={w} className="flex gap-1.5">
                  <Info className="mt-px size-3.5 shrink-0" />
                  {w}
                </li>
              ))}
            </ul>
          )}
          {!c.synced && canEdit && (
            <Alert>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>Нерабочие дни {year} года ещё не добавлены в календарный график.</span>
                <Button size="sm" onClick={() => apply.mutate(undefined)} disabled={apply.isPending}>
                  Добавить в график
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <Tabs defaultValue="year">
            <TabsList className="max-w-full justify-start overflow-x-auto">
              <TabsTrigger value="year">Календарь</TabsTrigger>
              <TabsTrigger value="holidays">Праздники</TabsTrigger>
              <TabsTrigger value="transfers">Переносы</TabsTrigger>
              <TabsTrigger value="rules">Правила</TabsTrigger>
            </TabsList>

            <TabsContent value="year" className="space-y-4">
              <YearGrid calendar={c} />
              <Legend />
              <DayList days={c.days} />
            </TabsContent>

            <TabsContent value="holidays" className="space-y-3">
              {canEdit && (
                <div className="flex justify-end">
                  <Button onClick={() => setDialog({})}>
                    <Plus /> Праздник
                  </Button>
                </div>
              )}
              {holidays.isLoading ? (
                <LoadingState rows={6} />
              ) : (
                <Card className="py-0">
                  <CardContent className="divide-y px-0">
                    {(holidays.data ?? []).map((h) => (
                      <div key={h.id} className={cn('flex flex-wrap items-center gap-3 px-4 py-2.5', !h.active && 'opacity-50')}>
                        <div className="w-28 shrink-0 text-sm font-medium tabular-nums">{holidayDateLabel(h)}</div>
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            className="text-left text-sm hover:underline disabled:no-underline"
                            disabled={!canEdit}
                            onClick={() => setDialog({ holiday: h })}
                          >
                            {h.title}
                          </button>
                          <div className="text-muted-foreground text-xs">
                            {HOLIDAY_KIND_LABELS[h.kind]}
                            {h.date ? ' · разовый' : ' · каждый год'}
                            {h.transferable ? ' · переносится с выходного' : ''}
                          </div>
                        </div>
                        {canEdit && (
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={h.active}
                              aria-label="Действует"
                              onCheckedChange={(active) => toggle.mutate({ id: h.id, patch: { active } })}
                            />
                            <Confirm
                              title="Удалить праздник?"
                              description={`«${h.title}» больше не будет нерабочим днём.`}
                              destructive
                              confirmText="Удалить"
                              onConfirm={() => removeHoliday.mutateAsync(h.id)}
                              trigger={
                                <Button variant="ghost" size="icon" aria-label="Удалить">
                                  <Trash2 />
                                </Button>
                              }
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="transfers" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-muted-foreground text-sm">
                  Переносы выходных на {year} год по постановлению Правительства РФ или решению колледжа.
                </p>
                {canEdit && (
                  <Button onClick={() => setTransferOpen(true)}>
                    <Plus /> Перенос
                  </Button>
                )}
              </div>
              {transfers.data && transfers.data.length === 0 ? (
                <EmptyState
                  title="Переносов нет"
                  description="Добавьте переносы, когда Правительство опубликует постановление на этот год."
                />
              ) : (
                <Card className="py-0">
                  <CardContent className="divide-y px-0">
                    {(transfers.data ?? []).map((t) => (
                      <div key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                        <div className="min-w-0 flex-1 text-sm">
                          <span className="font-medium">{formatDay(t.fromDate)}</span>
                          <span className="text-muted-foreground"> → </span>
                          <span className="font-medium">{formatDay(t.toDate)}</span>
                          {t.basis && <div className="text-muted-foreground text-xs">{t.basis}</div>}
                        </div>
                        {canEdit && (
                          <Confirm
                            title="Удалить перенос?"
                            destructive
                            confirmText="Удалить"
                            onConfirm={() => removeTransfer.mutateAsync(t.id)}
                            trigger={
                              <Button variant="ghost" size="icon" aria-label="Удалить">
                                <Trash2 />
                              </Button>
                            }
                          />
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="rules">
              <Card>
                <CardContent className="space-y-4 text-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium">Перенос выходного по ст. 112 ТК РФ</div>
                      <p className="text-muted-foreground">
                        Если праздник выпал на выходной, выходной переносится на следующий рабочий день. Например, 8 марта
                        в субботу — отдыхаем в понедельник 10 марта.
                      </p>
                    </div>
                    <Switch
                      checked={c.autoTransfer}
                      disabled={!canEdit}
                      aria-label="Переносить выходной"
                      onCheckedChange={(v) => setAutoTransfer.mutate(v)}
                    />
                  </div>
                  <ul className="text-muted-foreground list-disc space-y-1 pl-5">
                    <li>
                      Выходные, совпавшие с новогодними праздниками (1–8 января), переносятся только постановлением
                      Правительства — их задают на вкладке «Переносы».
                    </li>
                    <li>
                      Если постановление переносит выходной с праздника на другую дату, автоматический перенос для этого
                      праздника не применяется.
                    </li>
                    <li>
                      Режим недели берётся из настроек (учебные дни). При шестидневной неделе суббота рабочая: переносы с
                      субботы не действуют, праздник в субботу не переносится.
                    </li>
                    <li>Предпраздничный рабочий день сокращается на 1 час — на число пар это не влияет.</li>
                    <li>
                      Праздничные и перенесённые дни сразу попадают в календарный график: генерация и проверка расписания
                      их учитывают.
                    </li>
                  </ul>
                  {canEdit && (
                    <Confirm
                      title="Восстановить федеральные праздники?"
                      description="Праздники по ТК РФ и переносы по постановлениям вернутся к значениям по умолчанию. Свои и региональные праздники сохранятся."
                      confirmText="Восстановить"
                      onConfirm={() => restore.mutateAsync(undefined)}
                      trigger={
                        <Button variant="outline">
                          <RotateCcw /> Восстановить по умолчанию
                        </Button>
                      }
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}

      {dialog && <HolidayDialog holiday={dialog.holiday} defaultYear={year} onClose={() => setDialog(null)} />}
      {transferOpen && <TransferDialog year={year} onClose={() => setTransferOpen(false)} />}
    </div>
  );
}

function formatDay(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });
}

function YearGrid({ calendar }: { calendar: HolidayCalendar }) {
  const byDate = useMemo(() => {
    const map = new Map<string, HolidayDay[]>();
    for (const d of calendar.days) map.set(d.date, [...(map.get(d.date) ?? []), d]);
    return map;
  }, [calendar.days]);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {HOLIDAY_MONTHS.map((name, m) => (
        <Card key={name} className="gap-2 py-3">
          <CardContent className="px-3">
            <div className="mb-1.5 text-sm font-medium">{name}</div>
            <div className="grid grid-cols-7 gap-0.5 text-center text-[11px]">
              {WEEKDAYS.map((w) => (
                <div key={w} className="text-muted-foreground pb-0.5">
                  {w}
                </div>
              ))}
              {monthMatrix(calendar.year, m).map((cell, i) => {
                if (!cell) return <div key={i} />;
                const entries = byDate.get(cell.date) ?? [];
                const main = entries.find((e) => e.kind !== 'SHORTENED');
                const shortened = entries.some((e) => e.kind === 'SHORTENED');
                const weekend = !calendar.workingDays.includes(cell.weekday);
                return (
                  <div
                    key={i}
                    title={entries.map((e) => `${e.title}: ${e.reason}`).join('\n') || undefined}
                    className={cn(
                      'relative rounded-md py-1 tabular-nums',
                      weekend && !main && 'text-muted-foreground bg-muted',
                      main && DAY_STYLE[main.kind],
                    )}
                  >
                    {cell.day}
                    {shortened && <span className="absolute bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-amber-500" />}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Legend() {
  const items: Array<[string, string]> = [
    [DAY_STYLE.HOLIDAY, HOLIDAY_DAY_KIND_LABELS.HOLIDAY],
    [DAY_STYLE.TRANSFERRED_DAY_OFF, HOLIDAY_DAY_KIND_LABELS.TRANSFERRED_DAY_OFF],
    [DAY_STYLE.WORKING_WEEKEND, HOLIDAY_DAY_KIND_LABELS.WORKING_WEEKEND],
    ['bg-muted', 'Выходной'],
  ];
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {items.map(([cls, label]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className={cn('inline-block size-3.5 rounded', cls)} />
          {label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="inline-block size-1.5 rounded-full bg-amber-500" />
        {HOLIDAY_DAY_KIND_LABELS.SHORTENED}
      </span>
    </div>
  );
}

function DayList({ days }: { days: HolidayDay[] }) {
  const rows = days.filter((d) => d.kind !== 'HOLIDAY' || !d.title.startsWith('Новогодние'));
  return (
    <Card className="py-0">
      <CardContent className="divide-y px-0">
        {rows.map((d) => (
          <div key={`${d.date}-${d.kind}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-sm">
            <span className="w-40 shrink-0 font-medium">{formatDay(d.date)}</span>
            <span className="min-w-0 flex-1">
              {d.title}
              <span className="text-muted-foreground block text-xs">{d.reason}</span>
            </span>
            <Badge variant={d.kind === 'HOLIDAY' ? 'destructive' : d.kind === 'TRANSFERRED_DAY_OFF' ? 'warning' : d.kind === 'WORKING_WEEKEND' ? 'success' : 'muted'}>
              {HOLIDAY_DAY_KIND_LABELS[d.kind]}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function HolidayDialog({ holiday, defaultYear, onClose }: { holiday?: Holiday; defaultYear: number; onClose: () => void }) {
  const [title, setTitle] = useState(holiday?.title ?? '');
  const [kind, setKind] = useState<string>(holiday?.kind ?? 'REGIONAL');
  const [oneOff, setOneOff] = useState(holiday ? !!holiday.date : true);
  const [date, setDate] = useState(holiday?.date ?? `${defaultYear}-01-01`);
  const [month, setMonth] = useState(String(holiday?.month ?? 1));
  const [day, setDay] = useState(String(holiday?.day ?? 1));
  const [transferable, setTransferable] = useState(holiday?.transferable ?? false);
  const [notes, setNotes] = useState(holiday?.notes ?? '');
  const save = useApiMutation(
    () => {
      const body = {
        title,
        kind,
        transferable,
        notes: notes || null,
        ...(oneOff ? { date, month: null, day: null } : { date: null, month: Number(month), day: Number(day) }),
      };
      return holiday ? api.patch(`/holidays/${holiday.id}`, body) : api.post('/holidays', body);
    },
    { success: 'Праздник сохранён, календарь пересчитан', invalidate: INVALIDATE, onSuccess: onClose },
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{holiday ? 'Праздник' : 'Новый праздник'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Название" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например, Ураза-байрам" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Вид">
              <SimpleSelect
                value={kind}
                onChange={(v) => setKind(v ?? 'CUSTOM')}
                options={Object.entries(HOLIDAY_KIND_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <Field label="Повторяется">
              <SimpleSelect
                value={oneOff ? 'once' : 'yearly'}
                onChange={(v) => setOneOff(v === 'once')}
                options={[
                  { value: 'yearly', label: 'Каждый год' },
                  { value: 'once', label: 'Один раз (дата)' },
                ]}
              />
            </Field>
          </div>
          {oneOff ? (
            <Field label="Дата" hint="Для праздников с плавающей датой (Ураза-байрам, Курбан-байрам) — задайте на каждый год">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="День">
                <Input type="number" min={1} max={31} value={day} onChange={(e) => setDay(e.target.value)} />
              </Field>
              <Field label="Месяц">
                <SimpleSelect
                  value={month}
                  onChange={(v) => setMonth(v ?? '1')}
                  options={HOLIDAY_MONTHS.map((label, i) => ({ value: String(i + 1), label }))}
                />
              </Field>
            </div>
          )}
          <label className="flex items-start justify-between gap-4 text-sm">
            <span>
              Переносить выходной
              <span className="text-muted-foreground block text-xs">
                Если праздник выпал на выходной — отдыхаем в следующий рабочий день
              </span>
            </span>
            <Switch checked={transferable} onCheckedChange={setTransferable} />
          </label>
          <Field label="Примечание">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Основание: указ Главы региона…" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={() => save.mutate(undefined)} disabled={!title.trim() || save.isPending}>
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({ year, onClose }: { year: number; onClose: () => void }) {
  const [fromDate, setFromDate] = useState(`${year}-01-01`);
  const [toDate, setToDate] = useState(`${year}-01-01`);
  const [basis, setBasis] = useState('');
  const save = useApiMutation(() => api.post('/holidays/transfers', { fromDate, toDate, basis: basis || null }), {
    success: 'Перенос добавлен, календарь пересчитан',
    invalidate: INVALIDATE,
    onSuccess: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Перенос выходного</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Выходной день" hint="Суббота или воскресенье">
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </Field>
            <Field label="Переносится на" hint="Этот день станет нерабочим">
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Основание">
            <Input
              value={basis}
              onChange={(e) => setBasis(e.target.value)}
              placeholder="Постановление Правительства РФ от … № …"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={() => save.mutate(undefined)} disabled={!fromDate || !toDate || save.isPending}>
            Добавить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
