import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { FileSpreadsheet, FileText, Play } from 'lucide-react';
import { toast } from 'sonner';
import { DataTable } from '@/components/common/data-table';
import { Field } from '@/components/common/field';
import { PageHeader } from '@/components/common/page-header';
import { SimpleSelect } from '@/components/common/simple-select';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useClassrooms, useGroups, usePrograms, useSemesters, useTeachers } from '@/hooks/use-reference';
import { downloadFile, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { addDays, formatDate, formatNumber, today, weekStart } from '@/lib/format';
import { useApi } from '@/lib/query';
import type { ReportTable } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ReportType {
  type: string;
  title: string;
  description: string;
  params: string[];
}

type Params = Record<string, string | undefined>;

export default function ReportsPage() {
  const { user } = useAuth();
  const isTeacher = user?.role === 'TEACHER';
  const types = useApi<ReportType[]>(['report-types'], '/reports');
  const [type, setType] = useState<string | null>(null);
  const [draft, setDraft] = useState<Params>({ from: weekStart(today()), to: addDays(weekStart(today()), 6) });
  const [applied, setApplied] = useState<Params | null>(null);
  const programs = usePrograms(!isTeacher);
  const semesters = useSemesters(!isTeacher);
  const groups = useGroups(!isTeacher);
  const teachers = useTeachers(!isTeacher);
  const classrooms = useClassrooms(!isTeacher);

  const available = (types.data ?? []).filter((t) => !isTeacher || t.type === 'teacher-schedule');
  const current = available.find((t) => t.type === type);
  const query = useMemo(() => {
    if (!current || !applied) return undefined;
    const q: Params = {};
    for (const p of current.params) if (applied[p]) q[p] = applied[p];
    if (isTeacher && user?.teacherId) q.teacherId = user.teacherId;
    return q;
  }, [current, applied, isTeacher, user]);
  const report = useApi<ReportTable>(['report', type, query], current && query ? `/reports/${current.type}` : null, query);

  const exportAs = async (format: 'xlsx' | 'pdf') => {
    if (!current || !query) return;
    try {
      await downloadFile(`/reports/${current.type}/export`, { ...query, format }, `${current.title}.${format}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns: ColumnDef<Record<string, string | number | null>>[] = useMemo(
    () =>
      (report.data?.columns ?? []).map((c) => ({
        id: c.key,
        accessorFn: (row: Record<string, string | number | null>) => row[c.key],
        header: c.header,
        meta: { className: c.type === 'number' || c.type === 'percent' ? 'text-right tabular-nums' : undefined },
        cell: ({ getValue }: { getValue: () => unknown }) => {
          const v = getValue() as string | number | null;
          if (v === null || v === undefined || v === '') return '—';
          if (c.type === 'date') return formatDate(String(v));
          if (c.type === 'percent') return `${formatNumber(Number(v), 1)}%`;
          if (c.type === 'number') return formatNumber(Number(v), 1);
          return String(v);
        },
      })),
    [report.data],
  );

  const set = (k: string, v: string | null | undefined) => setDraft((d) => ({ ...d, [k]: v ?? undefined }));
  const paramInput = (p: string) => {
    switch (p) {
      case 'from':
        return (
          <Field key={p} label="С даты">
            <Input type="date" value={draft.from ?? ''} onChange={(e) => set('from', e.target.value)} />
          </Field>
        );
      case 'to':
        return (
          <Field key={p} label="По дату">
            <Input type="date" value={draft.to ?? ''} onChange={(e) => set('to', e.target.value)} />
          </Field>
        );
      case 'programId':
        return (
          <Field key={p} label="Учебный план">
            <SimpleSelect value={draft.programId} onChange={(v) => set('programId', v)} allowEmpty emptyLabel="Все" options={(programs.data ?? []).map((x) => ({ value: x.id, label: x.title }))} />
          </Field>
        );
      case 'semesterId':
        return (
          <Field key={p} label="Семестр">
            <SimpleSelect
              value={draft.semesterId}
              onChange={(v) => set('semesterId', v)}
              allowEmpty
              emptyLabel="Все"
              options={(semesters.data ?? [])
                .filter((s) => !draft.programId || s.educationalProgramId === draft.programId)
                .map((s) => ({ value: s.id, label: `${s.program?.title ?? ''} · ${s.number} сем.` }))}
            />
          </Field>
        );
      case 'groupId':
        return (
          <Field key={p} label="Группа">
            <SimpleSelect
              value={draft.groupId}
              onChange={(v) => set('groupId', v)}
              allowEmpty={current?.type !== 'group-schedule'}
              emptyLabel="Все"
              options={(groups.data ?? []).map((g) => ({ value: g.id, label: g.code }))}
            />
          </Field>
        );
      case 'teacherId':
        return isTeacher ? null : (
          <Field key={p} label="Преподаватель">
            <SimpleSelect
              value={draft.teacherId}
              onChange={(v) => set('teacherId', v)}
              allowEmpty={current?.type !== 'teacher-schedule'}
              emptyLabel="Все"
              options={(teachers.data ?? []).map((t) => ({ value: t.id, label: t.fullName }))}
            />
          </Field>
        );
      case 'classroomId':
        return (
          <Field key={p} label="Аудитория">
            <SimpleSelect
              value={draft.classroomId}
              onChange={(v) => set('classroomId', v)}
              options={(classrooms.data ?? []).map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))}
            />
          </Field>
        );
      default:
        return null;
    }
  };

  const missingRequired =
    !!current &&
    ((current.type === 'group-schedule' && !draft.groupId) ||
      (current.type === 'teacher-schedule' && !draft.teacherId && !isTeacher) ||
      (current.type === 'classroom-schedule' && !draft.classroomId));

  return (
    <div className="space-y-5">
      <PageHeader title="Отчёты" description="Сводные отчёты с выгрузкой в Excel и PDF" />
      {types.isLoading ? (
        <LoadingState rows={4} />
      ) : types.error ? (
        <ErrorState error={types.error} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {available.map((t) => (
            <button
              key={t.type}
              type="button"
              onClick={() => {
                setType(t.type);
                setApplied(null);
              }}
              className={cn(
                'bg-card hover:border-primary/50 rounded-lg border p-4 text-left transition',
                type === t.type && 'border-primary ring-primary/30 ring-2',
              )}
            >
              <div className="font-medium">{t.title}</div>
              <div className="text-muted-foreground mt-1 text-xs">{t.description}</div>
            </button>
          ))}
        </div>
      )}
      {current && (
        <Card>
          <CardHeader>
            <CardTitle>{current.title}</CardTitle>
            <CardDescription>{current.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {current.params.map(paramInput)}
              <Button onClick={() => setApplied({ ...draft })} disabled={missingRequired}>
                <Play /> Сформировать
              </Button>
            </div>
            {missingRequired && <div className="text-muted-foreground text-sm">Выберите обязательный параметр отчёта</div>}
            {query && (
              <>
                {report.isLoading ? (
                  <LoadingState rows={6} />
                ) : report.error ? (
                  <ErrorState error={report.error} onRetry={() => report.refetch()} />
                ) : (
                  report.data && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-medium">{report.data.title}</div>
                          {report.data.subtitle && <div className="text-muted-foreground text-sm">{report.data.subtitle}</div>}
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" onClick={() => exportAs('xlsx')}>
                            <FileSpreadsheet /> Excel
                          </Button>
                          <Button variant="outline" onClick={() => exportAs('pdf')}>
                            <FileText /> PDF
                          </Button>
                        </div>
                      </div>
                      {report.data.summary && report.data.summary.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {report.data.summary.map((s) => (
                            <div key={s.label} className="bg-muted/50 rounded-md px-3 py-1.5 text-sm">
                              <span className="text-muted-foreground">{s.label}: </span>
                              <span className="font-semibold">{s.value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <DataTable data={report.data.rows} columns={columns} pageSize={100} dense emptyText="Нет данных за выбранный период" />
                    </div>
                  )
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
