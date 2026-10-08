import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download, TriangleAlert } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PageHeader } from '@/components/common/page-header';
import { SimpleSelect } from '@/components/common/simple-select';
import { ErrorState, LoadingState } from '@/components/common/states';
import { StatCard } from '@/components/common/stat-card';
import { HourStatusBadge } from '@/components/common/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useGroups, usePrograms, useSemesters, useTeachers } from '@/hooks/use-reference';
import { downloadFile, errorMessage } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { CONTROL_FORM_LABELS, HOUR_STATUS_LABELS, LESSON_TYPE_LABELS } from '@/lib/labels';
import { useApi } from '@/lib/query';
import type { HourControlResponse, HourControlRow, HourStatus, StreamHours } from '@/lib/types';
import { cn } from '@/lib/utils';

type AggregateBy = 'group' | 'discipline' | 'teacher' | 'semester' | 'program' | 'college';

interface AggregateResponse {
  by: AggregateBy;
  today: string;
  items: Array<{
    key: string;
    label: string;
    rows: number;
    total: StreamHours;
    byStatus: Record<HourStatus, number>;
    completionPercent: number;
    forecastPercent: number;
  }>;
}

const AGGREGATES: Array<[AggregateBy, string]> = [
  ['group', 'Группы'],
  ['discipline', 'Дисциплины'],
  ['teacher', 'Преподаватели'],
  ['semester', 'Семестры'],
  ['program', 'Образовательные программы'],
  ['college', 'Колледж'],
];

export default function HourControlPage() {
  const [params, setParams] = useSearchParams();
  const programs = usePrograms();
  const semesters = useSemesters();
  const groups = useGroups();
  const teachers = useTeachers();
  const programId = params.get('programId');
  const semesterId = params.get('semesterId');
  const groupId = params.get('groupId');
  const teacherId = params.get('teacherId');
  const [status, setStatus] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [by, setBy] = useState<AggregateBy>('group');

  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k === 'programId') {
      next.delete('semesterId');
      next.delete('groupId');
    }
    setParams(next, { replace: true });
  };

  const query = { programId: programId ?? undefined, semesterId: semesterId ?? undefined, groupId: groupId ?? undefined, teacherId: teacherId ?? undefined };
  const data = useApi<HourControlResponse>(['hour-control', query], '/hour-control', query);
  const aggregate = useApi<AggregateResponse>(['hour-control', 'summary', by, programId, semesterId], '/hour-control/summary', {
    by,
    programId: programId ?? undefined,
    semesterId: semesterId ?? undefined,
  });

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data.data?.rows ?? []).filter(
      (r) =>
        (!status || r.status === status) &&
        (!s || `${r.groupCode} ${r.itemCode} ${r.itemName} ${r.teachers.map((t) => t.name).join(' ')}`.toLowerCase().includes(s)),
    );
  }, [data.data, status, search]);

  const exportExcel = async () => {
    const pid = programId ?? programs.data?.[0]?.id;
    if (!pid) return;
    try {
      await downloadFile(`/programs/${pid}/export/hour-control/excel`, { semesterId: semesterId ?? undefined }, 'Выполнение_часов.xlsx');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const sum = data.data?.summary;
  const programSemesters = (semesters.data ?? []).filter((s) => !programId || s.educationalProgramId === programId);
  const programGroups = (groups.data ?? []).filter((g) => !programId || g.educationalProgramId === programId);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Контроль выполнения часов"
        description="План / в расписании / проведено / осталось — по видам занятий, с прогнозом выполнения к концу семестра"
        actions={
          <Button variant="outline" onClick={exportExcel}>
            <Download /> Excel
          </Button>
        }
      />
      <Card className="py-3">
        <CardContent className="grid gap-2 px-3 sm:grid-cols-2 xl:grid-cols-5">
          <SimpleSelect
            value={programId}
            onChange={(v) => set('programId', v)}
            allowEmpty
            emptyLabel="Все программы"
            options={(programs.data ?? []).map((p) => ({ value: p.id, label: p.title }))}
          />
          <SimpleSelect
            value={semesterId}
            onChange={(v) => set('semesterId', v)}
            allowEmpty
            emptyLabel="Все семестры"
            options={programSemesters.map((s) => ({ value: s.id, label: `${s.program?.title ?? ''} · ${s.number} семестр` }))}
          />
          <SimpleSelect
            value={groupId}
            onChange={(v) => set('groupId', v)}
            allowEmpty
            emptyLabel="Все группы"
            options={programGroups.map((g) => ({ value: g.id, label: g.code }))}
          />
          <SimpleSelect
            value={teacherId}
            onChange={(v) => set('teacherId', v)}
            allowEmpty
            emptyLabel="Все преподаватели"
            options={(teachers.data ?? []).map((t) => ({ value: t.id, label: t.fullName }))}
          />
          <SimpleSelect
            value={status}
            onChange={setStatus}
            allowEmpty
            emptyLabel="Любой статус"
            options={Object.entries(HOUR_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </CardContent>
      </Card>

      {data.isLoading ? (
        <LoadingState rows={8} />
      ) : data.error ? (
        <ErrorState error={data.error} onRetry={() => data.refetch()} />
      ) : (
        sum && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <StatCard title="По плану" value={`${sum.total.planned} ч`} hint={`Строк: ${sum.rows}`} />
              <StatCard title="В расписании" value={`${sum.total.scheduled} ч`} tone="info" />
              <StatCard
                title="Проведено"
                value={`${sum.total.conducted} ч`}
                hint={`${formatNumber(sum.completionPercent, 1)}% от плана`}
                tone="success"
              />
              <StatCard title="Осталось провести" value={`${sum.total.remaining} ч`} />
              <StatCard
                title="Дефицит в расписании"
                value={`${sum.total.scheduleDeficit} ч`}
                hint={`Прогноз выполнения: ${formatNumber(sum.forecastPercent, 1)}%`}
                tone={sum.total.scheduleDeficit ? 'danger' : 'success'}
              />
              <StatCard title="Превышение" value={`${sum.total.excess} ч`} tone={sum.total.excess ? 'warning' : 'success'} />
            </div>
            <div className="flex flex-wrap gap-2">
              {(Object.entries(sum.byStatus) as Array<[HourStatus, number]>).map(([k, v]) => (
                <button key={k} type="button" onClick={() => setStatus(status === k ? null : k)}>
                  <Badge variant={status === k ? 'default' : 'secondary'} className="h-7 cursor-pointer px-3">
                    {HOUR_STATUS_LABELS[k]}: {v}
                  </Badge>
                </button>
              ))}
            </div>
          </>
        )
      )}

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">По дисциплинам</TabsTrigger>
          <TabsTrigger value="aggregate">Сводка по разрезам</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="space-y-3">
          <Input placeholder="Поиск по группе, дисциплине, преподавателю…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-md" />
          <HoursTable rows={rows} />
        </TabsContent>
        <TabsContent value="aggregate" className="space-y-3">
          <div className="w-72">
            <SimpleSelect value={by} onChange={(v) => setBy((v as AggregateBy) ?? 'group')} options={AGGREGATES.map(([value, label]) => ({ value, label }))} />
          </div>
          {aggregate.isLoading ? (
            <LoadingState rows={5} />
          ) : aggregate.error ? (
            <ErrorState error={aggregate.error} />
          ) : (
            <AggregateView data={aggregate.data!} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function HoursTable({ rows }: { rows: HourControlRow[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(100);
  if (rows.length === 0) {
    return <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">Нет данных по выбранным фильтрам</div>;
  }
  return (
    <div className="bg-card overflow-x-auto rounded-lg border scrollbar-thin">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>Группа</TableHead>
            <TableHead>Сем.</TableHead>
            <TableHead>Дисциплина</TableHead>
            <TableHead>Контроль</TableHead>
            <TableHead className="text-right">План</TableHead>
            <TableHead className="text-right">В расп.</TableHead>
            <TableHead className="text-right">Проведено</TableHead>
            <TableHead className="text-right">Осталось</TableHead>
            <TableHead className="text-right">Дефицит</TableHead>
            <TableHead className="text-right">Превыш.</TableHead>
            <TableHead className="w-36">Выполнение</TableHead>
            <TableHead>Статус</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, limit).map((r) => {
            const expanded = open.has(r.key);
            return (
              <Fragment key={r.key}>
                <TableRow
                  className="cursor-pointer"
                  onClick={() =>
                    setOpen((s) => {
                      const n = new Set(s);
                      if (n.has(r.key)) n.delete(r.key);
                      else n.add(r.key);
                      return n;
                    })
                  }
                >
                  <TableCell>{expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</TableCell>
                  <TableCell className="font-medium whitespace-nowrap">
                    {r.groupCode}
                    {r.subgroupNumber ? <span className="text-muted-foreground"> п/г {r.subgroupNumber}</span> : null}
                  </TableCell>
                  <TableCell>{r.semesterNumber}</TableCell>
                  <TableCell className="max-w-80">
                    <div className="truncate">
                      {r.itemCode} {r.itemName}
                    </div>
                    {r.unassigned && (
                      <div className="flex items-center gap-1 text-xs text-amber-600">
                        <TriangleAlert className="size-3" /> не назначен преподаватель
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{CONTROL_FORM_LABELS[r.controlForm]}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.total.planned}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.total.scheduled}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.total.conducted}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.total.remaining}</TableCell>
                  <TableCell className={cn('text-right tabular-nums', r.total.scheduleDeficit > 0 && 'font-semibold text-red-600')}>
                    {r.total.scheduleDeficit}
                  </TableCell>
                  <TableCell className={cn('text-right tabular-nums', r.total.excess > 0 && 'font-semibold text-violet-600')}>
                    {r.total.excess}
                  </TableCell>
                  <TableCell>
                    <Progress value={r.completionPercent} className="h-1.5" />
                    <div className="text-muted-foreground mt-0.5 text-[11px]">
                      {formatNumber(r.completionPercent, 1)}% · ожидается {r.expectedByNow} ч
                    </div>
                  </TableCell>
                  <TableCell>
                    <HourStatusBadge status={r.status} />
                  </TableCell>
                </TableRow>
                {expanded && (
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableCell />
                    <TableCell colSpan={12}>
                      <TypeBreakdown row={r} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
      {rows.length > limit && (
        <div className="border-t p-2 text-center">
          <Button variant="ghost" size="sm" onClick={() => setLimit(limit + 200)}>
            Показать ещё ({rows.length - limit})
          </Button>
        </div>
      )}
    </div>
  );
}

function TypeBreakdown({ row }: { row: HourControlRow }) {
  const types = Object.entries(row.byType) as Array<[string, StreamHours]>;
  return (
    <table className="w-full text-xs">
      <thead className="text-muted-foreground">
        <tr>
          <th className="py-1 text-left font-medium">Вид занятий</th>
          <th className="py-1 text-left font-medium">Преподаватель</th>
          <th className="py-1 text-right font-medium">План</th>
          <th className="py-1 text-right font-medium">В расписании</th>
          <th className="py-1 text-right font-medium">Проведено</th>
          <th className="py-1 text-right font-medium">Осталось</th>
          <th className="py-1 text-right font-medium">Дефицит</th>
          <th className="py-1 text-right font-medium">Превышение</th>
          <th className="py-1 text-right font-medium">Будущие</th>
          <th className="py-1 text-right font-medium">Не отмечено</th>
          <th className="py-1 text-right font-medium">Отменено</th>
          <th className="py-1 text-right font-medium">Прогноз</th>
        </tr>
      </thead>
      <tbody>
        {types.map(([type, h]) => (
          <tr key={type} className="border-t">
            <td className="py-1">{LESSON_TYPE_LABELS[type]}</td>
            <td className="py-1">
              {row.teachers
                .filter((t) => t.lessonType === type)
                .map((t) => t.name ?? '—')
                .join(', ') || '—'}
            </td>
            <td className="py-1 text-right tabular-nums">{h.planned}</td>
            <td className="py-1 text-right tabular-nums">{h.scheduled}</td>
            <td className="py-1 text-right tabular-nums">{h.conducted}</td>
            <td className="py-1 text-right tabular-nums">{h.remaining}</td>
            <td className={cn('py-1 text-right tabular-nums', h.scheduleDeficit > 0 && 'font-semibold text-red-600')}>{h.scheduleDeficit}</td>
            <td className={cn('py-1 text-right tabular-nums', h.excess > 0 && 'font-semibold text-violet-600')}>
              {h.excess}
              {h.excessApproved && h.excess > 0 ? ' (разрешено)' : ''}
            </td>
            <td className="py-1 text-right tabular-nums">{h.future}</td>
            <td className={cn('py-1 text-right tabular-nums', h.unmarkedPast > 0 && 'text-amber-600')}>{h.unmarkedPast}</td>
            <td className="py-1 text-right tabular-nums">{h.cancelled}</td>
            <td className={cn('py-1 text-right tabular-nums', h.forecastDeficit > 0 && 'text-red-600')}>
              {h.forecast}
              {h.forecastDeficit > 0 ? ` (−${h.forecastDeficit})` : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AggregateView({ data }: { data: AggregateResponse }) {
  const chart = data.items.slice(0, 30).map((i) => ({
    name: i.label.length > 22 ? `${i.label.slice(0, 22)}…` : i.label,
    План: i.total.planned,
    'В расписании': i.total.scheduled,
    Проведено: i.total.conducted,
  }));
  return (
    <div className="space-y-4">
      {data.items.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Часы по разрезу</CardTitle>
            <CardDescription>План, запланировано в расписании и фактически проведено</CardDescription>
          </CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer>
              <BarChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
                <YAxis tickLine={false} axisLine={false} width={40} />
                <Tooltip />
                <Legend />
                <Bar dataKey="План" fill="#94a3b8" radius={[3, 3, 0, 0]} />
                <Bar dataKey="В расписании" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Проведено" fill="#10b981" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
      <div className="bg-card overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Наименование</TableHead>
              <TableHead className="text-right">Строк</TableHead>
              <TableHead className="text-right">План</TableHead>
              <TableHead className="text-right">В расп.</TableHead>
              <TableHead className="text-right">Проведено</TableHead>
              <TableHead className="text-right">Осталось</TableHead>
              <TableHead className="text-right">Дефицит</TableHead>
              <TableHead className="text-right">Превыш.</TableHead>
              <TableHead className="w-40">Выполнение / прогноз</TableHead>
              <TableHead>Статусы</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((i) => (
              <TableRow key={i.key}>
                <TableCell className="font-medium">{i.label}</TableCell>
                <TableCell className="text-right tabular-nums">{i.rows}</TableCell>
                <TableCell className="text-right tabular-nums">{i.total.planned}</TableCell>
                <TableCell className="text-right tabular-nums">{i.total.scheduled}</TableCell>
                <TableCell className="text-right tabular-nums">{i.total.conducted}</TableCell>
                <TableCell className="text-right tabular-nums">{i.total.remaining}</TableCell>
                <TableCell className={cn('text-right tabular-nums', i.total.scheduleDeficit > 0 && 'text-red-600')}>{i.total.scheduleDeficit}</TableCell>
                <TableCell className={cn('text-right tabular-nums', i.total.excess > 0 && 'text-violet-600')}>{i.total.excess}</TableCell>
                <TableCell>
                  <Progress value={i.completionPercent} className="h-1.5" />
                  <div className="text-muted-foreground mt-0.5 text-[11px]">
                    {formatNumber(i.completionPercent, 1)}% / {formatNumber(i.forecastPercent, 1)}%
                  </div>
                </TableCell>
                <TableCell className="space-x-1 whitespace-nowrap">
                  {(Object.entries(i.byStatus) as Array<[HourStatus, number]>)
                    .filter(([, v]) => v > 0)
                    .map(([k, v]) => (
                      <HourStatusBadgeCount key={k} status={k} count={v} />
                    ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function HourStatusBadgeCount({ status, count }: { status: HourStatus; count: number }) {
  const variant = { NORMAL: 'success', RISK: 'warning', DEFICIT: 'destructive', EXCESS: 'violet' } as const;
  return (
    <Badge variant={variant[status]}>
      {HOUR_STATUS_LABELS[status]} {count}
    </Badge>
  );
}
