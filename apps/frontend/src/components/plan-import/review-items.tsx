import { Fragment, useMemo, useState } from 'react';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { SimpleSelect } from '@/components/common/simple-select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CONTROL_FORM_LABELS } from '@/lib/labels';
import type { ControlForm } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  HOUR_FIELDS,
  KIND_LABELS,
  PRACTICE_KINDS,
  type CellFlag,
  type Draft,
  type DraftItem,
  type DraftItemSemester,
  type HourField,
  type ScanItemKind,
} from './types';

const HOUR_LABELS: Record<HourField, string> = {
  total: 'Всего',
  lecture: 'Лек',
  laboratory: 'Лаб',
  practical: 'Пр',
  seminar: 'Сем',
  individualProject: 'ИП',
  selfStudy: 'СР',
  assessment: 'Контр.',
};
const HOUR_HINTS: Record<HourField, string> = {
  total: 'Всего часов в семестре',
  lecture: 'Лекции — ставятся в расписание',
  laboratory: 'Лабораторные — ставятся в расписание (часто по подгруппам)',
  practical: 'Практические занятия — ставятся в расписание',
  seminar: 'Семинары — ставятся в расписание как практические занятия',
  individualProject: 'Индивидуальный проект — самостоятельная работа',
  selfStudy: 'Самостоятельная работа — в расписание не ставится',
  assessment: 'Часы промежуточной аттестации — в расписание не ставятся',
};

/** Сумма часов не сходится с «Всего» (для дисциплин и МДК) */
export function sumMismatch(kind: ScanItemKind, s: DraftItemSemester): number | null {
  if (PRACTICE_KINDS.includes(kind) || kind === 'MODULE' || kind === 'GROUP') return null;
  const h = s.hours;
  const sum = HOUR_FIELDS.filter((f) => f !== 'total').reduce((acc, f) => acc + (h[f] ?? 0), 0);
  return sum === (h.total ?? 0) ? null : sum;
}

function HourCell({
  value,
  flag,
  disabled,
  onChange,
}: {
  value: number | undefined;
  flag?: CellFlag;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const input = (
    <Input
      type="number"
      min={0}
      inputMode="numeric"
      disabled={disabled}
      value={value ? String(value) : ''}
      placeholder="—"
      onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value) || 0)))}
      className={cn(
        'h-7 w-14 px-1.5 text-right tabular-nums',
        flag?.status === 'corrected' && 'border-amber-400 bg-amber-50 dark:bg-amber-950/40',
        flag?.status === 'uncertain' && 'border-red-400 bg-red-50 dark:bg-red-950/40',
      )}
    />
  );
  if (!flag) return input;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{input}</TooltipTrigger>
      <TooltipContent className="max-w-sm">
        <div className="font-medium">
          {flag.status === 'corrected' ? 'Исправлено по сумме часов' : 'Проверьте по скану'}: прочитано «{flag.read || '—'}»
        </div>
        {flag.crop && <img src={flag.crop} alt="Фрагмент скана" className="mt-1 max-h-24 rounded bg-white" />}
      </TooltipContent>
    </Tooltip>
  );
}

/** Шаг 3: дисциплины, МДК, практики — часы по семестрам и формы контроля */
export function ReviewItems({ draft, onChange }: { draft: Draft; onChange: (draft: Draft) => void }) {
  const [semester, setSemester] = useState<string | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [search, setSearch] = useState('');
  const modules = draft.items.filter((i) => i.kind === 'MODULE').map((i) => i.code);

  const updateItem = (index: number, patch: Partial<DraftItem>) =>
    onChange({ ...draft, items: draft.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) });
  const updateSemester = (index: number, number: number, patch: Partial<DraftItemSemester>) =>
    updateItem(index, {
      semesters: draft.items[index].semesters.map((s) => (s.number === number ? { ...s, ...patch } : s)),
    });

  const flagged = (item: DraftItem) =>
    (item.issues?.length ?? 0) > 0 ||
    item.semesters.some((s) => Object.keys(s.cells ?? {}).length > 0 || sumMismatch(item.kind, s) !== null);

  const rows = useMemo(
    () =>
      draft.items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => !semester || item.semesters.some((s) => String(s.number) === semester))
        .filter(({ item }) => !onlyIssues || flagged(item))
        .filter(
          ({ item }) =>
            !search.trim() ||
            `${item.code} ${item.name}`.toLowerCase().includes(search.trim().toLowerCase()),
        ),
    [draft.items, semester, onlyIssues, search],
  );
  const issuesTotal = draft.items.filter(flagged).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Дисциплины, МДК и практики</CardTitle>
        <CardDescription>
          Часы по семестрам из плана. <span className="rounded bg-amber-100 px-1 dark:bg-amber-900/40">Жёлтым</span> — значение
          исправлено автоматически по суммам часов, <span className="rounded bg-red-100 px-1 dark:bg-red-900/40">красным</span> —
          проверьте по скану (фрагмент — при наведении). Строки-разделы и экзамены по модулю не создаются отдельными дисциплинами.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Input placeholder="Поиск по индексу или названию" className="w-64" value={search} onChange={(e) => setSearch(e.target.value)} />
          <SimpleSelect
            className="w-44"
            value={semester}
            allowEmpty
            emptyLabel="Все семестры"
            onChange={setSemester}
            options={draft.semesters.map((s) => ({ value: String(s.number), label: `${s.number} семестр` }))}
          />
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={onlyIssues} onCheckedChange={setOnlyIssues} />
            Только требующие проверки
          </label>
          {issuesTotal > 0 ? (
            <Badge variant="warning" className="h-7">
              <TriangleAlert /> Требуют внимания: {issuesTotal}
            </Badge>
          ) : (
            <Badge variant="success" className="h-7">
              <CircleCheck /> Суммы часов сходятся
            </Badge>
          )}
        </div>
        <div className="overflow-x-auto scrollbar-thin">
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="min-w-28">Индекс</TableHead>
                <TableHead className="min-w-56">Наименование</TableHead>
                <TableHead className="min-w-36">Вид</TableHead>
                <TableHead>Сем.</TableHead>
                <TableHead className="min-w-36">Контроль</TableHead>
                {HOUR_FIELDS.map((f) => (
                  <TableHead key={f} title={HOUR_HINTS[f]} className="text-right">
                    {HOUR_LABELS[f]}
                  </TableHead>
                ))}
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ item, index }) => {
                const sems = item.semesters.filter((s) => !semester || String(s.number) === semester);
                const span = Math.max(1, sems.length);
                const off = !item.include;
                const aggregate = item.kind === 'MODULE' || item.kind === 'GROUP';
                const first = (
                  <>
                    <TableCell rowSpan={span} className="align-top">
                      <Checkbox
                        checked={item.include}
                        onCheckedChange={(v) => updateItem(index, { include: v === true })}
                        aria-label="Импортировать"
                      />
                    </TableCell>
                    <TableCell rowSpan={span} className="align-top">
                      <Input className="h-7 w-28" value={item.code} onChange={(e) => updateItem(index, { code: e.target.value })} />
                    </TableCell>
                    <TableCell rowSpan={span} className="align-top">
                      <Input className="h-7" value={item.name} onChange={(e) => updateItem(index, { name: e.target.value })} />
                      {item.issues?.map((issue) => (
                        <div key={issue} className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                          {issue}
                        </div>
                      ))}
                      {aggregate && (
                        <div className="text-muted-foreground mt-1 text-[11px]">
                          {item.kind === 'MODULE'
                            ? 'Часы модуля — сумма МДК и практик, отдельно не импортируются'
                            : 'Раздел станет циклом учебного плана'}
                        </div>
                      )}
                    </TableCell>
                    <TableCell rowSpan={span} className="align-top">
                      <SimpleSelect
                        size="sm"
                        className="h-7 w-36"
                        value={item.kind}
                        onChange={(v) => updateItem(index, { kind: (v ?? 'DISCIPLINE') as ScanItemKind })}
                        options={Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))}
                      />
                      {(item.kind === 'INTERDISCIPLINARY_COURSE' || PRACTICE_KINDS.includes(item.kind) || item.kind === 'MODULE_EXAM') &&
                        modules.length > 0 && (
                          <SimpleSelect
                            size="sm"
                            className="mt-1 h-7 w-36"
                            value={item.parentCode}
                            allowEmpty
                            emptyLabel="Без модуля"
                            onChange={(v) => updateItem(index, { parentCode: v })}
                            options={modules.map((m) => ({ value: m, label: m }))}
                          />
                        )}
                    </TableCell>
                  </>
                );
                if (!sems.length) {
                  return (
                    <TableRow key={`${index}`} className={cn(off && 'opacity-50')}>
                      {first}
                      <TableCell colSpan={HOUR_FIELDS.length + 3} className="text-muted-foreground">
                        Нет часов по семестрам
                      </TableCell>
                    </TableRow>
                  );
                }
                return (
                  <Fragment key={`${index}`}>
                    {sems.map((s, k) => {
                      const mismatch = sumMismatch(item.kind, s);
                      const practice = PRACTICE_KINDS.includes(item.kind);
                      return (
                        <TableRow key={s.number} className={cn(off && 'opacity-50', aggregate && 'bg-muted/40')}>
                          {k === 0 && first}
                          <TableCell className="font-medium">{s.number}</TableCell>
                          <TableCell>
                            <SimpleSelect
                              size="sm"
                              className="h-7 w-36"
                              value={s.controlForm}
                              onChange={(v) => updateSemester(index, s.number, { controlForm: (v ?? 'NONE') as ControlForm })}
                              options={Object.entries(CONTROL_FORM_LABELS).map(([value, label]) => ({ value, label }))}
                            />
                            {practice && (
                              <label className="mt-1 flex items-center gap-1.5 text-[11px]">
                                <Switch
                                  checked={s.practiceAtCollege ?? false}
                                  onCheckedChange={(v) => updateSemester(index, s.number, { practiceAtCollege: v })}
                                />
                                в колледже (в расписание)
                              </label>
                            )}
                          </TableCell>
                          {HOUR_FIELDS.map((f) => (
                            <TableCell key={f} className="px-1 py-1">
                              <HourCell
                                value={s.hours[f]}
                                flag={s.cells?.[f]}
                                disabled={off || (practice && f !== 'total')}
                                onChange={(v) => updateSemester(index, s.number, { hours: { ...s.hours, [f]: v } })}
                              />
                            </TableCell>
                          ))}
                          <TableCell>
                            {mismatch !== null && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <TriangleAlert className="size-4 text-amber-600" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  Сумма видов работ {mismatch} ч не равна «Всего» {s.hours.total} ч
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {rows.length === 0 && <div className="text-muted-foreground py-6 text-center text-sm">Нет строк по выбранным условиям</div>}
      </CardContent>
    </Card>
  );
}

export function itemsErrors(draft: Draft): string[] {
  const errors: string[] = [];
  const included = draft.items.filter((i) => i.include);
  const seen = new Set<string>();
  for (const item of included) {
    if (!item.code.trim() || !item.name.trim()) errors.push('У всех строк должны быть индекс и наименование');
    if (seen.has(item.code.trim())) errors.push(`Индекс ${item.code} встречается несколько раз`);
    seen.add(item.code.trim());
  }
  if (!included.some((i) => i.kind !== 'GROUP' && i.kind !== 'MODULE')) errors.push('Нет дисциплин для импорта');
  return [...new Set(errors)];
}
