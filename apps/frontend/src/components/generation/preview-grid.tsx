import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { SimpleSelect } from '@/components/common/simple-select';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { addDays, formatDate, formatDateShort, isoWeekday, weekStart, weekdayName } from '@/lib/format';
import { LESSON_TYPE_SHORT } from '@/lib/labels';
import type { GenerationResult, PreviewLesson } from '@/lib/types';
import { cn } from '@/lib/utils';

export type PreviewView = 'group' | 'teacher' | 'room';

const VIEW_LABELS: Record<PreviewView, string> = {
  group: 'Группа',
  teacher: 'Преподаватель',
  room: 'Аудитория',
};

/** Сущности, по которым можно посмотреть неопубликованное расписание */
export function previewEntities(lessons: PreviewLesson[], view: PreviewView): Array<{ value: string; label: string }> {
  const map = new Map<string, string>();
  for (const l of lessons) {
    if (view === 'group') l.groupIds.forEach((id, i) => map.set(id, l.groupCodes[i] ?? id));
    else if (view === 'teacher' && l.teacherId) map.set(l.teacherId, l.teacherName ?? l.teacherId);
    else if (view === 'room' && l.roomId) map.set(l.roomId, l.roomCode ?? l.roomId);
  }
  return [...map.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru', { numeric: true }));
}

function matches(l: PreviewLesson, view: PreviewView, id: string) {
  return view === 'group' ? l.groupIds.includes(id) : view === 'teacher' ? l.teacherId === id : l.roomId === id;
}

/** Сетка недели по результату генерации — до применения и публикации */
export function PreviewGrid({
  result,
  lessonsPerDay,
  workingDays,
  views = ['group'],
}: {
  result: GenerationResult;
  lessonsPerDay: number;
  workingDays: number[];
  views?: PreviewView[];
}) {
  const [view, setView] = useState<PreviewView>(views[0]);
  const options = useMemo(() => previewEntities(result.lessons, view), [result.lessons, view]);
  const [entity, setEntity] = useState<Partial<Record<PreviewView, string | null>>>({});
  const id = entity[view] ?? options[0]?.value ?? null;
  const firstDate = result.lessons.map((l) => l.date).sort()[0] ?? result.range.from;
  const [week, setWeek] = useState(weekStart(firstDate));
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i)).filter((d) => workingDays.includes(isoWeekday(d)));
  const cells = useMemo(() => {
    const map = new Map<string, PreviewLesson[]>();
    for (const l of result.lessons) {
      if (!id || !matches(l, view, id)) continue;
      const k = `${l.date}#${l.lessonNumber}`;
      map.set(k, [...(map.get(k) ?? []), l]);
    }
    return map;
  }, [result.lessons, id, view]);
  const weekCount = days.reduce((sum, d) => sum + [...cells.entries()].filter(([k]) => k.startsWith(`${d}#`)).length, 0);
  const maxN = Math.max(lessonsPerDay, ...result.lessons.map((l) => l.lessonNumber));
  const rangeStart = weekStart(result.range.from);
  const rangeEnd = weekStart(result.range.to);
  return (
    <Card>
      <CardContent className="space-y-3 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          {views.length > 1 && (
            <div className="bg-muted inline-flex h-9 rounded-md p-0.5">
              {views.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={cn(
                    'rounded px-3 text-sm font-medium transition-colors',
                    view === v ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {VIEW_LABELS[v]}
                </button>
              ))}
            </div>
          )}
          <div className="w-60 max-w-full">
            <SimpleSelect value={id} onChange={(v) => setEntity({ ...entity, [view]: v })} options={options} />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setWeek(addDays(week, -7))}
              disabled={week <= rangeStart}
              aria-label="Предыдущая неделя"
            >
              <ChevronLeft />
            </Button>
            <span className="text-sm font-medium whitespace-nowrap">
              {formatDate(week)} — {formatDate(addDays(week, 6))}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setWeek(addDays(week, 7))}
              disabled={week >= rangeEnd}
              aria-label="Следующая неделя"
            >
              <ChevronRight />
            </Button>
          </div>
          <span className="text-muted-foreground ml-auto text-xs">Пар за неделю: {weekCount}</span>
        </div>
        <div className="overflow-x-auto rounded-md border scrollbar-thin">
          <table className="w-full min-w-[800px] table-fixed border-collapse text-xs">
            <thead>
              <tr className="bg-muted/40">
                <th className="w-12 p-2 text-left">Пара</th>
                {days.map((d) => (
                  <th key={d} className="border-l p-2 text-center">
                    {weekdayName(isoWeekday(d), true)} {formatDateShort(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: maxN }, (_, i) => i + 1).map((n) => (
                <tr key={n} className="border-t">
                  <td className="p-2 text-center font-semibold">{n}</td>
                  {days.map((d) => (
                    <td key={d} className="border-l p-1 align-top">
                      {(cells.get(`${d}#${n}`) ?? []).map((l, i) => (
                        <div key={i} className="bg-primary/5 mb-1 rounded border px-1.5 py-1 leading-tight">
                          <div className="font-medium">{l.itemName}</div>
                          <div className="text-muted-foreground">
                            {LESSON_TYPE_SHORT[l.lessonType]}
                            {l.subgroupNumber ? ` · п/г ${l.subgroupNumber}` : ''}
                            {view !== 'room' && ` · ${l.roomCode ?? 'без ауд.'}`}
                            {l.academicHours === 1 && <span className="ml-1 rounded bg-amber-200 px-1 text-amber-900">1 ч</span>}
                          </div>
                          <div className="text-muted-foreground truncate">
                            {view === 'group' ? (l.teacherName ?? '—') : l.groupCodes.join(', ')}
                            {view === 'room' && l.teacherName ? ` · ${l.teacherName}` : ''}
                          </div>
                        </div>
                      ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
