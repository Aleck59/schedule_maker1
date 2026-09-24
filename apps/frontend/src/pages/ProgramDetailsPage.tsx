import { Fragment, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Download, FileUp, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Confirm } from '@/components/common/confirm';
import { Field } from '@/components/common/field';
import { PageHeader } from '@/components/common/page-header';
import { SimpleSelect } from '@/components/common/simple-select';
import { ErrorState, LoadingState, Spinner } from '@/components/common/states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, downloadFile, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import {
  CLASSROOM_TYPE_LABELS,
  CONTROL_FORM_LABELS,
  ITEM_TYPE_LABELS,
  PROGRAM_STATUS_LABELS,
  STUDY_FORM_LABELS,
} from '@/lib/labels';
import { useApi, useApiMutation } from '@/lib/query';
import type { ClassroomType, CurriculumItemType, CurriculumNode, CurriculumTree, Program, Semester, SemesterItem } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ImportResult {
  cyclesCreated: number;
  itemsCreated: number;
  itemsUpdated: number;
  semesterRows: number;
  errors: Array<{ row: number; message: string }>;
}

/** Типы элементов, для которых часы ставятся в расписание не автоматически */
const NOT_SCHEDULED: CurriculumItemType[] = ['INDUSTRIAL_PRACTICE', 'PRE_DIPLOMA_PRACTICE', 'FINAL_ATTESTATION'];

export default function ProgramDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const program = useApi<Program>(['program', id], `/programs/${id}`);
  const tree = useApi<CurriculumTree>(['curriculum', id], `/programs/${id}/curriculum`);
  const semesters = useApi<Semester[]>(['program-semesters', id], `/programs/${id}/semesters`);
  const [itemId, setItemId] = useState<string | null>(null);
  const [newItem, setNewItem] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [editSemester, setEditSemester] = useState<Semester | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const importPlan = useApiMutation((file: File) => api.upload<ImportResult>(`/programs/${id}/import`, file), {
    success: (r) => `Импорт завершён: создано ${r.itemsCreated}, обновлено ${r.itemsUpdated}`,
    invalidate: [['curriculum', id], ['program', id], ['programs'], ['program-semesters', id]],
    onSuccess: (r) => setImportResult(r),
  });
  const setStatus = useApiMutation((status: string) => api.patch(`/programs/${id}`, { status }), {
    success: 'Статус изменён',
    invalidate: [['program', id], ['programs']],
  });
  const remove = useApiMutation(() => api.delete(`/programs/${id}`), {
    success: 'Учебный план удалён',
    invalidate: [['programs']],
    onSuccess: () => navigate('/programs'),
  });

  if (program.isLoading) return <LoadingState rows={8} />;
  if (program.error) return <ErrorState error={program.error} onRetry={() => program.refetch()} />;
  const p = program.data!;

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link to="/programs">
          <ArrowLeft /> Учебные планы
        </Link>
      </Button>
      <PageHeader
        title={p.title}
        description={
          <>
            {p.specialty.code} {p.specialty.name} · квалификация «{p.specialty.qualification}» · {STUDY_FORM_LABELS[p.studyForm]} форма ·{' '}
            {Math.floor(p.durationMonths / 12)} г. {p.durationMonths % 12} мес. · {p.totalSemesters} семестров
          </>
        }
        actions={
          <>
            <Badge variant={p.status === 'APPROVED' ? 'success' : 'muted'} className="h-7">
              {PROGRAM_STATUS_LABELS[p.status]}
            </Badge>
            <Button
              variant="outline"
              onClick={() => downloadFile(`/programs/${id}/export/hour-control/excel`, undefined, 'Выполнение_часов.xlsx').catch((e) => toast.error(errorMessage(e)))}
            >
              <Download /> Выполнение часов
            </Button>
            {canEdit && (
              <>
                <Button variant="outline" onClick={() => downloadFile('/programs/import-template', undefined, 'Шаблон.xlsx').catch((e) => toast.error(errorMessage(e)))}>
                  <Download /> Шаблон импорта
                </Button>
                <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={importPlan.isPending}>
                  {importPlan.isPending ? <Spinner /> : <FileUp />} Импорт из Excel
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importPlan.mutate(f);
                    e.target.value = '';
                  }}
                />
                {p.status !== 'APPROVED' ? (
                  <Button onClick={() => setStatus.mutate('APPROVED')}>Утвердить</Button>
                ) : (
                  <Button variant="outline" onClick={() => setStatus.mutate('DRAFT')}>
                    В черновик
                  </Button>
                )}
                <Confirm
                  trigger={
                    <Button variant="ghost" size="icon" aria-label="Удалить учебный план">
                      <Trash2 />
                    </Button>
                  }
                  title="Удалить учебный план?"
                  description="Удаление возможно, только если к плану не привязаны группы и расписание."
                  destructive
                  confirmText="Удалить"
                  onConfirm={() => remove.mutate(undefined)}
                />
              </>
            )}
          </>
        }
      />

      {importResult && (
        <Alert variant={importResult.errors.length ? 'warning' : 'success'}>
          <AlertTitle>
            Импорт: циклов {importResult.cyclesCreated}, новых элементов {importResult.itemsCreated}, обновлено {importResult.itemsUpdated}, строк
            семестров {importResult.semesterRows}
          </AlertTitle>
          {importResult.errors.length > 0 && (
            <AlertDescription>
              <ul className="list-disc pl-4">
                {importResult.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>{e.message}</li>
                ))}
              </ul>
            </AlertDescription>
          )}
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <HoursTile title="Лекции" value={p.hours.lecture} />
        <HoursTile title="Практические" value={p.hours.practical} />
        <HoursTile title="Лабораторные" value={p.hours.laboratory} />
        <HoursTile title="Консультации / практика" value={`${p.hours.consultation} / ${p.hours.practice}`} />
      </div>

      <Tabs defaultValue="plan">
        <TabsList>
          <TabsTrigger value="plan">Учебный план</TabsTrigger>
          <TabsTrigger value="semesters">Семестры</TabsTrigger>
          <TabsTrigger value="groups">Группы</TabsTrigger>
        </TabsList>
        <TabsContent value="plan" className="space-y-3">
          {canEdit && (
            <Button onClick={() => setNewItem(true)}>
              <Plus /> Элемент плана
            </Button>
          )}
          {tree.isLoading ? <LoadingState rows={8} /> : tree.error ? <ErrorState error={tree.error} /> : <CurriculumTable tree={tree.data!} onItemClick={setItemId} />}
        </TabsContent>
        <TabsContent value="semesters">
          <Card>
            <CardContent className="pt-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Семестр</TableHead>
                    <TableHead>Курс</TableHead>
                    <TableHead>Учебный год</TableHead>
                    <TableHead>Даты</TableHead>
                    <TableHead className="text-right">Нед. теории</TableHead>
                    <TableHead className="text-right">Нед. аттестации</TableHead>
                    <TableHead className="text-right">Нед. практики</TableHead>
                    <TableHead className="text-right">Нед. каникул</TableHead>
                    <TableHead className="text-right">Аудиторных ч</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(semesters.data ?? []).map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.number}</TableCell>
                      <TableCell>{s.courseNumber}</TableCell>
                      <TableCell>{s.academicYear?.title}</TableCell>
                      <TableCell>
                        {formatDate(s.startDate)} — {formatDate(s.endDate)}
                      </TableCell>
                      <TableCell className="text-right">{s.theoreticalWeeks}</TableCell>
                      <TableCell className="text-right">{s.examWeeks}</TableCell>
                      <TableCell className="text-right">{s.practiceWeeks}</TableCell>
                      <TableCell className="text-right">{s.vacationWeeks}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.hours ? s.hours.lecture + s.hours.practical + s.hours.laboratory + s.hours.consultation : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {canEdit && (
                          <Button variant="ghost" size="icon-sm" onClick={() => setEditSemester(s)} aria-label="Изменить семестр">
                            <Pencil />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="groups">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {(p.groups ?? []).map((g) => (
              <Link key={g.id} to={`/groups/${g.id}`}>
                <Card className="py-4 transition-shadow hover:shadow-md">
                  <CardContent className="px-4">
                    <div className="text-lg font-semibold">{g.code}</div>
                    <div className="text-muted-foreground text-sm">
                      {g.courseNumber} курс · {g.studentCount} студентов · подгрупп: {g.subgroupCount}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
            {(p.groups ?? []).length === 0 && <div className="text-muted-foreground text-sm">Группы не привязаны</div>}
          </div>
        </TabsContent>
      </Tabs>

      <ItemDialog itemId={itemId} programId={id!} onClose={() => setItemId(null)} semesters={semesters.data ?? []} />
      <NewItemDialog open={newItem} onOpenChange={setNewItem} program={p} tree={tree.data} />
      <SemesterDialog semester={editSemester} onClose={() => setEditSemester(null)} programId={id!} />
    </div>
  );
}

function HoursTile({ title, value }: { title: string; value: string | number }) {
  return (
    <Card className="py-3">
      <CardContent className="px-4">
        <div className="text-muted-foreground text-xs">{title}</div>
        <div className="text-xl font-semibold tabular-nums">{value} ч</div>
      </CardContent>
    </Card>
  );
}

function CurriculumTable({ tree, onItemClick }: { tree: CurriculumTree; onItemClick: (id: string) => void }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const semNums = tree.semesters.map((s) => s.number);

  const renderNode = (node: CurriculumNode, depth: number): React.ReactNode => {
    const bySem = new Map(node.semesters.map((s) => [s.semester.number, s]));
    return (
      <Fragment key={node.id}>
        <tr className="hover:bg-muted/40 cursor-pointer border-t" onClick={() => onItemClick(node.id)}>
          <td className="py-1.5 pr-2 whitespace-nowrap" style={{ paddingLeft: 8 + depth * 16 }}>
            {node.children.length > 0 ? (
              <button
                type="button"
                className="mr-1 inline-flex align-middle"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(node.id);
                }}
              >
                {collapsed.has(node.id) ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              </button>
            ) : null}
            <span className="font-mono text-xs">{node.code}</span>
          </td>
          <td className={cn('py-1.5 pr-2', node.children.length > 0 && 'font-semibold')}>
            {node.name}
            <div className="text-muted-foreground text-[11px]">
              {ITEM_TYPE_LABELS[node.itemType]}
              {NOT_SCHEDULED.includes(node.itemType) && ' · в расписание не ставится'}
            </div>
          </td>
          <td className="py-1.5 pr-2 text-right tabular-nums">{node.totals.total}</td>
          <td className="py-1.5 pr-2 text-right tabular-nums">{node.totals.lecture}</td>
          <td className="py-1.5 pr-2 text-right tabular-nums">{node.totals.practical}</td>
          <td className="py-1.5 pr-2 text-right tabular-nums">{node.totals.laboratory}</td>
          <td className="py-1.5 pr-2 text-right tabular-nums">{node.totals.consultation}</td>
          <td className="py-1.5 pr-2 text-right tabular-nums">{node.totals.selfStudy}</td>
          <td className="py-1.5 pr-2 text-right tabular-nums">{node.totals.practice}</td>
          {semNums.map((n) => {
            const s = bySem.get(n);
            const aud = s ? s.lectureHours + s.practicalHours + s.laboratoryHours + s.consultationHours + (s.practiceAtCollege ? s.practiceHours : 0) : 0;
            const odd = s && [s.lectureHours, s.practicalHours, s.laboratoryHours, s.consultationHours].some((h) => h % 2 === 1);
            return (
              <td key={n} className="border-l px-1 py-1.5 text-center text-xs">
                {s ? (
                  <div>
                    <div className="font-medium tabular-nums">
                      {aud || s.practiceHours || s.totalHours}
                      {odd && <TriangleAlert className="ml-0.5 inline size-3 text-amber-500" aria-label="Нечётное число часов" />}
                    </div>
                    <div className="text-muted-foreground text-[10px]">{s.controlForm !== 'NONE' ? CONTROL_FORM_LABELS[s.controlForm] : ''}</div>
                  </div>
                ) : null}
              </td>
            );
          })}
        </tr>
        {!collapsed.has(node.id) && node.children.map((c) => renderNode(c, depth + 1))}
      </Fragment>
    );
  };

  return (
    <div className="bg-card overflow-x-auto rounded-lg border scrollbar-thin">
      <table className="w-full min-w-[1100px] text-sm">
        <thead className="bg-muted/40 text-muted-foreground text-xs">
          <tr>
            <th className="p-2 text-left font-medium">Индекс</th>
            <th className="p-2 text-left font-medium">Наименование</th>
            <th className="p-2 text-right font-medium">Всего</th>
            <th className="p-2 text-right font-medium">Лек</th>
            <th className="p-2 text-right font-medium">Пр</th>
            <th className="p-2 text-right font-medium">Лаб</th>
            <th className="p-2 text-right font-medium">Конс</th>
            <th className="p-2 text-right font-medium">СР</th>
            <th className="p-2 text-right font-medium">Практ</th>
            {semNums.map((n) => (
              <th key={n} className="border-l p-2 text-center font-medium">
                {n} сем
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tree.cycles.map((c) => (
            <Fragment key={c.id}>
              <tr className="bg-muted/60 border-t">
                <td className="p-2 font-mono text-xs font-semibold">{c.code}</td>
                <td className="p-2 font-semibold" colSpan={1}>
                  {c.name}
                </td>
                <td className="p-2 text-right font-semibold tabular-nums">{c.totals.total ?? 0}</td>
                <td className="p-2 text-right tabular-nums">{c.totals.lecture ?? 0}</td>
                <td className="p-2 text-right tabular-nums">{c.totals.practical ?? 0}</td>
                <td className="p-2 text-right tabular-nums">{c.totals.laboratory ?? 0}</td>
                <td className="p-2 text-right tabular-nums">{c.totals.consultation ?? 0}</td>
                <td className="p-2 text-right tabular-nums">{c.totals.selfStudy ?? 0}</td>
                <td className="p-2 text-right tabular-nums">{c.totals.practice ?? 0}</td>
                <td colSpan={semNums.length} className="border-l" />
              </tr>
              {c.items.map((n) => renderNode(n, 0))}
            </Fragment>
          ))}
          {tree.cycles.length === 0 && (
            <tr>
              <td colSpan={9 + semNums.length} className="text-muted-foreground p-8 text-center">
                Учебный план пуст. Добавьте элементы вручную или импортируйте из Excel
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="text-muted-foreground flex items-center gap-1.5 border-t p-2 text-xs">
        <TriangleAlert className="size-3 text-amber-500" /> — нечётное число часов по виду занятий: последняя пара будет неполной (1 ак. ч)
      </div>
    </div>
  );
}

interface ItemDetails {
  id: string;
  code: string;
  name: string;
  itemType: CurriculumItemType;
  isRequired: boolean;
  isDifficult: boolean;
  department: string | null;
  cycleId: string;
  semesterItems: Array<SemesterItem & { semester: Semester }>;
}

const HOUR_FIELDS: Array<[keyof SemesterItem, string]> = [
  ['lectureHours', 'Лекции'],
  ['practicalHours', 'Практические'],
  ['laboratoryHours', 'Лабораторные'],
  ['consultationHours', 'Консультации'],
  ['selfStudyHours', 'Самост. работа'],
  ['assessmentHours', 'Пром. аттестация'],
  ['practiceHours', 'Практика'],
];

const ROOM_FIELDS: Array<[keyof SemesterItem, string]> = [
  ['lectureRoomTypes', 'Лекции'],
  ['practicalRoomTypes', 'Практические'],
  ['laboratoryRoomTypes', 'Лабораторные'],
  ['practiceRoomTypes', 'Практика'],
];

function pairsText(hours: number) {
  if (!hours) return '';
  const full = Math.floor(hours / 2);
  return hours % 2 ? `${full} пар + 1 неполная` : `${full} пар`;
}

function ItemDialog({ itemId, programId, onClose, semesters }: { itemId: string | null; programId: string; onClose: () => void; semesters: Semester[] }) {
  const { canEdit } = useAuth();
  const item = useApi<ItemDetails>(['curriculum-item', itemId], itemId ? `/curriculum-items/${itemId}` : null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [isDifficult, setIsDifficult] = useState(false);
  const [department, setDepartment] = useState('');
  const [semesterId, setSemesterId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!item.data) return;
    setName(item.data.name);
    setCode(item.data.code);
    setIsDifficult(item.data.isDifficult);
    setDepartment(item.data.department ?? '');
    const first = item.data.semesterItems[0];
    setSemesterId(first?.semesterId ?? null);
  }, [item.data]);

  const current = item.data?.semesterItems.find((s) => s.semesterId === semesterId);
  useEffect(() => {
    setDraft(current ? { ...current } : { controlForm: 'NONE', practiceAtCollege: false, scheduleConsultations: true });
  }, [current, semesterId]);

  const invalidate: Array<unknown[]> = [['curriculum', programId], ['curriculum-item', itemId], ['program', programId], ['semester-items']];
  const saveItem = useApiMutation(
    () => api.patch(`/curriculum-items/${itemId}`, { name, code, isDifficult, department: department || undefined }),
    { success: 'Элемент плана сохранён', invalidate },
  );
  const saveHours = useApiMutation(
    () => {
      const body: Record<string, unknown> = { semesterId };
      for (const [k] of HOUR_FIELDS) body[k] = Number(draft[k] ?? 0);
      body.totalHours = HOUR_FIELDS.reduce((a, [k]) => a + Number(draft[k] ?? 0), 0);
      body.controlForm = draft.controlForm ?? 'NONE';
      body.practiceAtCollege = !!draft.practiceAtCollege;
      body.scheduleConsultations = draft.scheduleConsultations !== false;
      for (const [k] of ROOM_FIELDS) body[k] = draft[k] ?? [];
      return api.post(`/curriculum-items/${itemId}/semesters`, body);
    },
    { success: 'Часы семестра сохранены', invalidate },
  );
  const removeSem = useApiMutation(() => api.delete(`/semester-items/${current!.id}`), { success: 'Семестр удалён из элемента', invalidate });
  const removeItem = useApiMutation(() => api.delete(`/curriculum-items/${itemId}`), {
    success: 'Элемент удалён',
    invalidate,
    onSuccess: onClose,
  });

  const odd = HOUR_FIELDS.slice(0, 4).filter(([k]) => Number(draft[k] ?? 0) % 2 === 1);

  return (
    <Dialog open={!!itemId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {item.data ? `${item.data.code} ${item.data.name}` : 'Элемент учебного плана'}
          </DialogTitle>
        </DialogHeader>
        {item.isLoading || !item.data ? (
          <LoadingState rows={6} />
        ) : (
          <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1 scrollbar-thin">
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Индекс">
                <Input value={code} onChange={(e) => setCode(e.target.value)} disabled={!canEdit} />
              </Field>
              <Field label="Наименование" className="sm:col-span-3">
                <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} />
              </Field>
              <Field label="Вид">
                <Input value={ITEM_TYPE_LABELS[item.data.itemType]} disabled />
              </Field>
              <Field label="Кафедра / ПЦК" className="sm:col-span-2">
                <Input value={department} onChange={(e) => setDepartment(e.target.value)} disabled={!canEdit} />
              </Field>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <Checkbox checked={isDifficult} onCheckedChange={(c) => setIsDifficult(!!c)} disabled={!canEdit} /> Сложная дисциплина
              </label>
            </div>
            {canEdit && (
              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={() => saveItem.mutate(undefined)} disabled={saveItem.isPending}>
                  Сохранить элемент
                </Button>
              </div>
            )}
            <Card className="gap-3 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-base">Часы по семестрам</CardTitle>
                <CardDescription>1 пара = 2 академических часа. Самостоятельная работа и аттестация в сетку не ставятся.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 px-4">
                <div className="flex flex-wrap gap-1.5">
                  {semesters.map((s) => {
                    const has = item.data!.semesterItems.some((x) => x.semesterId === s.id);
                    return (
                      <Button key={s.id} size="sm" variant={semesterId === s.id ? 'default' : has ? 'secondary' : 'ghost'} onClick={() => setSemesterId(s.id)}>
                        {s.number} сем{has ? '' : ' +'}
                      </Button>
                    );
                  })}
                </div>
                {semesterId && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-4">
                      {HOUR_FIELDS.map(([k, label]) => (
                        <Field key={k} label={label} hint={k !== 'selfStudyHours' && k !== 'assessmentHours' ? pairsText(Number(draft[k] ?? 0)) : undefined}>
                          <Input
                            type="number"
                            min={0}
                            value={String(draft[k] ?? 0)}
                            disabled={!canEdit}
                            onChange={(e) => setDraft({ ...draft, [k]: e.target.value === '' ? 0 : Number(e.target.value) })}
                          />
                        </Field>
                      ))}
                      <Field label="Форма контроля">
                        <SimpleSelect
                          value={(draft.controlForm as string) ?? 'NONE'}
                          onChange={(v) => setDraft({ ...draft, controlForm: v ?? 'NONE' })}
                          disabled={!canEdit}
                          options={Object.entries(CONTROL_FORM_LABELS).map(([value, label]) => ({ value, label: value === 'NONE' ? 'Нет' : label }))}
                        />
                      </Field>
                    </div>
                    {odd.length > 0 && (
                      <Alert variant="warning">
                        <TriangleAlert />
                        <AlertDescription>
                          Нечётное число часов ({odd.map(([, l]) => l.toLowerCase()).join(', ')}): последняя пара будет неполной (1 ак. ч) и
                          будет отмечена в расписании.
                        </AlertDescription>
                      </Alert>
                    )}
                    <div className="flex flex-wrap gap-5 text-sm">
                      <label className="flex items-center gap-2">
                        <Switch
                          checked={!!draft.practiceAtCollege}
                          disabled={!canEdit}
                          onCheckedChange={(v) => setDraft({ ...draft, practiceAtCollege: v })}
                        />
                        Практика проводится в колледже (ставится в расписание)
                      </label>
                      <label className="flex items-center gap-2">
                        <Switch
                          checked={draft.scheduleConsultations !== false}
                          disabled={!canEdit}
                          onCheckedChange={(v) => setDraft({ ...draft, scheduleConsultations: v })}
                        />
                        Ставить консультации в расписание
                      </label>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Требуемые типы аудиторий</div>
                      {ROOM_FIELDS.map(([k, label]) => {
                        const selected = (draft[k] as ClassroomType[] | undefined) ?? [];
                        return (
                          <div key={k} className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-muted-foreground w-28">{label}:</span>
                            {Object.entries(CLASSROOM_TYPE_LABELS).map(([t, tl]) => (
                              <label key={t} className="flex items-center gap-1">
                                <Checkbox
                                  checked={selected.includes(t as ClassroomType)}
                                  disabled={!canEdit}
                                  onCheckedChange={(c) =>
                                    setDraft({ ...draft, [k]: c ? [...selected, t] : selected.filter((x) => x !== t) })
                                  }
                                />
                                {tl}
                              </label>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                    {canEdit && (
                      <div className="flex justify-between">
                        {current ? (
                          <Confirm
                            trigger={
                              <Button size="sm" variant="ghost" className="text-destructive">
                                <Trash2 /> Убрать семестр
                              </Button>
                            }
                            title="Убрать семестр из элемента плана?"
                            description="Удаление невозможно, если по дисциплине уже есть занятия в расписании."
                            destructive
                            onConfirm={() => removeSem.mutate(undefined)}
                          />
                        ) : (
                          <span />
                        )}
                        <Button size="sm" onClick={() => saveHours.mutate(undefined)} disabled={saveHours.isPending}>
                          {saveHours.isPending && <Spinner />} Сохранить часы семестра
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}
        <DialogFooter>
          {canEdit && item.data && (
            <Confirm
              trigger={
                <Button variant="ghost" className="text-destructive mr-auto">
                  <Trash2 /> Удалить элемент
                </Button>
              }
              title="Удалить элемент учебного плана?"
              destructive
              confirmText="Удалить"
              onConfirm={() => removeItem.mutate(undefined)}
            />
          )}
          <Button variant="outline" onClick={onClose}>
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewItemDialog({ open, onOpenChange, program, tree }: { open: boolean; onOpenChange: (o: boolean) => void; program: Program; tree?: CurriculumTree }) {
  const [cycleId, setCycleId] = useState<string | null>(null);
  const [parentId, setParentId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [itemType, setItemType] = useState<string>('DISCIPLINE');
  const [newCycle, setNewCycle] = useState({ code: '', name: '' });
  const modules = (tree?.cycles ?? []).flatMap((c) => c.items.filter((i) => i.itemType === 'MODULE' && (!cycleId || i.cycleId === cycleId)));
  const create = useApiMutation(
    () => api.post(`/programs/${program.id}/curriculum-items`, { cycleId, parentItemId: parentId, code, name, itemType }),
    {
      success: 'Элемент добавлен. Укажите часы по семестрам',
      invalidate: [['curriculum', program.id], ['program', program.id]],
      onSuccess: () => {
        onOpenChange(false);
        setCode('');
        setName('');
      },
    },
  );
  const createCycle = useApiMutation(() => api.post<{ id: string }>(`/programs/${program.id}/cycles`, newCycle), {
    success: 'Цикл добавлен',
    invalidate: [['curriculum', program.id], ['program', program.id]],
    onSuccess: (c) => {
      setCycleId(c.id);
      setNewCycle({ code: '', name: '' });
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Новый элемент учебного плана</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Цикл" required className="sm:col-span-2">
            <SimpleSelect value={cycleId} onChange={setCycleId} options={(tree?.cycles ?? []).map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }))} />
          </Field>
          <div className="flex items-end gap-2 sm:col-span-2">
            <Input placeholder="Код нового цикла (ОП)" value={newCycle.code} onChange={(e) => setNewCycle({ ...newCycle, code: e.target.value })} className="w-40" />
            <Input placeholder="Наименование цикла" value={newCycle.name} onChange={(e) => setNewCycle({ ...newCycle, name: e.target.value })} />
            <Button variant="outline" disabled={!newCycle.code || !newCycle.name} onClick={() => createCycle.mutate(undefined)}>
              <Plus /> Цикл
            </Button>
          </div>
          <Field label="Входит в модуль">
            <SimpleSelect value={parentId} onChange={setParentId} allowEmpty emptyLabel="Нет" options={modules.map((m) => ({ value: m.id, label: `${m.code} ${m.name}` }))} />
          </Field>
          <Field label="Вид элемента" required>
            <SimpleSelect value={itemType} onChange={(v) => setItemType(v ?? 'DISCIPLINE')} options={Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="Индекс" required>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ОП.05" />
          </Field>
          <Field label="Наименование" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={() => create.mutate(undefined)} disabled={!cycleId || !code || !name || create.isPending}>
            {create.isPending && <Spinner />} Добавить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SemesterDialog({ semester, onClose, programId }: { semester: Semester | null; onClose: () => void; programId: string }) {
  const [form, setForm] = useState({ startDate: '', endDate: '', theoreticalWeeks: 0, examWeeks: 0, practiceWeeks: 0, vacationWeeks: 0 });
  useEffect(() => {
    if (semester) {
      setForm({
        startDate: semester.startDate.slice(0, 10),
        endDate: semester.endDate.slice(0, 10),
        theoreticalWeeks: semester.theoreticalWeeks,
        examWeeks: semester.examWeeks,
        practiceWeeks: semester.practiceWeeks,
        vacationWeeks: semester.vacationWeeks,
      });
    }
  }, [semester]);
  const save = useApiMutation(() => api.patch(`/semesters/${semester!.id}`, form), {
    success: 'Семестр сохранён',
    invalidate: [['program-semesters', programId], ['program', programId], ['semesters']],
    onSuccess: onClose,
  });
  return (
    <Dialog open={!!semester} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{semester?.number} семестр</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Начало">
            <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </Field>
          <Field label="Окончание">
            <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </Field>
          {(
            [
              ['theoreticalWeeks', 'Недель теории'],
              ['examWeeks', 'Недель аттестации'],
              ['practiceWeeks', 'Недель практики'],
              ['vacationWeeks', 'Недель каникул'],
            ] as const
          ).map(([k, l]) => (
            <Field key={k} label={l}>
              <Input type="number" min={0} value={form[k]} onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })} />
            </Field>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={() => save.mutate(undefined)} disabled={save.isPending}>
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
