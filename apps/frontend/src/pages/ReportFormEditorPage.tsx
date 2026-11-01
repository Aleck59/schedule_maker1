import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Eye, FileSpreadsheet, FileText, PencilRuler, RefreshCw, Save, Search, TableProperties } from 'lucide-react';
import { toast } from 'sonner';
import { Field } from '@/components/common/field';
import { SimpleSelect } from '@/components/common/simple-select';
import { ErrorState, LoadingState, Spinner } from '@/components/common/states';
import { SheetEditor, type SheetEditorHandle } from '@/components/report-forms/sheet-editor';
import { SheetPreview } from '@/components/report-forms/sheet-preview';
import { REQUIRED_PARAM, SourceParams } from '@/components/report-forms/source-params';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, downloadPost, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi, useApiMutation } from '@/lib/query';
import type { FormSources, RenderedSheet, ReportFormContent, ReportFormRecord } from '@/lib/report-form';
import { cn } from '@/lib/utils';

interface History {
  past: ReportFormContent[];
  present: ReportFormContent;
  future: ReportFormContent[];
  tag?: string;
}

const HISTORY_LIMIT = 100;

export default function ReportFormEditorPage() {
  const { id } = useParams<{ id: string }>();
  const record = useApi<ReportFormRecord>(['report-form', id], id ? `/report-forms/${id}` : null, undefined, {
    staleTime: 0,
  });
  if (record.isLoading) return <LoadingState rows={8} />;
  if (record.error || !record.data)
    return <ErrorState error={record.error} back={{ to: '/reports/forms', label: 'К формам отчётов' }} />;
  return <Editor key={record.data.id} record={record.data} />;
}

function Editor({ record }: { record: ReportFormRecord }) {
  const { user } = useAuth();
  const readOnly = !(user?.role === 'ADMIN' || user?.role === 'DISPATCHER');
  const sources = useApi<FormSources>(['report-form-sources'], '/report-forms/sources', undefined, { staleTime: 10 * 60_000 });
  const [name, setName] = useState(record.name);
  const [description, setDescription] = useState(record.description ?? '');
  const [hist, setHist] = useState<History>({ past: [], present: record.content, future: [] });
  const [saved, setSaved] = useState({ content: record.content, name: record.name, description: record.description ?? '' });
  const [tab, setTab] = useState('edit');
  const [preview, setPreview] = useState<RenderedSheet | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [filter, setFilter] = useState('');
  const sheet = useRef<SheetEditorHandle>(null);
  const form = hist.present;

  const dirty = form !== saved.content || name !== saved.name || description !== saved.description;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const change = useCallback((next: ReportFormContent, tag?: string) => {
    setHist((h) => {
      if (tag && h.tag === tag) return { ...h, present: next };
      return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [], tag };
    });
  }, []);
  const undo = useCallback(
    () =>
      setHist((h) =>
        h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h,
      ),
    [],
  );
  const redo = useCallback(
    () => setHist((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h)),
    [],
  );

  const source = sources.data?.sources.find((s) => s.type === form.dataSource) ?? null;
  const missing = source && REQUIRED_PARAM[source.type] && !form.params[REQUIRED_PARAM[source.type]];

  const save = useApiMutation(
    () => api.put<ReportFormRecord>(`/report-forms/${record.id}`, { name: name.trim() || 'Без названия', description: description || null, content: form }),
    {
      success: 'Форма сохранена',
      invalidate: [['report-forms']],
      onSuccess: () => setSaved({ content: form, name, description }),
    },
  );

  // Ctrl+S — сохранить
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'ы')) {
        e.preventDefault();
        if (!readOnly && dirty && !save.isPending) save.mutate(undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [readOnly, dirty, save]);

  const refreshPreview = useCallback(async () => {
    if (missing) return;
    setPreviewing(true);
    try {
      setPreview(await api.post<RenderedSheet>('/report-forms/render', { content: form, params: form.params }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPreviewing(false);
    }
  }, [form, missing]);

  useEffect(() => {
    if (tab === 'preview') void refreshPreview();
    // предпросмотр обновляется при открытии вкладки; дальше — кнопкой
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const exportAs = async (format: 'xlsx' | 'pdf') => {
    if (missing) {
      toast.error('Выберите обязательный параметр источника данных');
      return;
    }
    try {
      await downloadPost('/report-forms/export', { content: form, params: form.params, name: name.trim(), format }, `${name}.${format}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const fieldGroups = useMemo(() => {
    const groups: Array<{ title: string; hint?: string; items: Array<{ key: string; label: string }> }> = [];
    if (source && source.columns.length > 0) {
      groups.push({
        title: 'Строка данных',
        hint: 'Ставьте в строку, отмеченную как «Строка данных» — она повторится для каждой записи',
        items: [{ key: 'row.#', label: '№ по порядку' }, ...source.columns.map((c) => ({ key: `row.${c.key}`, label: c.header }))],
      });
      const numeric = source.columns.filter((c) => c.type === 'number' || c.type === 'percent');
      groups.push({
        title: 'Итоги',
        items: [
          { key: 'count', label: 'Количество строк' },
          ...numeric.map((c) => ({ key: `sum.${c.key}`, label: `Сумма: ${c.header}` })),
          ...numeric.map((c) => ({ key: `avg.${c.key}`, label: `Среднее: ${c.header}` })),
        ],
      });
    }
    if (source?.fields?.length) {
      groups.push({
        title: 'Поля бланка',
        hint: 'g1, g2… — группы по порядку; d1…d6 — дни недели; p1, p2… — номер пары. Например {{g2.d3.p1.room}}',
        items: source.fields,
      });
    }
    groups.push({ title: 'Общие', items: (sources.data?.common ?? []).filter((f) => (source && source.columns.length > 0) || f.key !== 'count') });
    const q = filter.trim().toLowerCase();
    return groups
      .map((g) => ({ ...g, items: q ? g.items.filter((i) => i.label.toLowerCase().includes(q) || i.key.toLowerCase().includes(q)) : g.items }))
      .filter((g) => g.items.length);
  }, [source, sources.data, filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon" asChild title="К формам отчётов">
            <Link to="/reports/forms">
              <ArrowLeft />
            </Link>
          </Button>
          <Input
            aria-label="Название формы"
            value={name}
            readOnly={readOnly}
            onChange={(e) => setName(e.target.value)}
            className="h-10 max-w-xl border-transparent bg-transparent text-xl font-semibold shadow-none hover:border-border focus-visible:bg-card"
          />
          {dirty && !readOnly && <Badge variant="secondary">Не сохранено</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => exportAs('xlsx')}>
            <FileSpreadsheet /> Excel
          </Button>
          <Button variant="outline" onClick={() => exportAs('pdf')}>
            <FileText /> PDF
          </Button>
          {!readOnly && (
            <Button onClick={() => save.mutate(undefined)} disabled={!dirty || save.isPending} title="Сохранить (Ctrl+S)">
              {save.isPending ? <Spinner /> : <Save />} Сохранить
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Tabs value={tab} onValueChange={setTab} className="min-w-0">
          <TabsList>
            <TabsTrigger value="edit">
              <PencilRuler /> Редактор
            </TabsTrigger>
            <TabsTrigger value="preview">
              <Eye /> Предпросмотр с данными
            </TabsTrigger>
          </TabsList>
          <TabsContent value="edit" className="mt-3">
            <SheetEditor
              ref={sheet}
              form={form}
              onChange={change}
              onUndo={undo}
              onRedo={redo}
              canUndo={hist.past.length > 0}
              canRedo={hist.future.length > 0}
              readOnly={readOnly}
            />
          </TabsContent>
          <TabsContent value="preview" className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-muted-foreground text-sm">
                {source ? `Данные: ${source.title}` : 'Источник данных не выбран — выводятся только общие поля'}
              </div>
              <Button variant="outline" size="sm" onClick={() => void refreshPreview()} disabled={previewing || !!missing}>
                <RefreshCw className={cn(previewing && 'animate-spin')} /> Обновить
              </Button>
            </div>
            {missing ? (
              <div className="bg-warning/10 text-warning-foreground flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                <AlertTriangle className="size-4" /> Выберите обязательный параметр источника справа
              </div>
            ) : previewing && !preview ? (
              <LoadingState rows={6} />
            ) : (
              preview && (
                <>
                  {preview.unknownFields.length > 0 && (
                    <div className="bg-destructive/8 text-destructive flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-sm">
                      <AlertTriangle className="size-4" /> Неизвестные поля:
                      {preview.unknownFields.map((f) => (
                        <code key={f} className="bg-card rounded px-1">{`{{${f}}}`}</code>
                      ))}
                    </div>
                  )}
                  <SheetPreview sheet={preview} />
                </>
              )
            )}
          </TabsContent>
        </Tabs>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Источник данных</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <SimpleSelect
                value={form.dataSource}
                onChange={(v) => change({ ...form, dataSource: v, params: {} })}
                allowEmpty
                emptyLabel="Без источника (бланк)"
                disabled={readOnly}
                options={(sources.data?.sources ?? []).map((s) => ({ value: s.type, label: s.title }))}
              />
              {source && (
                <>
                  <p className="text-muted-foreground text-xs">{source.description}</p>
                  <SourceParams
                    source={source.type}
                    params={source.params}
                    value={form.params}
                    onChange={(params) => change({ ...form, params }, 'params')}
                  />
                </>
              )}
              <Field label="Ориентация листа">
                <SimpleSelect
                  value={form.orientation}
                  onChange={(v) => change({ ...form, orientation: v === 'landscape' ? 'landscape' : 'portrait' })}
                  disabled={readOnly}
                  options={[
                    { value: 'portrait', label: 'Книжная' },
                    { value: 'landscape', label: 'Альбомная' },
                  ]}
                />
              </Field>
              <Field label="Описание">
                <Input value={description} readOnly={readOnly} onChange={(e) => setDescription(e.target.value)} placeholder="Для кого и зачем эта форма" />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Поля</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground text-xs">
                Щёлкните поле — оно встанет в выделенную ячейку. Можно писать и вручную: <code>{'{{row.teacher}}'}</code>
              </p>
              {source && source.columns.length > 0 && !readOnly && (
                <Button variant="outline" size="sm" className="w-full" onClick={() => sheet.current?.insertTable(source.columns)} title="С выделенной ячейки: строка заголовков и под ней строка данных">
                  <TableProperties /> Вставить таблицу целиком
                </Button>
              )}
              <div className="relative">
                <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
                <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Найти поле" className="pl-8" />
              </div>
              <div className="max-h-[46vh] space-y-3 overflow-auto pr-1">
                {fieldGroups.map((g) => (
                  <div key={g.title}>
                    <div className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">{g.title}</div>
                    {g.hint && <div className="text-muted-foreground mb-1.5 text-[11px] leading-snug">{g.hint}</div>}
                    <div className="flex flex-wrap gap-1">
                      {g.items.map((f) => (
                        <button
                          key={f.key}
                          type="button"
                          disabled={readOnly}
                          title={`{{${f.key}}}`}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => sheet.current?.insert(`{{${f.key}}}`)}
                          className="bg-primary/8 text-primary hover:bg-primary/15 cursor-pointer rounded-lg px-2 py-1 text-left text-xs transition-colors disabled:cursor-default disabled:opacity-60"
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
