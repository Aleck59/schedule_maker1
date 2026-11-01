import { Field } from '@/components/common/field';
import { SimpleSelect } from '@/components/common/simple-select';
import { Input } from '@/components/ui/input';
import { useClassrooms, useGroups, usePrograms, useSemesters, useTeachers } from '@/hooks/use-reference';

const LABELS: Record<string, string> = {
  from: 'С даты',
  to: 'По дату',
  programId: 'Учебный план',
  semesterId: 'Семестр',
  groupId: 'Группа',
  groupIds: 'Группы (столбцы бланка по порядку)',
  teacherId: 'Преподаватель',
  classroomId: 'Аудитория',
};

/** Обязательные параметры источников (без них отчёт не строится) */
export const REQUIRED_PARAM: Record<string, string> = {
  'group-schedule': 'groupId',
  'teacher-schedule': 'teacherId',
  'classroom-schedule': 'classroomId',
  'schedule-week': 'groupIds',
};

/** Поля параметров источника данных */
export function SourceParams({
  source,
  params,
  value,
  onChange,
}: {
  source: string;
  params: string[];
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const need = (p: string) => params.includes(p);
  const programs = usePrograms(need('programId'));
  const semesters = useSemesters(need('semesterId'));
  const groups = useGroups(need('groupId') || need('groupIds'));
  const teachers = useTeachers(need('teacherId'));
  const classrooms = useClassrooms(need('classroomId'));
  const set = (k: string, v: string | null | undefined) => {
    const next = { ...value };
    if (v) next[k] = v;
    else delete next[k];
    onChange(next);
  };
  const required = REQUIRED_PARAM[source];
  const options: Record<string, Array<{ value: string; label: string }>> = {
    programId: (programs.data ?? []).map((x) => ({ value: x.id, label: x.title })),
    semesterId: (semesters.data ?? [])
      .filter((s) => !value.programId || s.educationalProgramId === value.programId)
      .map((s) => ({ value: s.id, label: `${s.program?.title ?? ''} · ${s.number} сем.` })),
    groupId: (groups.data ?? []).map((g) => ({ value: g.id, label: g.code })),
    teacherId: (teachers.data ?? []).map((t) => ({ value: t.id, label: t.fullName })),
    classroomId: (classrooms.data ?? []).map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
  };
  return (
    <div className="grid gap-3">
      {params.map((p) =>
        p === 'groupIds' ? (
          <Field key={p} label={LABELS[p]} required>
            <GroupsPicker
              value={value.groupIds ?? ''}
              options={options.groupId}
              onChange={(v) => set('groupIds', v)}
            />
          </Field>
        ) : p === 'from' || p === 'to' ? (
          <Field
            key={p}
            label={source === 'schedule-week' && p === 'from' ? 'Неделя (любой день)' : LABELS[p]}
            hint={!value[p] ? (source === 'schedule-week' ? 'Пусто — текущая неделя' : 'Пусто — по умолчанию отчёта') : undefined}
          >
            <Input type="date" value={value[p] ?? ''} onChange={(e) => set(p, e.target.value)} />
          </Field>
        ) : (
          <Field key={p} label={LABELS[p] ?? p} required={required === p}>
            <SimpleSelect
              value={value[p]}
              onChange={(v) => set(p, v)}
              allowEmpty={required !== p}
              emptyLabel="Все"
              placeholder="Выберите…"
              options={options[p] ?? []}
            />
          </Field>
        ),
      )}
    </div>
  );
}

/** Выбор нескольких групп с сохранением порядка: столбцы бланка слева направо */
export function GroupsPicker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (next: string) => void;
}) {
  const ids = value.split(',').filter(Boolean);
  const label = (id: string) => options.find((o) => o.value === id)?.label ?? '…';
  return (
    <div className="grid gap-2">
      {ids.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {ids.map((id, i) => (
            <span key={id} className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs">
              <span className="text-primary/60 tabular-nums">{i + 1}.</span> {label(id)}
              <button
                type="button"
                className="hover:text-destructive ml-0.5 cursor-pointer"
                aria-label={`Убрать ${label(id)}`}
                onClick={() => onChange(ids.filter((x) => x !== id).join(','))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <SimpleSelect
        value={null}
        onChange={(v) => v && onChange([...ids, v].join(','))}
        placeholder={ids.length ? 'Добавить группу…' : 'Выберите группы…'}
        options={options.filter((o) => !ids.includes(o.value))}
      />
    </div>
  );
}
