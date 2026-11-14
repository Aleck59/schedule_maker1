import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, ChevronRight, CircleSlash, Users } from 'lucide-react';
import { LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/format';
import { EDUCATION_LEVEL_LABELS, STUDY_FORM_LABELS } from '@/lib/labels';
import type { AllGroupsPlan, AllGroupsPlanRow } from '@/lib/types';
import { cn } from '@/lib/utils';

export type LevelFilter = 'ALL' | 'SPO' | 'HIGHER';

export const LEVEL_FILTER_OPTIONS: Array<{ value: LevelFilter; label: string }> = [
  { value: 'ALL', label: 'СПО и ВО' },
  { value: 'SPO', label: 'Только СПО' },
  { value: 'HIGHER', label: 'Только ВО' },
];

export function levelsOf(filter: LevelFilter): string[] | undefined {
  if (filter === 'SPO') return ['SPO'];
  if (filter === 'HIGHER') return ['BACHELOR', 'SPECIALIST', 'MASTER', 'POSTGRADUATE'];
  return undefined;
}

export function filterPlan<T extends { educationLevel: string }>(rows: T[], filter: LevelFilter): T[] {
  const levels = levelsOf(filter);
  return levels ? rows.filter((r) => levels.includes(r.educationLevel)) : rows;
}

/** Сколько групп каждого уровня войдёт в расписание: СПО, бакалавриат, магистратура… */
export function levelCounts(rows: AllGroupsPlanRow[]): Array<{ level: string; count: number }> {
  const order = ['SPO', 'BACHELOR', 'SPECIALIST', 'MASTER', 'POSTGRADUATE'];
  const map = new Map<string, number>();
  for (const r of rows) if (r.included) map.set(r.educationLevel, (map.get(r.educationLevel) ?? 0) + 1);
  return [...map].map(([level, count]) => ({ level, count })).sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
}

/** Что войдёт в расписание для всех групп: периоды (семестры учебных планов) и группы, а также пропущенные группы */
export function AllGroupsPlanCard({ plan, filter, loading }: { plan?: AllGroupsPlan; filter: LevelFilter; loading: boolean }) {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => filterPlan(plan?.groups ?? [], filter), [plan, filter]);
  const byPeriod = useMemo(() => {
    const map = new Map<string, AllGroupsPlanRow[]>();
    for (const r of rows.filter((x) => x.included)) {
      const key = r.semesterId!;
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return [...map.values()];
  }, [rows]);
  const skipped = rows.filter((r) => !r.included);
  const newPeriods = byPeriod.filter((g) => g[0].createPeriod).length;
  const levels = levelCounts(rows);
  const noGroups = useMemo(() => filterPlan(plan?.programsWithoutGroups ?? [], filter), [plan, filter]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4" /> Что будет составлено
        </CardTitle>
        <CardDescription>
          Текущий семестр каждой активной группы{plan ? ` на ${formatDate(plan.date)}` : ''}; преподаватели и аудитории без накладок между
          планами
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && <LoadingState rows={3} />}
        {plan && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">Групп: {rows.filter((r) => r.included).length}</Badge>
            <Badge variant="secondary">Семестров (периодов): {byPeriod.length}</Badge>
            {newPeriods > 0 && <Badge variant="info">Новых периодов: {newPeriods}</Badge>}
            {skipped.length > 0 && <Badge variant="muted">Пропущено групп: {skipped.length}</Badge>}
            {levels.length > 1 &&
              levels.map((l) => (
                <Badge key={l.level} variant={l.level === 'SPO' ? 'outline' : 'violet'}>
                  {EDUCATION_LEVEL_LABELS[l.level]}: {l.count}
                </Badge>
              ))}
          </div>
        )}
        {noGroups.length > 0 && (
          <div className="rounded-md border border-dashed border-amber-300 bg-amber-50/60 p-2.5 dark:border-amber-800 dark:bg-amber-950/20">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
              <CircleSlash className="size-3.5" /> Учебные планы без групп: {noGroups.length} — расписание для них не составится
            </div>
            <ul className="space-y-0.5">
              {noGroups.map((p) => (
                <li key={p.programId} className="text-xs">
                  <Link to={`/programs/${p.programId}`} className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                    {p.programTitle}
                  </Link>{' '}
                  <span className="text-muted-foreground">
                    · {EDUCATION_LEVEL_LABELS[p.educationLevel]}, {STUDY_FORM_LABELS[p.studyForm]?.toLowerCase()} — добавьте группу
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {byPeriod.length > 0 && (
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setOpen(!open)}>
            <ChevronRight className={cn('transition-transform', open && 'rotate-90')} />
            {open ? 'Скрыть состав' : `Показать состав: ${byPeriod.length} учебных планов`}
          </Button>
        )}
        {open && (
        <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1 scrollbar-thin">
          {byPeriod.map((list) => {
            const r = list[0];
            return (
              <div key={r.semesterId} className="rounded-md border p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium" title={r.periodTitle ?? ''}>
                      {r.periodTitle}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {EDUCATION_LEVEL_LABELS[r.educationLevel]} · {STUDY_FORM_LABELS[r.studyForm]?.toLowerCase()} · {r.semesterNumber} семестр
                      {r.semesterStart && ` · ${formatDate(r.semesterStart)} — ${formatDate(r.semesterEnd!)}`}
                    </div>
                  </div>
                  {r.createPeriod && (
                    <Badge variant="info" className="shrink-0" title="Период расписания будет создан автоматически">
                      <CalendarPlus /> новый
                    </Badge>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {list.map((g) => (
                    <Badge key={g.groupId} variant="outline" title={g.reason ?? undefined}>
                      {g.groupCode}
                      {g.reason ? ' *' : ''}
                    </Badge>
                  ))}
                </div>
              </div>
            );
          })}
          {skipped.length > 0 && (
            <div className="rounded-md border border-dashed p-2.5">
              <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs font-medium">
                <CircleSlash className="size-3.5" /> Не войдут в расписание
              </div>
              {skipped.map((g) => (
                <div key={g.groupId} className="text-xs">
                  <span className="font-medium">{g.groupCode}</span> — {g.reason}
                </div>
              ))}
            </div>
          )}
        </div>
        )}
        {plan && rows.length === 0 && noGroups.length === 0 && <div className="text-muted-foreground text-sm">Нет активных групп</div>}
      </CardContent>
    </Card>
  );
}
