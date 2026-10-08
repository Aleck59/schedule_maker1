import { useState } from 'react';
import { Paintbrush, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDate } from '@/lib/format';
import { CALENDAR_EVENT_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { CODE_LABELS, addDays } from './calendar';
import type { Draft, DraftSemester, RecognizedCalendar } from './types';

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const BRUSHES = ['', 'Э', 'К', 'У', 'П', 'Пд', 'Д', 'Г', '='];
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const CODE_COLORS: Record<string, string> = {
  '': 'bg-sky-50 dark:bg-sky-950/30',
  Э: 'bg-rose-200 text-rose-900 dark:bg-rose-900/50 dark:text-rose-100',
  К: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100',
  У: 'bg-amber-200 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100',
  П: 'bg-orange-300 text-orange-950 dark:bg-orange-800/60 dark:text-orange-100',
  Пд: 'bg-orange-400 text-orange-950',
  Д: 'bg-violet-200 text-violet-900',
  Г: 'bg-violet-300 text-violet-950 dark:bg-violet-800/60 dark:text-violet-100',
  '=': 'bg-slate-200 text-slate-500 dark:bg-slate-800',
  '?': 'bg-red-500 text-white',
  '*': 'bg-slate-300',
};

/** Шаг 2: календарный учебный график — сетка недель как на бумаге, с исправлением «кистью» */
export function ReviewCalendar({
  calendar,
  draft,
  onCalendarChange,
  onSemestersChange,
}: {
  calendar: RecognizedCalendar[];
  draft: Draft;
  onCalendarChange: (calendar: RecognizedCalendar[]) => void;
  onSemestersChange: (semesters: DraftSemester[]) => void;
}) {
  const [brush, setBrush] = useState<string>('К');
  const unknown = calendar.reduce((n, c) => n + c.weeks.reduce((m, w) => m + w.days.filter((d) => d === '?').length, 0), 0);

  const paint = (course: number, week: number, day: number | null) => {
    onCalendarChange(
      calendar.map((c) =>
        c.course !== course
          ? c
          : {
              ...c,
              weeks: c.weeks.map((w, i) =>
                i !== week ? w : { ...w, days: w.days.map((d, j) => (day === null || j === day ? brush : d)) },
              ),
            },
      ),
    );
  };

  return (
    <div className="space-y-4">
      {calendar.length === 0 ? (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>Календарный учебный график не распознан</AlertTitle>
          <AlertDescription>
            Даты семестров заданы по умолчанию — проверьте их в таблице ниже. Периоды сессий и каникул можно добавить позже в разделе
            «Календарный график».
          </AlertDescription>
        </Alert>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Сетка календарного графика</CardTitle>
            <CardDescription>
              Сверьте со сканом. Чтобы исправить: выберите обозначение («кисть») и щёлкните по дню или по номеру недели (вся неделя).
              Даты семестров и периоды пересчитываются автоматически.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <Paintbrush className="text-muted-foreground size-4" />
              {BRUSHES.map((code) => (
                <button
                  key={code || 'theory'}
                  type="button"
                  onClick={() => setBrush(code)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
                    brush === code ? 'ring-primary border-primary ring-2' : 'hover:bg-muted',
                  )}
                >
                  <span className={cn('flex size-5 items-center justify-center rounded text-[11px] font-semibold', CODE_COLORS[code])}>
                    {code || 'Т'}
                  </span>
                  {CODE_LABELS[code]}
                </button>
              ))}
            </div>
            {unknown > 0 && (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>Не распознано дней: {unknown}</AlertTitle>
                <AlertDescription>Красные клетки «?» — укажите обозначение по скану (фрагменты скана — при наведении).</AlertDescription>
              </Alert>
            )}
            {calendar.map((cal) => (
              <div key={cal.course} className="space-y-1">
                <div className="text-sm font-medium">
                  {cal.course} курс · {cal.startYear}–{cal.startYear + 1} учебный год
                </div>
                <div className="overflow-x-auto pb-1 scrollbar-thin">
                  <table className="border-collapse text-[10px]">
                    <thead>
                      <tr>
                        <th className="w-7" />
                        {cal.weeks.map((w, i) => {
                          const month = Number(addDays(w.monday, 3).slice(5, 7)) - 1;
                          const prev = i > 0 ? Number(addDays(cal.weeks[i - 1].monday, 3).slice(5, 7)) - 1 : -1;
                          return (
                            <th key={w.number} className="text-muted-foreground h-4 px-0 text-left font-normal">
                              {month !== prev ? MONTHS[month] : ''}
                            </th>
                          );
                        })}
                      </tr>
                      <tr>
                        <th className="text-muted-foreground pr-1 text-right font-normal">Нед</th>
                        {cal.weeks.map((w, i) => (
                          <th key={w.number} className="p-0">
                            <button
                              type="button"
                              title={`Неделя ${w.number} с ${formatDate(w.monday)} — закрасить всю неделю`}
                              onClick={() => paint(cal.course, i, null)}
                              className="hover:bg-muted text-muted-foreground h-5 w-6 rounded-sm font-normal"
                            >
                              {w.number}
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {DAYS.map((dayName, d) => (
                        <tr key={dayName}>
                          <td className="text-muted-foreground pr-1 text-right">{dayName}</td>
                          {cal.weeks.map((w, i) => {
                            const code = w.days[d] ?? '';
                            const date = addDays(w.monday, d);
                            const inYear = date >= `${cal.startYear}-09-01` && date <= `${cal.startYear + 1}-08-31`;
                            const crop = code === '?' ? cal.uncertain.find((u) => u.weeks.includes(i) && u.days.includes(d))?.crop : undefined;
                            const cell = (
                              <button
                                type="button"
                                disabled={!inYear}
                                onClick={() => paint(cal.course, i, d)}
                                className={cn(
                                  'h-5 w-6 border border-white text-[10px] font-semibold dark:border-slate-900',
                                  inYear ? CODE_COLORS[code] ?? CODE_COLORS['?'] : 'bg-transparent',
                                  inYear && 'hover:ring-primary hover:ring-1',
                                )}
                              >
                                {inYear && code !== '' ? code : ''}
                              </button>
                            );
                            return (
                              <td key={w.number} className="p-0">
                                {inYear ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>{cell}</TooltipTrigger>
                                    <TooltipContent>
                                      <div>
                                        {formatDate(date)} — {CODE_LABELS[code] ?? code}
                                      </div>
                                      {crop && <img src={crop} alt="Фрагмент скана" className="mt-1 max-h-32 rounded bg-white" />}
                                    </TooltipContent>
                                  </Tooltip>
                                ) : (
                                  cell
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 2xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Семестры</CardTitle>
            <CardDescription>Границы семестров: первый — до окончания зимних каникул, второй — до конца учебного года.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Семестр</TableHead>
                  <TableHead>Начало</TableHead>
                  <TableHead>Окончание</TableHead>
                  <TableHead className="text-right">Теория, нед</TableHead>
                  <TableHead className="text-right">Сессия</TableHead>
                  <TableHead className="text-right">Практика</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {draft.semesters.map((s, i) => (
                  <TableRow key={s.number}>
                    <TableCell className="whitespace-nowrap">
                      {s.number} <span className="text-muted-foreground">({s.course} курс)</span>
                    </TableCell>
                    {(['startDate', 'endDate'] as const).map((key) => (
                      <TableCell key={key} className="py-1">
                        <Input
                          type="date"
                          className="h-8 w-36"
                          value={s[key]}
                          onChange={(e) =>
                            onSemestersChange(draft.semesters.map((x, j) => (j === i ? { ...x, [key]: e.target.value } : x)))
                          }
                        />
                      </TableCell>
                    ))}
                    <TableCell className="text-right tabular-nums">{s.theoryWeeks}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.examWeeks}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.practiceWeeks}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Периоды графика</CardTitle>
            <CardDescription>Будут созданы в календарном графике плана: в эти даты обычные занятия не ставятся.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-96 overflow-y-auto scrollbar-thin">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Курс</TableHead>
                    <TableHead>Период</TableHead>
                    <TableHead>Даты</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {draft.periods.map((p, i) => (
                    <TableRow key={i}>
                      <TableCell>{p.course}</TableCell>
                      <TableCell>{CALENDAR_EVENT_LABELS[p.type] ?? p.type}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(p.startDate)} — {formatDate(p.endDate)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function calendarErrors(calendar: RecognizedCalendar[], draft: Draft): string[] {
  const errors: string[] = [];
  const unknown = calendar.reduce((n, c) => n + c.weeks.reduce((m, w) => m + w.days.filter((d) => d === '?').length, 0), 0);
  if (unknown) errors.push(`В графике не распознано дней: ${unknown}`);
  for (const s of draft.semesters) {
    if (!s.startDate || !s.endDate || s.startDate > s.endDate) errors.push(`Семестр ${s.number}: проверьте даты`);
  }
  return errors;
}
