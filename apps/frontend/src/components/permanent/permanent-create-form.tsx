import { useEffect, useState, type ReactNode } from 'react';
import { Field } from '@/components/common/field';
import { Spinner } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { formatDate, today } from '@/lib/format';
import { EDUCATION_LEVEL_LABELS } from '@/lib/labels';
import { useApiMutation } from '@/lib/query';
import { cn } from '@/lib/utils';

/**
 * Форма запуска постоянного расписания (типовой недели): название, дата семестра и уровни образования.
 * Используется в диалоге на странице постоянного расписания и в «Составлении» при выборе «Постоянное».
 * resetKey меняется — поля сбрасываются к значениям по умолчанию.
 */
export function PermanentCreateForm({
  resetKey,
  onCreated,
  extraActions,
  submitLabel = 'Создать и сформировать',
  className,
}: {
  resetKey?: unknown;
  onCreated: (id: string) => void;
  extraActions?: ReactNode;
  submitLabel?: string;
  className?: string;
}) {
  const [title, setTitle] = useState(`Постоянное расписание на ${formatDate(today())}`);
  const [date, setDate] = useState(today());
  const [levels, setLevels] = useState<string[]>([]);
  useEffect(() => {
    setTitle(`Постоянное расписание на ${formatDate(today())}`);
    setDate(today());
    setLevels([]);
  }, [resetKey]);
  const create = useApiMutation(
    () =>
      api.post<{ id: string }>('/permanent-schedules', {
        title,
        date,
        educationLevels: levels.length ? levels : undefined,
      }),
    {
      success: 'Создано, сетка формируется',
      invalidate: [['permanent-schedules']],
      onSuccess: (r) => onCreated(r.id),
    },
  );
  return (
    <form
      className={cn('space-y-4', className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim() && !create.isPending) create.mutate(undefined);
      }}
    >
      <Field label="Название">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </Field>
      <Field label="Дата" hint="Любой день семестра, для которого составляется сетка">
        <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </Field>
      <Field label="Уровни образования" hint="Ничего не выбрано — все группы">
        <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
          {Object.entries(EDUCATION_LEVEL_LABELS).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={levels.includes(value)}
                onCheckedChange={(v) => setLevels((prev) => (v ? [...prev, value] : prev.filter((x) => x !== value)))}
              />
              {label}
            </label>
          ))}
        </div>
      </Field>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {extraActions}
        <Button type="submit" disabled={!title.trim() || create.isPending}>
          {create.isPending && <Spinner />} {submitLabel}
        </Button>
      </div>
    </form>
  );
}
