import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, FilePlus2, FileSpreadsheet, Pencil, Sheet, Trash2 } from 'lucide-react';
import { Confirm } from '@/components/common/confirm';
import { Field } from '@/components/common/field';
import { PageHeader } from '@/components/common/page-header';
import { SimpleSelect } from '@/components/common/simple-select';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { useApi, useApiMutation } from '@/lib/query';
import { emptyForm, formFromSource, type FormSources, type ReportFormRecord } from '@/lib/report-form';

type FormListItem = Omit<ReportFormRecord, 'content'>;

/** Формы отчётов: свои бланки «как в Excel» с полями из данных расписания и нагрузки */
export default function ReportFormsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'DISPATCHER';
  const navigate = useNavigate();
  const forms = useApi<FormListItem[]>(['report-forms'], '/report-forms');
  const sources = useApi<FormSources>(['report-form-sources'], '/report-forms/sources', undefined, { staleTime: 10 * 60_000 });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [start, setStart] = useState<string | null>(null);

  const sourceTitle = (type: string | null) => (type ? (sources.data?.sources.find((s) => s.type === type)?.title ?? type) : 'Без источника');

  const create = useApiMutation(
    () => {
      const source = sources.data?.sources.find((s) => s.type === start);
      const content = source ? formFromSource(source) : emptyForm();
      return api.post<ReportFormRecord>('/report-forms', { name: name.trim() || source?.title || 'Новая форма', content });
    },
    {
      invalidate: [['report-forms']],
      onSuccess: (f) => {
        setCreating(false);
        navigate(`/reports/forms/${f.id}`);
      },
    },
  );
  const remove = useApiMutation((id: string) => api.delete(`/report-forms/${id}`), {
    success: 'Форма удалена',
    invalidate: [['report-forms']],
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Формы отчётов"
        description="Свои бланки отчётов в табличном редакторе: ячейки, объединения, границы и поля из данных программы"
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/reports">
                <ArrowLeft /> К отчётам
              </Link>
            </Button>
            {canEdit && (
              <Button
                onClick={() => {
                  setName('');
                  setStart(null);
                  setCreating(true);
                }}
              >
                <FilePlus2 /> Новая форма
              </Button>
            )}
          </>
        }
      />
      {forms.isLoading ? (
        <LoadingState rows={3} />
      ) : forms.error ? (
        <ErrorState error={forms.error} onRetry={() => forms.refetch()} />
      ) : !forms.data?.length ? (
        <EmptyState
          title="Форм пока нет"
          description="Создайте пустой лист или начните с готового отчёта — шапка, заголовки столбцов и строка данных заполнятся сами"
          action={
            canEdit && (
              <Button onClick={() => setCreating(true)}>
                <FilePlus2 /> Новая форма
              </Button>
            )
          }
        />
      ) : (
        <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {forms.data.map((f) => (
            <div key={f.id} className="lift bg-card flex flex-col rounded-2xl border border-border/70 p-4 shadow-soft">
              <Link to={`/reports/forms/${f.id}`} className="flex min-w-0 items-start gap-3">
                <div className="bg-primary/10 text-primary grid size-10 shrink-0 place-items-center rounded-xl">
                  <Sheet className="size-5" />
                </div>
                <div className="min-w-0">
                  <div className="truncate font-medium">{f.name}</div>
                  <div className="text-muted-foreground mt-0.5 text-xs">{sourceTitle(f.dataSource)}</div>
                  {f.description && <div className="text-muted-foreground mt-1 line-clamp-2 text-xs">{f.description}</div>}
                </div>
              </Link>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs">Изменена {formatDate(f.updatedAt.slice(0, 10))}</span>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon-sm" asChild title={canEdit ? 'Открыть редактор' : 'Открыть'}>
                    <Link to={`/reports/forms/${f.id}`}>{canEdit ? <Pencil /> : <FileSpreadsheet />}</Link>
                  </Button>
                  {canEdit && (
                    <Confirm
                      trigger={
                        <Button variant="ghost" size="icon-sm" title="Удалить" className="text-destructive">
                          <Trash2 />
                        </Button>
                      }
                      title={`Удалить форму «${f.name}»?`}
                      description="Форма будет удалена без возможности восстановления. Данные расписания не затрагиваются."
                      confirmText="Удалить"
                      destructive
                      onConfirm={() => remove.mutateAsync(f.id)}
                    />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новая форма отчёта</DialogTitle>
            <DialogDescription>Начните с пустого листа или с готового отчёта — потом всё можно поменять</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Название">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, «Ведомость нагрузки для бухгалтерии»" autoFocus />
            </Field>
            <Field label="Начать с" hint={start ? 'Шапка, заголовки столбцов и строка данных будут заполнены' : 'Пустой лист 30 × 10'}>
              <SimpleSelect
                value={start}
                onChange={setStart}
                allowEmpty
                emptyLabel="Пустого листа"
                options={(sources.data?.sources ?? []).map((s) => ({ value: s.type, label: `Отчёта «${s.title}»` }))}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Отмена
            </Button>
            <Button onClick={() => create.mutate(undefined)} disabled={create.isPending}>
              Создать и открыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
