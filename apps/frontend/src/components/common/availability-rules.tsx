import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Laptop, Pencil, Plus, Trash2 } from 'lucide-react';
import { Confirm } from '@/components/common/confirm';
import { Field } from '@/components/common/field';
import { SimpleSelect } from '@/components/common/simple-select';
import { EmptyState, Spinner } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useSettings } from '@/hooks/use-reference';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { WEEKDAYS_SHORT } from '@/lib/labels';
import { useApi, useApiMutation } from '@/lib/query';
import { cn } from '@/lib/utils';

export type RuleKind = 'UNAVAILABLE' | 'AVAILABLE_ONLY' | 'PREFERRED' | 'UNDESIRED' | 'ONLINE';
export type WeekParity = 'ANY' | 'ODD' | 'EVEN';

export interface AvailabilityRule {
  id: string;
  kind: RuleKind;
  weekdays: number[];
  lessonNumbers: number[];
  timeFrom: string | null;
  timeTo: string | null;
  parity: WeekParity;
  monthWeeks: number[];
  validFrom: string | null;
  validTo: string | null;
  weight: number;
  note: string | null;
  description?: string;
}

type RuleForm = Omit<AvailabilityRule, 'id' | 'description'>;

const KIND: Record<RuleKind, { label: string; hint: string; variant: 'destructive' | 'info' | 'success' | 'warning' | 'violet' }> = {
  UNAVAILABLE: { label: 'Не может', hint: 'Жёсткое ограничение: занятия не ставятся', variant: 'destructive' },
  AVAILABLE_ONLY: { label: 'Может только', hint: 'Вне указанного времени занятия не ставятся', variant: 'info' },
  PREFERRED: { label: 'Желательно', hint: 'Генератор старается ставить занятия в это время', variant: 'success' },
  UNDESIRED: { label: 'Нежелательно', hint: 'Генератор по возможности избегает этого времени', variant: 'warning' },
  ONLINE: { label: 'Онлайн', hint: 'Занятия в это время ставятся в онлайн-аудиторию', variant: 'violet' },
};
const MONTH_WEEKS = [
  { value: 1, label: '1-я' },
  { value: 2, label: '2-я' },
  { value: 3, label: '3-я' },
  { value: 4, label: '4-я' },
  { value: 5, label: '5-я' },
  { value: -1, label: 'последняя' },
];
const EMPTY: RuleForm = {
  kind: 'UNAVAILABLE',
  weekdays: [],
  lessonNumbers: [],
  timeFrom: null,
  timeTo: null,
  parity: 'ANY',
  monthWeeks: [],
  validFrom: null,
  validTo: null,
  weight: 5,
  note: null,
};

/** Готовые правила для частых случаев */
const PRESETS: Array<{ title: string; form: Partial<RuleForm> }> = [
  { title: 'Последняя суббота месяца — не может', form: { kind: 'UNAVAILABLE', weekdays: [6], monthWeeks: [-1] } },
  { title: '1-я неделя месяца — онлайн', form: { kind: 'ONLINE', monthWeeks: [1] } },
  { title: 'Методический день (среда) — не может', form: { kind: 'UNAVAILABLE', weekdays: [3], note: 'Методический день' } },
  { title: 'Только до 14:00', form: { kind: 'AVAILABLE_ONLY', timeFrom: '08:00', timeTo: '14:00' } },
  { title: 'Чётные недели — не может по пятницам', form: { kind: 'UNAVAILABLE', weekdays: [5], parity: 'EVEN' } },
  { title: 'Желательно первые пары', form: { kind: 'PREFERRED', lessonNumbers: [1, 2] } },
];

function Chips<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string; title?: string }>;
  value: T[];
  onChange: (value: T[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = value.includes(o.value);
        return (
          <button
            key={String(o.value)}
            type="button"
            title={o.title}
            onClick={() => onChange(active ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={cn(
              'rounded-md border px-2.5 py-1 text-xs transition-colors',
              active ? 'border-primary bg-primary text-white' : 'hover:bg-muted',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function RuleDialog({
  teacherId,
  rule,
  initial,
  open,
  onOpenChange,
}: {
  teacherId: string;
  rule: AvailabilityRule | null;
  initial: Partial<RuleForm> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const settings = useSettings();
  const [form, setForm] = useState<RuleForm>(EMPTY);
  const [mode, setMode] = useState<'lessons' | 'time'>('lessons');
  const [preview, setPreview] = useState<{ description: string; dates: Array<{ date: string; lessons: number[] }> } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const days = settings.data?.settings.workingDays ?? [1, 2, 3, 4, 5, 6];
  const times = settings.data?.lessonTimes ?? [];
  const lessons = settings.data?.settings.lessonsPerDay ?? 6;

  useEffect(() => {
    if (!open) return;
    const base: RuleForm = rule
      ? {
          ...rule,
          validFrom: rule.validFrom?.slice(0, 10) ?? null,
          validTo: rule.validTo?.slice(0, 10) ?? null,
        }
      : { ...EMPTY, ...(initial ?? {}) };
    setForm(base);
    setMode(base.timeFrom || base.timeTo ? 'time' : 'lessons');
  }, [open, rule, initial]);

  const body = useMemo(
    () => ({
      ...form,
      lessonNumbers: mode === 'lessons' ? form.lessonNumbers : [],
      timeFrom: mode === 'time' ? form.timeFrom || null : null,
      timeTo: mode === 'time' ? form.timeTo || null : null,
      validFrom: form.validFrom || null,
      validTo: form.validTo || null,
      note: form.note?.trim() || null,
    }),
    [form, mode],
  );

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      api
        .post<{ description: string; dates: Array<{ date: string; lessons: number[] }> }>(
          `/teachers/${teacherId}/availability-rules/preview`,
          body,
        )
        .then((r) => {
          setPreview(r);
          setPreviewError(null);
        })
        .catch((e: Error) => setPreviewError(e.message));
    }, 300);
    return () => clearTimeout(timer);
  }, [body, open, teacherId]);

  const save = useApiMutation(
    () => (rule ? api.patch(`/teachers/${teacherId}/availability-rules/${rule.id}`, body) : api.post(`/teachers/${teacherId}/availability-rules`, body)),
    {
      success: rule ? 'Правило изменено' : 'Правило добавлено',
      invalidate: [['availability-rules', teacherId]],
      onSuccess: () => onOpenChange(false),
    },
  );
  const set = (patch: Partial<RuleForm>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{rule ? 'Изменить правило доступности' : 'Новое правило доступности'}</DialogTitle>
          <DialogDescription>Правило учитывается при автосоставлении, ручной правке и проверке расписания.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[65vh] gap-4 overflow-y-auto pr-1">
          <Field label="Что означает правило">
            <div className="grid gap-1.5 sm:grid-cols-5">
              {(Object.keys(KIND) as RuleKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => set({ kind: k })}
                  title={KIND[k].hint}
                  className={cn(
                    'rounded-md border px-2 py-2 text-xs font-medium',
                    form.kind === k ? 'border-primary bg-primary/10 ring-primary ring-1' : 'hover:bg-muted',
                  )}
                >
                  {KIND[k].label}
                </button>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">{KIND[form.kind].hint}</p>
          </Field>
          <Field label="Дни недели" hint="Не выбрано — любой день">
            <Chips
              options={days.map((d) => ({ value: d, label: WEEKDAYS_SHORT[d] }))}
              value={form.weekdays}
              onChange={(weekdays) => set({ weekdays: [...weekdays].sort((a, b) => a - b) })}
            />
          </Field>
          <Field label="Неделя месяца" hint="Например: последняя + суббота = «последняя суббота месяца». Не выбрано — каждая неделя">
            <Chips options={MONTH_WEEKS} value={form.monthWeeks} onChange={(monthWeeks) => set({ monthWeeks })} />
          </Field>
          <Field label="Чётность недели учебного года" hint="Неделя 1 — неделя, в которую входит 1 сентября">
            <SimpleSelect
              value={form.parity}
              onChange={(v) => set({ parity: (v ?? 'ANY') as WeekParity })}
              options={[
                { value: 'ANY', label: 'Все недели' },
                { value: 'ODD', label: 'Нечётные недели' },
                { value: 'EVEN', label: 'Чётные недели' },
              ]}
            />
          </Field>
          <Field label="Время занятий">
            <div className="flex gap-1.5">
              <Button type="button" size="sm" variant={mode === 'lessons' ? 'secondary' : 'ghost'} onClick={() => setMode('lessons')}>
                По номерам пар
              </Button>
              <Button type="button" size="sm" variant={mode === 'time' ? 'secondary' : 'ghost'} onClick={() => setMode('time')}>
                По времени
              </Button>
            </div>
            {mode === 'lessons' ? (
              <Chips
                options={Array.from({ length: lessons }, (_, i) => {
                  const t = times.find((x) => x.lessonNumber === i + 1);
                  return { value: i + 1, label: t ? `${i + 1} пара · ${t.startTime}–${t.endTime}` : `${i + 1} пара` };
                })}
                value={form.lessonNumbers}
                onChange={(lessonNumbers) => set({ lessonNumbers: [...lessonNumbers].sort((a, b) => a - b) })}
              />
            ) : (
              <div className="flex items-center gap-2">
                <Input type="time" className="w-32" value={form.timeFrom ?? ''} onChange={(e) => set({ timeFrom: e.target.value || null })} />
                <span>—</span>
                <Input type="time" className="w-32" value={form.timeTo ?? ''} onChange={(e) => set({ timeTo: e.target.value || null })} />
              </div>
            )}
            <p className="text-muted-foreground text-xs">
              {mode === 'lessons'
                ? 'Не выбрано — все пары дня'
                : form.kind === 'AVAILABLE_ONLY'
                  ? 'Подходят пары, целиком входящие в интервал'
                  : 'Правило действует на пары, пересекающиеся с интервалом'}
            </p>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Действует с">
              <Input type="date" value={form.validFrom ?? ''} onChange={(e) => set({ validFrom: e.target.value || null })} />
            </Field>
            <Field label="Действует по">
              <Input type="date" value={form.validTo ?? ''} onChange={(e) => set({ validTo: e.target.value || null })} />
            </Field>
          </div>
          {(form.kind === 'PREFERRED' || form.kind === 'UNDESIRED') && (
            <Field label={`Сила предпочтения: ${form.weight} из 10`}>
              <input type="range" min={1} max={10} value={form.weight} onChange={(e) => set({ weight: Number(e.target.value) })} />
            </Field>
          )}
          <Field label="Комментарий">
            <Input value={form.note ?? ''} placeholder="Например: работа в другой организации" onChange={(e) => set({ note: e.target.value })} />
          </Field>
          <div className="bg-muted/50 rounded-lg border p-3 text-sm">
            {previewError ? (
              <span className="text-destructive">{previewError}</span>
            ) : preview ? (
              <>
                <div className="font-medium">{preview.description}</div>
                <div className="text-muted-foreground mt-1 text-xs">Ближайшие даты:</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {preview.dates.length === 0 && <span className="text-muted-foreground text-xs">нет совпадений в ближайший год</span>}
                  {preview.dates.map((d) => (
                    <Badge key={d.date} variant="outline">
                      {formatDate(d.date)} · {d.lessons.length === lessons ? 'весь день' : `пары ${d.lessons.join(', ')}`}
                    </Badge>
                  ))}
                </div>
              </>
            ) : (
              <Spinner />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={() => save.mutate(undefined)} disabled={save.isPending || !!previewError}>
            {save.isPending && <Spinner />} Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Гибкие правила доступности преподавателя: недели месяца, чётность, время, онлайн */
export function AvailabilityRules({ teacherId, editable }: { teacherId: string; editable: boolean }) {
  const rules = useApi<AvailabilityRule[]>(['availability-rules', teacherId], `/teachers/${teacherId}/availability-rules`);
  const [dialog, setDialog] = useState<{ rule: AvailabilityRule | null; initial: Partial<RuleForm> | null } | null>(null);
  const remove = useApiMutation((id: string) => api.delete(`/teachers/${teacherId}/availability-rules/${id}`), {
    success: 'Правило удалено',
    invalidate: [['availability-rules', teacherId]],
  });
  const list = rules.data ?? [];
  return (
    <div className="space-y-3">
      {list.length === 0 && !rules.isLoading && (
        <EmptyState
          title="Правил пока нет"
          description="Правила дополняют сетку: «последняя суббота месяца», «первая неделя месяца — онлайн», «только до 14:00», чётные/нечётные недели, период действия."
        />
      )}
      <div className="space-y-2">
        {list.map((r) => (
          <div key={r.id} className="flex items-start gap-3 rounded-lg border p-3">
            {r.kind === 'ONLINE' ? <Laptop className="mt-0.5 size-4 text-violet-600" /> : <CalendarClock className="text-muted-foreground mt-0.5 size-4" />}
            <div className="min-w-0 flex-1">
              <Badge variant={KIND[r.kind].variant} className="mb-1">
                {KIND[r.kind].label}
              </Badge>
              <div className="text-sm">{r.description}</div>
            </div>
            {editable && (
              <div className="flex gap-1">
                <Button variant="ghost" size="icon-sm" aria-label="Изменить правило" onClick={() => setDialog({ rule: r, initial: null })}>
                  <Pencil />
                </Button>
                <Confirm
                  trigger={
                    <Button variant="ghost" size="icon-sm" aria-label="Удалить правило">
                      <Trash2 />
                    </Button>
                  }
                  title="Удалить правило?"
                  description={r.description}
                  destructive
                  confirmText="Удалить"
                  onConfirm={() => remove.mutate(r.id)}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      {editable && (
        <div className="space-y-2">
          <Button onClick={() => setDialog({ rule: null, initial: null })}>
            <Plus /> Добавить правило
          </Button>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground text-xs">Быстро:</span>
            {PRESETS.map((p) => (
              <Button key={p.title} variant="outline" size="sm" className="h-7 text-xs" onClick={() => setDialog({ rule: null, initial: p.form })}>
                {p.title}
              </Button>
            ))}
          </div>
        </div>
      )}
      <RuleDialog
        teacherId={teacherId}
        rule={dialog?.rule ?? null}
        initial={dialog?.initial ?? null}
        open={!!dialog}
        onOpenChange={(o) => !o && setDialog(null)}
      />
    </div>
  );
}
