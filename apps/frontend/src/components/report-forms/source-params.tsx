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
  teacherId: 'Преподаватель',
  classroomId: 'Аудитория',
};

/** Обязательные параметры источников (без них отчёт не строится) */
export const REQUIRED_PARAM: Record<string, string> = {
  'group-schedule': 'groupId',
  'teacher-schedule': 'teacherId',
  'classroom-schedule': 'classroomId',
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
  const groups = useGroups(need('groupId'));
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
        p === 'from' || p === 'to' ? (
          <Field key={p} label={LABELS[p]} hint={!value[p] ? 'Пусто — по умолчанию отчёта' : undefined}>
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
