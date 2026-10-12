import { CheckCircle2, ChevronRight, Lightbulb } from 'lucide-react';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { pluralize } from '@/lib/format';
import { LESSON_TYPE_SHORT, UNPLACED_REASON_LABELS } from '@/lib/labels';
import type { UnplacedItem } from '@/lib/types';

export interface UnplacedGroup {
  code: string;
  title: string;
  suggestion: string | null;
  items: UnplacedItem[];
  lessons: number;
}

/** Непоставленные занятия по причинам: самые массовые причины — первыми */
export function groupUnplaced(items: UnplacedItem[]): UnplacedGroup[] {
  const map = new Map<string, UnplacedGroup>();
  for (const u of items) {
    const code = u.reasons[0]?.code ?? 'OTHER';
    const group = map.get(code) ?? {
      code,
      title: UNPLACED_REASON_LABELS[code] ?? u.reasons[0]?.message ?? 'Другая причина',
      suggestion: u.suggestions[0] ?? null,
      items: [],
      lessons: 0,
    };
    group.items.push(u);
    group.lessons += u.lessonsUnplaced;
    map.set(code, group);
  }
  const groups = [...map.values()].sort((a, b) => b.lessons - a.lessons);
  for (const g of groups) {
    g.items.sort((a, b) => (a.teacherName ?? '').localeCompare(b.teacherName ?? '') || b.lessonsUnplaced - a.lessonsUnplaced);
  }
  return groups;
}

/** Непоставленные занятия одного преподавателя: чаще всего причина общая (перегрузка, недоступность) */
export function byTeacher(items: UnplacedItem[]) {
  const map = new Map<string, { name: string; items: UnplacedItem[]; lessons: number; groups: string[] }>();
  for (const u of items) {
    const name = u.teacherName ?? 'Преподаватель не назначен';
    const t = map.get(name) ?? { name, items: [], lessons: 0, groups: [] };
    t.items.push(u);
    t.lessons += u.lessonsUnplaced;
    for (const g of u.groupCodes) if (!t.groups.includes(g)) t.groups.push(g);
    map.set(name, t);
  }
  return [...map.values()].sort((a, b) => b.lessons - a.lessons || a.name.localeCompare(b.name));
}

export function UnplacedList({ items }: { items: UnplacedItem[] }) {
  if (items.length === 0) {
    return (
      <Alert variant="success">
        <CheckCircle2 />
        <AlertTitle>Все занятия поставлены</AlertTitle>
      </Alert>
    );
  }
  const groups = groupUnplaced(items);
  return (
    <div className="space-y-2">
      {groups.map((g, i) => (
        <details key={g.code} open={i === 0} className="group/reason bg-card rounded-lg border">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 select-none">
            <ChevronRight className="text-muted-foreground size-4 shrink-0 transition-transform group-open/reason:rotate-90" />
            <span className="font-medium">{g.title}</span>
            <span className="text-muted-foreground text-sm">
              {g.items.length} {pluralize(g.items.length, 'дисциплина', 'дисциплины', 'дисциплин')}
            </span>
            <Badge variant="destructive" className="ml-auto tabular-nums">
              {g.lessons} {pluralize(g.lessons, 'пара', 'пары', 'пар')}
            </Badge>
          </summary>
          <div className="space-y-2 border-t px-3 pt-2 pb-3">
            {g.suggestion && (
              <div className="flex gap-2 text-sm text-pretty">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-sky-500" />
                {g.suggestion}
              </div>
            )}
            <div className="divide-y rounded-md border">
              {byTeacher(g.items).map((t) => (
                <details key={t.name} className="group/teacher">
                  <summary className="hover:bg-muted/50 flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm select-none">
                    <ChevronRight className="text-muted-foreground size-3.5 shrink-0 transition-transform group-open/teacher:rotate-90" />
                    <span className="font-medium">{t.name}</span>
                    <span className="text-muted-foreground hidden min-w-0 truncate sm:inline">
                      {t.items.length} {pluralize(t.items.length, 'дисциплина', 'дисциплины', 'дисциплин')} · {t.groups.join(', ')}
                    </span>
                    <span className="ml-auto shrink-0 tabular-nums">
                      {t.lessons} {pluralize(t.lessons, 'пара', 'пары', 'пар')}
                    </span>
                  </summary>
                  <table className="w-full text-sm">
                    <tbody>
                      {t.items.map((u) => (
                        <tr key={u.demandId} className="border-t" title={u.reasons.map((r) => r.message).join('\n')}>
                          <td className="py-1.5 pr-3 pl-9">
                            {u.disciplineName}
                            <span className="text-muted-foreground"> · {LESSON_TYPE_SHORT[u.lessonType] ?? u.lessonType}</span>
                          </td>
                          <td className="py-1.5 pr-3 whitespace-nowrap">
                            {u.groupCodes.join(', ')}
                            {u.subgroupNumber ? ` п/г ${u.subgroupNumber}` : ''}
                          </td>
                          <td className="text-muted-foreground py-1.5 pr-3 text-right whitespace-nowrap tabular-nums">
                            {u.lessonsUnplaced} из {u.lessonsRequired}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              ))}
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}
