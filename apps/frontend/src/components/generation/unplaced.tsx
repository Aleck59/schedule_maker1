import { Fragment, useState } from 'react';
import { CheckCircle2, ChevronRight, ExternalLink, Lightbulb, RotateCcw, Wand2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { pluralize } from '@/lib/format';
import { LESSON_TYPE_SHORT, UNPLACED_REASON_LABELS } from '@/lib/labels';
import type { UnplacedItem } from '@/lib/types';
import { cn } from '@/lib/utils';

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
  const map = new Map<
    string,
    {
      name: string;
      teacherId: string | null;
      items: UnplacedItem[];
      lessons: number;
      groups: string[];
    }
  >();
  for (const u of items) {
    const name = u.teacherName ?? 'Преподаватель не назначен';
    const t = map.get(name) ?? {
      name,
      teacherId: u.teacherId ?? null,
      items: [],
      lessons: 0,
      groups: [],
    };
    t.items.push(u);
    t.lessons += u.lessonsUnplaced;
    for (const g of u.groupCodes) if (!t.groups.includes(g)) t.groups.push(g);
    map.set(name, t);
  }
  return [...map.values()].sort((a, b) => b.lessons - a.lessons || a.name.localeCompare(b.name));
}

/** Настройки генерации, которые можно поменять одной кнопкой и перезапустить */
export interface RerunSettings {
  timeLimitSeconds: number;
  lessonsPerDay: number;
  maxGroupLessonsPerDay: number;
  maxSameDisciplinePerDay: number;
  maxSameDisciplinePerWeek: number;
  avoidWindows: boolean;
  allowLateLessons: boolean;
  respectTeacherPreferences: boolean;
  maximizePlacement: boolean;
}
export type RerunPatch = Partial<RerunSettings>;

export interface QuickFix {
  label: string;
  hint: string;
  /** Изменить настройки и перезапустить генерацию */
  patch?: RerunPatch;
  /** Или перейти туда, где исправляется причина */
  to?: string;
}

/** Быстрые исправления для причины непоставленных занятий с учётом текущих настроек */
export function quickFixes(code: string, s: RerunSettings): QuickFix[] {
  const fixes: QuickFix[] = [];
  const moreTime = (): QuickFix | null =>
    s.timeLimitSeconds < 3600
      ? {
          label: `Дать генератору ${Math.min(3600, s.timeLimitSeconds * 2)} с`,
          hint: `Сейчас ${s.timeLimitSeconds} с — решатель успеет перебрать больше вариантов`,
          patch: { timeLimitSeconds: Math.min(3600, s.timeLimitSeconds * 2) },
        }
      : null;
  const morePerDay = (): QuickFix | null =>
    s.maxGroupLessonsPerDay < Math.max(s.lessonsPerDay, 1) && s.maxGroupLessonsPerDay < 10
      ? {
          label: `До ${s.maxGroupLessonsPerDay + 1} пар у группы в день`,
          hint: `Сейчас не больше ${s.maxGroupLessonsPerDay}`,
          patch: { maxGroupLessonsPerDay: s.maxGroupLessonsPerDay + 1 },
        }
      : null;
  const allowWindows = (): QuickFix | null =>
    s.avoidWindows
      ? {
          label: 'Разрешить окна',
          hint: 'Не требовать занятий без окон у групп и преподавателей',
          patch: { avoidWindows: false },
        }
      : null;
  const allowLate = (): QuickFix | null =>
    s.allowLateLessons
      ? null
      : {
          label: 'Разрешить поздние пары',
          hint: 'Использовать последние пары сетки дня',
          patch: { allowLateLessons: true },
        };
  const ignorePreferences = (): QuickFix | null =>
    s.respectTeacherPreferences
      ? {
          label: 'Не учитывать пожелания',
          hint: 'Пожелания преподавателей станут необязательными; запреты (недоступность) останутся',
          patch: { respectTeacherPreferences: false },
        }
      : null;
  const maximize = (): QuickFix | null =>
    s.maximizePlacement
      ? null
      : {
          label: 'Расставить по максимуму',
          hint: 'Поставить оставшиеся пары сверх лимитов преподавателей и частоты дисциплины; накладок не будет',
          patch: { maximizePlacement: true },
        };
  const push = (...list: Array<QuickFix | null>) => list.forEach((f) => f && fixes.push(f));

  switch (code) {
    case 'NOT_ENOUGH_TIME':
      push(maximize(), moreTime(), allowWindows(), morePerDay(), allowLate());
      break;
    case 'GROUP_BUSY':
      push(morePerDay(), allowLate(), {
        label: 'Календарный график',
        hint: 'Проверьте учебные недели группы',
        to: '/calendar',
      });
      break;
    case 'DAILY_LIMITS':
      push(
        maximize(),
        s.maxSameDisciplinePerDay < 6
          ? {
              label: `До ${s.maxSameDisciplinePerDay + 1} пар дисциплины в день`,
              hint: `Сейчас не больше ${s.maxSameDisciplinePerDay}`,
              patch: { maxSameDisciplinePerDay: s.maxSameDisciplinePerDay + 1 },
            }
          : null,
        s.maxSameDisciplinePerWeek < 20
          ? {
              label: `До ${Math.min(20, s.maxSameDisciplinePerWeek + 2)} пар дисциплины в неделю`,
              hint: `Сейчас не больше ${s.maxSameDisciplinePerWeek}`,
              patch: {
                maxSameDisciplinePerWeek: Math.min(20, s.maxSameDisciplinePerWeek + 2),
              },
            }
          : null,
        morePerDay(),
      );
      break;
    case 'TEACHER_BUSY':
    case 'TEACHER_LIMIT':
      push(code === 'TEACHER_LIMIT' ? maximize() : null, ignorePreferences(), moreTime(), {
        label: 'Перераспределить нагрузку',
        hint: 'Передать часть часов другому преподавателю',
        to: '/workload?tab=teachers',
      });
      break;
    case 'TEACHER_UNAVAILABLE':
      push(ignorePreferences(), {
        label: 'Доступность преподавателей',
        hint: 'Открыть список преподавателей',
        to: '/teachers',
      });
      break;
    case 'NO_TEACHER':
    case 'TEACHER_INACTIVE':
    case 'TEACHER_LEVEL':
    case 'TEACHER_NOT_EMPLOYED':
      push({
        label: 'Назначить преподавателя',
        hint: 'Открыть нагрузку групп',
        to: '/workload',
      });
      break;
    case 'NO_SUITABLE_ROOM':
      push({
        label: 'Аудитории',
        hint: 'Добавить аудиторию нужного типа и вместимости',
        to: '/classrooms',
      });
      break;
    case 'ROOM_SHORTAGE':
      push(allowLate(), morePerDay(), {
        label: 'Аудитории',
        hint: 'Добавить аудитории',
        to: '/classrooms',
      });
      break;
    case 'NO_AVAILABLE_DAYS':
    case 'NO_PRACTICE_PERIOD':
      push({
        label: 'Календарный график',
        hint: 'Добавить недели обучения или практики',
        to: '/calendar',
      });
      break;
    default:
      push(moreTime());
  }
  return fixes;
}

/** Все изменения настроек для причины одним набором */
export function combinedPatch(fixes: QuickFix[]): RerunPatch | null {
  const patches = fixes.filter((f) => f.patch).map((f) => f.patch!);
  return patches.length > 1 ? Object.assign({}, ...patches) : null;
}

export function UnplacedList({
  items,
  settings,
  onRerun,
  rerunDisabled,
  groupIdByCode,
}: {
  items: UnplacedItem[];
  settings?: RerunSettings;
  onRerun?: (patch: RerunPatch) => void;
  rerunDisabled?: boolean;
  groupIdByCode?: Map<string, string>;
}) {
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
      {groups.map((g, i) => {
        const fixes = settings ? quickFixes(g.code, settings) : [];
        const all = combinedPatch(fixes);
        return (
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
            <div className="space-y-3 border-t px-3 pt-2.5 pb-3">
              {g.suggestion && (
                <div className="flex gap-2 text-sm text-pretty">
                  <Lightbulb className="mt-0.5 size-4 shrink-0 text-sky-500" />
                  {g.suggestion}
                </div>
              )}
              {fixes.length > 0 && (
                <div className="bg-muted/40 flex flex-wrap items-center gap-1.5 rounded-md p-2">
                  <span className="text-muted-foreground mr-1 flex items-center gap-1 text-xs font-medium">
                    <Wand2 className="size-3.5" /> Быстрые исправления:
                  </span>
                  {fixes.map((f) =>
                    f.to ? (
                      <Button key={f.label} asChild variant="outline" size="sm" title={f.hint}>
                        <Link to={f.to}>
                          {f.label} <ExternalLink />
                        </Link>
                      </Button>
                    ) : (
                      <Button
                        key={f.label}
                        variant="outline"
                        size="sm"
                        title={`${f.hint}. Генерация перезапустится с этой настройкой`}
                        disabled={rerunDisabled || !onRerun}
                        onClick={() => onRerun?.(f.patch!)}
                      >
                        <RotateCcw /> {f.label}
                      </Button>
                    ),
                  )}
                  {all && (
                    <Button
                      size="sm"
                      disabled={rerunDisabled || !onRerun}
                      onClick={() => onRerun?.(all)}
                      title="Применить все изменения настроек выше и перезапустить генерацию"
                    >
                      <RotateCcw /> Всё сразу и перезапустить
                    </Button>
                  )}
                </div>
              )}
              <UnplacedTable items={g.items} groupIdByCode={groupIdByCode} />
            </div>
          </details>
        );
      })}
    </div>
  );
}

/** Таблица с одинаковыми колонками: строки преподавателей раскрываются до дисциплин */
function UnplacedTable({ items, groupIdByCode }: { items: UnplacedItem[]; groupIdByCode?: Map<string, string> }) {
  const teachers = byTeacher(items);
  const [open, setOpen] = useState<Set<string>>(() => new Set(teachers.length <= 3 ? teachers.map((t) => t.name) : []));
  const toggle = (name: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  return (
    <div className="overflow-x-auto rounded-md border scrollbar-thin">
      <table className="w-full min-w-[640px] table-fixed text-sm">
        <colgroup>
          <col className="w-[27%]" />
          <col />
          <col className="w-[20%]" />
          <col className="w-32" />
          <col className="w-11" />
        </colgroup>
        <thead className="bg-muted/50 text-muted-foreground text-xs">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Преподаватель</th>
            <th className="px-3 py-2 text-left font-medium">Дисциплина</th>
            <th className="px-3 py-2 text-left font-medium">Группы</th>
            <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Не поставлено</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {teachers.map((t) => {
            const expanded = open.has(t.name);
            return (
              <Fragment key={t.name}>
                <tr className="hover:bg-muted/40 cursor-pointer border-t" onClick={() => toggle(t.name)}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <ChevronRight
                        className={cn('text-muted-foreground size-3.5 shrink-0 transition-transform', expanded && 'rotate-90')}
                      />
                      <span className={cn('line-clamp-2 font-medium', t.items[0]?.teacherName == null && 'text-destructive')} title={t.name}>
                        {t.name}
                      </span>
                    </div>
                  </td>
                  <td className="text-muted-foreground truncate px-3 py-2">
                    {t.items.length} {pluralize(t.items.length, 'дисциплина', 'дисциплины', 'дисциплин')}
                  </td>
                  <td className="text-muted-foreground truncate px-3 py-2" title={t.groups.join(', ')}>
                    {t.groups.join(', ')}
                  </td>
                  <td className="px-3 py-2 text-right font-medium whitespace-nowrap tabular-nums">
                    {t.lessons} {pluralize(t.lessons, 'пара', 'пары', 'пар')}
                  </td>
                  <td className="px-1 py-1 text-center" onClick={(e) => e.stopPropagation()}>
                    {t.teacherId && (
                      <Button asChild variant="ghost" size="icon-sm" title="Карточка преподавателя: доступность, нагрузка">
                        <Link to={`/teachers/${t.teacherId}`}>
                          <ExternalLink />
                        </Link>
                      </Button>
                    )}
                  </td>
                </tr>
                {expanded &&
                  t.items.map((u) => {
                    const groupId = groupIdByCode?.get(u.groupCodes[0] ?? '');
                    return (
                      <tr key={u.demandId} className="bg-muted/20 border-t" title={u.reasons.map((r) => r.message).join('\n')}>
                        <td />
                        <td className="px-3 py-1.5">
                          <div className="line-clamp-2" title={`${u.itemCode} ${u.disciplineName}`}>
                            {u.disciplineName}
                          </div>
                          <div className="text-muted-foreground text-xs">
                            {u.itemCode} · {LESSON_TYPE_SHORT[u.lessonType] ?? u.lessonType}
                          </div>
                        </td>
                        <td className="px-3 py-1.5" title={u.groupCodes.join(', ')}>
                          {u.groupCodes.join(', ')}
                          {u.subgroupNumber ? ` п/г ${u.subgroupNumber}` : ''}
                        </td>
                        <td className="text-muted-foreground px-3 py-1.5 text-right whitespace-nowrap tabular-nums">
                          {u.lessonsUnplaced} из {u.lessonsRequired}
                        </td>
                        <td className="px-1 py-1 text-center">
                          {groupId && (
                            <Button asChild variant="ghost" size="icon-sm" title="Нагрузка группы: сменить преподавателя или часы">
                              <Link to={`/workload?group=${groupId}`}>
                                <ExternalLink />
                              </Link>
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
