import { Field } from '@/components/common/field';
import { SimpleSelect } from '@/components/common/simple-select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { STUDY_FORM_LABELS } from '@/lib/labels';
import type { StudyForm } from '@/lib/types';
import type { Draft } from './types';

/** Шаг 1: сведения титульного листа — специальность и учебный план */
export function ReviewGeneral({ draft, onChange }: { draft: Draft; onChange: (draft: Draft) => void }) {
  const s = draft.specialty;
  const p = draft.program;
  const setSpecialty = (patch: Partial<Draft['specialty']>) => onChange({ ...draft, specialty: { ...s, ...patch } });
  const setProgram = (patch: Partial<Draft['program']>) => onChange({ ...draft, program: { ...p, ...patch } });
  const codeError = s.code && !/^\d{2}\.\d{2}\.\d{2}$/.test(s.code) ? 'Формат кода: 00.00.00' : undefined;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Специальность</CardTitle>
          <CardDescription>Распознано с титульного листа. Если специальность уже есть в системе, будет использована она.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Код" required error={!s.code ? 'Укажите код специальности' : codeError}>
            <Input value={s.code} placeholder="40.02.04" onChange={(e) => setSpecialty({ code: e.target.value.trim() })} />
          </Field>
          <Field label="Наименование" required error={!s.name ? 'Укажите наименование' : undefined}>
            <Input value={s.name} placeholder="Юриспруденция" onChange={(e) => setSpecialty({ name: e.target.value })} />
          </Field>
          <Field label="Квалификация" required error={!s.qualification ? 'Укажите квалификацию' : undefined} className="sm:col-span-2">
            <Input value={s.qualification} placeholder="Юрист" onChange={(e) => setSpecialty({ qualification: e.target.value })} />
          </Field>
          <Field label="Приказ ФГОС, №">
            <Input value={s.fgosNumber ?? ''} onChange={(e) => setSpecialty({ fgosNumber: e.target.value || undefined })} />
          </Field>
          <Field label="Дата приказа ФГОС">
            <Input type="date" value={s.fgosDate ?? ''} onChange={(e) => setSpecialty({ fgosDate: e.target.value || undefined })} />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Учебный план</CardTitle>
          <CardDescription>Будет создан новый учебный план в статусе «Черновик».</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Название" className="sm:col-span-2" hint="Как план будет называться в списках">
            <Input value={p.title} onChange={(e) => setProgram({ title: e.target.value })} />
          </Field>
          <Field label="Год начала подготовки" required>
            <Input
              type="number"
              min={2000}
              max={2100}
              value={p.admissionYear}
              onChange={(e) => setProgram({ admissionYear: Number(e.target.value) })}
            />
          </Field>
          <Field label="Форма обучения">
            <SimpleSelect
              value={p.studyForm}
              onChange={(v) => setProgram({ studyForm: (v ?? 'FULL_TIME') as StudyForm })}
              options={Object.entries(STUDY_FORM_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </Field>
          <Field label="Срок обучения, месяцев" hint={`${Math.floor(p.durationMonths / 12)} г. ${p.durationMonths % 12} мес.`}>
            <Input
              type="number"
              min={1}
              max={120}
              value={p.durationMonths}
              onChange={(e) => setProgram({ durationMonths: Number(e.target.value) })}
            />
          </Field>
          <Field label="Семестров">
            <Input value={draft.semesters.length} disabled />
          </Field>
        </CardContent>
      </Card>
    </div>
  );
}

export function generalErrors(draft: Draft): string[] {
  const errors: string[] = [];
  if (!/^\d{2}\.\d{2}\.\d{2}$/.test(draft.specialty.code)) errors.push('Код специальности в формате 00.00.00');
  if (!draft.specialty.name.trim()) errors.push('Наименование специальности');
  if (!draft.specialty.qualification.trim()) errors.push('Квалификация');
  if (!draft.program.admissionYear || draft.program.admissionYear < 2000) errors.push('Год начала подготовки');
  if (!draft.program.durationMonths) errors.push('Срок обучения');
  return errors;
}
