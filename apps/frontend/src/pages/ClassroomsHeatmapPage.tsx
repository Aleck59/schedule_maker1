import { useMemo, useState } from 'react';
import { ArrowLeft, Flame, Gauge, Moon } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common/page-header';
import { SimpleSelect } from '@/components/common/simple-select';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { StatCard } from '@/components/common/stat-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePeriods } from '@/hooks/use-reference';
import { addDays, formatDate, isoWeekday, today, weekStart } from '@/lib/format';
import { HEAT_LEGEND_GRADIENT, heatColor, heatTextColor } from '@/lib/heat';
import { CLASSROOM_TYPE_LABELS, WEEKDAYS_SHORT } from '@/lib/labels';
import { useApi } from '@/lib/query';
import { cn } from '@/lib/utils';

interface RoomOccupancy {
  id: string;
  code: string;
  name: string;
  building: string | null;
  floor: number | null;
  capacity: number;
  classroomType: string;
  isActive: boolean;
  slotsTotal: number;
  slotsUsed: number;
  percent: number;
  grid: Record<string, number>;
  byDate: Record<string, number>;
}

interface OccupancyResponse {
  range: { from: string; to: string };
  days: string[];
  weekdays: number[];
  lessonsPerDay: number;
  weekdayCounts: Record<string, number>;
  rooms: RoomOccupancy[];
}

type View = 'slots' | 'dates';

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
type Sort = 'code' | 'load';

const RANGE_PRESETS = [
  { value: 'week', label: 'Эта неделя' },
  { value: 'month', label: '4 недели' },
  { value: 'custom', label: 'Свой период' },
];

export default function ClassroomsHeatmapPage() {
  const navigate = useNavigate();
  const periods = usePeriods();
  const start = weekStart(today());
  const [preset, setPreset] = useState<string>('month');
  const [range, setRange] = useState({ from: start, to: addDays(start, 27) });
  const [building, setBuilding] = useState<string | null>(null);
  const [view, setView] = useState<View>('slots');
  const [sort, setSort] = useState<Sort>('code');
  const [showInactive, setShowInactive] = useState(false);
  const occupancy = useApi<OccupancyResponse>(['classrooms-occupancy', range], '/classrooms/occupancy', range);
  const buildings = useApi<string[]>(['classroom-buildings'], '/classrooms/buildings');

  const periodOptions = (periods.data ?? [])
    .filter((p) => p.status !== 'ARCHIVED')
    .map((p) => ({ value: `period:${p.id}`, label: `${p.title} (${formatDate(p.startDate)} — ${formatDate(p.endDate)})` }));

  const applyPreset = (value: string | null) => {
    if (!value) return;
    setPreset(value);
    if (value === 'week') setRange({ from: start, to: addDays(start, 6) });
    else if (value === 'month') setRange({ from: start, to: addDays(start, 27) });
    else if (value.startsWith('period:')) {
      const p = periods.data?.find((x) => x.id === value.slice(7));
      if (p) setRange({ from: p.startDate.slice(0, 10), to: p.endDate.slice(0, 10) });
    }
  };

  const data = occupancy.data;
  const rooms = useMemo(() => {
    const list = (data?.rooms ?? []).filter((r) => (showInactive || r.isActive) && (!building || r.building === building));
    if (sort === 'load') return [...list].sort((a, b) => b.percent - a.percent || a.code.localeCompare(b.code, 'ru', { numeric: true }));
    return [...list].sort(
      (a, b) => (a.building ?? '').localeCompare(b.building ?? '', 'ru') || a.code.localeCompare(b.code, 'ru', { numeric: true }),
    );
  }, [data, building, sort, showInactive]);

  const stats = useMemo(() => {
    if (!rooms.length) return null;
    const used = rooms.reduce((s, r) => s + r.slotsUsed, 0);
    const total = rooms.reduce((s, r) => s + r.slotsTotal, 0);
    const top = rooms.reduce((a, b) => (b.percent > a.percent ? b : a));
    const idle = rooms.filter((r) => r.slotsUsed === 0).length;
    return { avg: total ? Math.round((used / total) * 1000) / 10 : 0, top, idle };
  }, [rooms]);

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link to="/classrooms">
          <ArrowLeft /> Аудитории
        </Link>
      </Button>
      <PageHeader
        title="Тепловая карта аудиторий"
        description="Занятость всего аудиторного фонда: чем темнее ячейка, тем чаще аудитория занята в этот слот"
      />

      <Card className="py-4">
        <CardContent className="flex flex-wrap items-end gap-3 px-4">
          <div className="grid gap-1">
            <span className="text-muted-foreground text-xs font-medium">Период</span>
            <SimpleSelect
              className="w-60"
              value={preset}
              onChange={applyPreset}
              options={[...RANGE_PRESETS, ...periodOptions]}
            />
          </div>
          <div className="grid gap-1">
            <span className="text-muted-foreground text-xs font-medium">С</span>
            <Input
              type="date"
              className="w-40"
              value={range.from}
              onChange={(e) => {
                if (!e.target.value) return;
                setPreset('custom');
                setRange((r) => ({ from: e.target.value, to: r.to < e.target.value ? e.target.value : r.to }));
              }}
            />
          </div>
          <div className="grid gap-1">
            <span className="text-muted-foreground text-xs font-medium">По</span>
            <Input
              type="date"
              className="w-40"
              value={range.to}
              min={range.from}
              onChange={(e) => {
                if (!e.target.value) return;
                setPreset('custom');
                setRange((r) => ({ ...r, to: e.target.value }));
              }}
            />
          </div>
          {(buildings.data?.length ?? 0) > 1 && (
            <div className="grid gap-1">
              <span className="text-muted-foreground text-xs font-medium">Корпус</span>
              <SimpleSelect
                className="w-44"
                value={building}
                onChange={setBuilding}
                allowEmpty
                emptyLabel="Все корпуса"
                options={(buildings.data ?? []).map((b) => ({ value: b, label: b }))}
              />
            </div>
          )}
          <div className="grid gap-1">
            <span className="text-muted-foreground text-xs font-medium">Вид</span>
            <Tabs value={view} onValueChange={(v) => setView(v as View)}>
              <TabsList>
                <TabsTrigger value="slots">День недели × пара</TabsTrigger>
                <TabsTrigger value="dates">По датам</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="grid gap-1">
            <span className="text-muted-foreground text-xs font-medium">Порядок</span>
            <Tabs value={sort} onValueChange={(v) => setSort(v as Sort)}>
              <TabsList>
                <TabsTrigger value="code">По номеру</TabsTrigger>
                <TabsTrigger value="load">По загрузке</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <label className="text-muted-foreground flex h-9 cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="accent-primary size-4" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Неиспользуемые
          </label>
        </CardContent>
      </Card>

      {occupancy.isLoading ? (
        <LoadingState rows={8} />
      ) : occupancy.error ? (
        <ErrorState error={occupancy.error} onRetry={() => occupancy.refetch()} />
      ) : !data || rooms.length === 0 ? (
        <EmptyState title="Аудиторий нет" description="Добавьте аудитории в «Аудиторный фонд» или смените фильтр корпуса" />
      ) : (
        <>
          {stats && (
            <div className="stagger grid gap-3 sm:grid-cols-3">
              <StatCard title="Средняя загрузка" value={`${stats.avg}%`} icon={Gauge} hint={`${formatDate(data.range.from)} — ${formatDate(data.range.to)}`} />
              <StatCard
                title="Самая загруженная"
                value={stats.top.code}
                icon={Flame}
                tone={stats.top.percent > 85 ? 'danger' : 'warning'}
                hint={`${stats.top.percent}% слотов`}
                onClick={() => navigate(`/classrooms/${stats.top.id}`)}
              />
              <StatCard title="Не заняты ни разу" value={stats.idle} icon={Moon} tone={stats.idle ? 'info' : 'success'} hint={`из ${rooms.length} аудиторий`} />
            </div>
          )}
          <Card>
            <CardHeader className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{view === 'slots' ? 'Занятость по дням недели и парам' : 'Занятость по датам'}</CardTitle>
                <CardDescription>
                  {view === 'slots'
                    ? 'Доля дат периода, в которые слот занят. Наведите на ячейку — будет подсказка'
                    : `Сколько пар из ${data.lessonsPerDay} занято в этот день`}
                </CardDescription>
              </div>
              <Legend />
            </CardHeader>
            <CardContent>
              {view === 'slots' ? <SlotsGrid data={data} rooms={rooms} /> : <DatesGrid data={data} rooms={rooms} />}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="text-muted-foreground grid gap-1 text-[11px]">
      <div className="h-2.5 w-48 rounded-full border border-border/70" style={{ background: HEAT_LEGEND_GRADIENT }} />
      <div className="flex w-48 justify-between tabular-nums">
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>
    </div>
  );
}

function RoomCell({ room }: { room: RoomOccupancy }) {
  return (
    <th scope="row" className="bg-card sticky left-0 z-10 w-28 max-w-28 min-w-28 py-1 pr-3 sm:w-44 sm:max-w-44 text-left font-normal">
      <Link to={`/classrooms/${room.id}`} className="group block" title={room.name}>
        <div className="group-hover:text-primary truncate text-sm font-semibold transition-colors">
          {room.code}
          {!room.isActive && <span className="text-muted-foreground ml-1 text-[10px] font-normal">не исп.</span>}
        </div>
        <div className="text-muted-foreground truncate text-[11px]">
          {[CLASSROOM_TYPE_LABELS[room.classroomType], `${room.capacity} мест`, room.building].filter(Boolean).join(' · ')}
        </div>
      </Link>
    </th>
  );
}

function TotalCell({ room }: { room: RoomOccupancy }) {
  const ratio = room.percent / 100;
  return (
    <td className="bg-card sticky right-0 z-10 pl-3 shadow-[-8px_0_8px_-8px_rgb(0_0_0/0.15)]">
      <div
        className="flex h-7 w-14 items-center justify-center rounded-lg text-xs font-semibold tabular-nums ring-1 ring-black/5"
        style={{ background: heatColor(ratio), color: heatTextColor(ratio) }}
        title={`${room.slotsUsed} из ${room.slotsTotal} слотов`}
      >
        {room.percent}%
      </div>
    </td>
  );
}

/** Ячейка карты; gap — отступ перед первой парой дня / понедельником, чтобы блоки читались */
function HeatCell({ ratio, label, title, wide, gap }: { ratio: number; label?: string | number; title: string; wide?: boolean; gap?: boolean }) {
  return (
    <td className={cn('p-[1.5px]', gap && 'pl-2')}>
      <div
        className={cn(
          'flex h-7 items-center justify-center rounded-[5px] text-[10px] font-medium tabular-nums ring-1 ring-black/5 transition-transform hover:scale-110 hover:shadow-md',
          wide ? 'min-w-6' : 'min-w-4',
        )}
        style={{ background: heatColor(ratio), color: heatTextColor(ratio) }}
        title={title}
      >
        {label}
      </div>
    </td>
  );
}

function SlotsGrid({ data, rooms }: { data: OccupancyResponse; rooms: RoomOccupancy[] }) {
  const pairs = Array.from({ length: data.lessonsPerDay }, (_, i) => i + 1);
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="bg-card sticky left-0 z-10" />
            {data.weekdays.map((w) => (
              <th key={w} colSpan={pairs.length} className="px-1 pb-1 text-center text-xs font-semibold">
                {WEEKDAYS_SHORT[w]}
              </th>
            ))}
            <th className="bg-card sticky right-0 z-10 pb-1 pl-3 text-left text-xs font-semibold">Итого</th>
          </tr>
          <tr>
            <th className="bg-card sticky left-0 z-10" />
            {data.weekdays.map((w) =>
              pairs.map((n) => (
                <th key={`${w}-${n}`} className={cn('text-muted-foreground pb-1 text-center text-[10px] font-normal', n === 1 && 'pl-2')}>
                  {n}
                </th>
              )),
            )}
            <th className="bg-card sticky right-0 z-10" />
          </tr>
        </thead>
        <tbody>
          {rooms.map((room) => (
            <tr key={room.id}>
              <RoomCell room={room} />
              {data.weekdays.map((w) =>
                pairs.map((n) => {
                  const count = room.grid[`${w}-${n}`] ?? 0;
                  const of = data.weekdayCounts[String(w)] ?? 1;
                  const ratio = of ? count / of : 0;
                  return (
                    <HeatCell
                      key={`${w}-${n}`}
                      gap={n === 1}
                      ratio={ratio}
                      title={`${room.code} · ${WEEKDAYS_SHORT[w]}, ${n} пара: занята ${count} из ${of} (${Math.round(ratio * 100)}%)`}
                    />
                  );
                }),
              )}
              <TotalCell room={room} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DatesGrid({ data, rooms }: { data: OccupancyResponse; rooms: RoomOccupancy[] }) {
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="bg-card sticky left-0 z-10" />
            {data.days.map((d, i) => {
              const monday = isoWeekday(d) === 1;
              return (
                <th
                  key={d}
                  className={cn('text-muted-foreground pb-1 text-center align-bottom text-[10px] font-normal', monday && 'pl-2')}
                  title={formatDate(d)}
                >
                  {/* Месяц — над первой датой периода и над первой датой каждого следующего месяца */}
                  <div className="text-foreground h-3.5 text-[10px] font-semibold whitespace-nowrap">
                    {i === 0 || data.days[i - 1].slice(5, 7) !== d.slice(5, 7) ? MONTHS_SHORT[Number(d.slice(5, 7)) - 1] : ''}
                  </div>
                  <div className="text-foreground font-medium">{WEEKDAYS_SHORT[isoWeekday(d)]}</div>
                  <div className="tabular-nums">{d.slice(8)}</div>
                </th>
              );
            })}
            <th className="bg-card sticky right-0 z-10 pb-1 pl-3 text-left align-bottom text-xs font-semibold">Итого</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((room) => (
            <tr key={room.id}>
              <RoomCell room={room} />
              {data.days.map((d) => {
                const count = room.byDate[d] ?? 0;
                const ratio = count / data.lessonsPerDay;
                return (
                  <HeatCell
                    key={d}
                    wide
                    gap={isoWeekday(d) === 1}
                    ratio={ratio}
                    label={count || ''}
                    title={`${room.code} · ${formatDate(d)}: занято ${count} из ${data.lessonsPerDay} пар`}
                  />
                );
              })}
              <TotalCell room={room} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
