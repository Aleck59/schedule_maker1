import { useEffect, useState } from 'react';
import { Spinner } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { useSettings } from '@/hooks/use-reference';
import { api } from '@/lib/api';
import { WEEKDAYS_SHORT } from '@/lib/labels';
import { useApi, useApiMutation } from '@/lib/query';
import type { AvailabilitySlot } from '@/lib/types';
import { cn } from '@/lib/utils';

type CellState = 'available' | 'preferred' | 'undesired' | 'unavailable';

const NEXT: Record<CellState, CellState> = {
  available: 'preferred',
  preferred: 'undesired',
  undesired: 'unavailable',
  unavailable: 'available',
};

/**
 * Сетка доступности (день недели × пара). Клик по ячейке переключает:
 * доступно → предпочтительно → нежелательно → недоступно.
 */
export function AvailabilityEditor({ path, editable, invalidateKey }: { path: string; editable: boolean; invalidateKey: unknown[] }) {
  const settings = useSettings();
  const data = useApi<AvailabilitySlot[]>(['availability', path], path);
  const [cells, setCells] = useState<Record<string, CellState>>({});
  const [dirty, setDirty] = useState(false);
  const days = settings.data?.settings.workingDays ?? [1, 2, 3, 4, 5, 6];
  const lessons = settings.data?.settings.lessonsPerDay ?? 6;

  useEffect(() => {
    const map: Record<string, CellState> = {};
    for (const s of data.data ?? []) {
      const w = s.preferenceWeight ?? 0;
      map[`${s.weekday}-${s.lessonNumber}`] = !s.isAvailable ? 'unavailable' : w > 0 ? 'preferred' : w < 0 ? 'undesired' : 'available';
    }
    setCells(map);
    setDirty(false);
  }, [data.data]);

  const save = useApiMutation(
    () => {
      const items = Object.entries(cells)
        .filter(([, v]) => v !== 'available')
        .map(([k, v]) => {
          const [weekday, lessonNumber] = k.split('-').map(Number);
          return { weekday, lessonNumber, isAvailable: v !== 'unavailable', preferenceWeight: v === 'preferred' ? 5 : v === 'undesired' ? -5 : 0 };
        });
      return api.post(path, { items });
    },
    {
      success: 'Доступность сохранена',
      invalidate: [['availability', path], invalidateKey],
      onSuccess: () => setDirty(false),
    },
  );

  const toggle = (key: string) => {
    if (!editable) return;
    setCells((c) => ({ ...c, [key]: NEXT[c[key] ?? 'available'] }));
    setDirty(true);
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="p-1" />
              {Array.from({ length: lessons }, (_, i) => (
                <th key={i} className="w-14 p-1 text-center font-medium">
                  {i + 1} пара
                  <div className="text-muted-foreground text-[10px] font-normal">{settings.data?.lessonTimes[i]?.startTime}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d}>
                <td className="pr-2 font-medium">{WEEKDAYS_SHORT[d]}</td>
                {Array.from({ length: lessons }, (_, i) => {
                  const key = `${d}-${i + 1}`;
                  const state = cells[key] ?? 'available';
                  return (
                    <td key={key} className="p-0.5">
                      <button
                        type="button"
                        onClick={() => toggle(key)}
                        className={cn(
                          'h-8 w-14 rounded border text-[10px] transition',
                          state === 'available' && 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300',
                          state === 'preferred' && 'bg-sky-200 font-semibold text-sky-900',
                          state === 'undesired' && 'bg-amber-200 text-amber-900',
                          state === 'unavailable' && 'bg-red-200 text-red-900 line-through',
                          editable ? 'cursor-pointer hover:ring-primary/50 hover:ring-2' : 'cursor-default',
                        )}
                      >
                        {{ available: '✓', preferred: '★', undesired: '−', unavailable: '✕' }[state]}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-muted-foreground flex flex-wrap items-center gap-4 text-xs">
        <span>✓ доступно</span>
        <span>★ предпочтительно</span>
        <span>− нежелательно</span>
        <span>✕ недоступно (жёсткое ограничение)</span>
        {editable && (
          <Button size="sm" className="ml-auto" onClick={() => save.mutate(undefined)} disabled={!dirty || save.isPending}>
            {save.isPending && <Spinner />} Сохранить доступность
          </Button>
        )}
      </div>
    </div>
  );
}
