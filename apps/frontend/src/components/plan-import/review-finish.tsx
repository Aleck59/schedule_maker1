import { TriangleAlert } from 'lucide-react';
import { Field } from '@/components/common/field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { sumMismatch } from './review-items';
import type { Draft } from './types';

/** Шаг 4: что будет создано, учебная группа */
export function ReviewFinish({ draft, warnings, onChange }: { draft: Draft; warnings: string[]; onChange: (draft: Draft) => void }) {
  const included = draft.items.filter((i) => i.include);
  const disciplines = included.filter((i) => !['GROUP', 'MODULE_EXAM'].includes(i.kind));
  const rows = included.filter((i) => !['GROUP', 'MODULE'].includes(i.kind)).reduce((n, i) => n + i.semesters.length, 0);
  const mismatches = included.reduce((n, i) => n + i.semesters.filter((s) => sumMismatch(i.kind, s) !== null).length, 0);
  const cycles = new Set([...draft.cycles.map((c) => c.code), ...included.filter((i) => i.kind === 'GROUP').map((i) => i.code)]);
  const group = draft.group;
  const summary: Array<[string, string | number]> = [
    ['Специальность', `${draft.specialty.code} ${draft.specialty.name} (${draft.specialty.qualification})`],
    ['Учебный план', draft.program.title || `набор ${draft.program.admissionYear}`],
    ['Учебных лет (курсов)', new Set(draft.semesters.map((s) => s.course)).size],
    ['Семестров', draft.semesters.length],
    ['Периодов календарного графика', draft.periods.length],
    ['Циклов', cycles.size],
    ['Дисциплин, модулей, МДК, практик', disciplines.length],
    ['Строк часов по семестрам', rows],
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Будет создано</CardTitle>
          <CardDescription>Проверьте итог. После создания всё можно изменить в разделе «Учебные планы».</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
            {summary.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          {mismatches > 0 && (
            <Alert variant="warning">
              <TriangleAlert />
              <AlertTitle>Суммы часов не сходятся в {mismatches} строках</AlertTitle>
              <AlertDescription>Можно продолжить — в план попадут введённые значения. Рекомендуется вернуться к шагу 3.</AlertDescription>
            </Alert>
          )}
          {warnings.length > 0 && (
            <Alert variant="warning">
              <TriangleAlert />
              <AlertTitle>Замечания распознавания</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Учебная группа</CardTitle>
          <CardDescription>Сразу создать группу, которая учится по этому плану (курс и семестр определятся по текущей дате).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={!!group}
              onCheckedChange={(v) =>
                onChange({
                  ...draft,
                  group: v
                    ? { code: `${draft.specialty.name.slice(0, 1).toUpperCase() || 'Г'}-${String(draft.program.admissionYear).slice(2)}-1`, studentCount: 25, subgroupCount: 1 }
                    : null,
                })
              }
            />
            Создать группу
          </label>
          {group && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Код группы" required>
                <Input value={group.code} onChange={(e) => onChange({ ...draft, group: { ...group, code: e.target.value } })} />
              </Field>
              <Field label="Студентов" required>
                <Input
                  type="number"
                  min={1}
                  value={group.studentCount}
                  onChange={(e) => onChange({ ...draft, group: { ...group, studentCount: Number(e.target.value) } })}
                />
              </Field>
              <Field label="Подгрупп" hint="Для лабораторных и иностранного языка">
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={group.subgroupCount}
                  onChange={(e) => onChange({ ...draft, group: { ...group, subgroupCount: Number(e.target.value) } })}
                />
              </Field>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
