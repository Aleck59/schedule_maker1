import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CircleCheck, FileScan, FileUp, ScanLine, Trash2, TriangleAlert, Upload } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Confirm } from '@/components/common/confirm';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState, LoadingState, Spinner } from '@/components/common/states';
import { Stepper } from '@/components/common/stepper';
import { deriveFromCalendar } from '@/components/plan-import/calendar';
import { calendarErrors, ReviewCalendar } from '@/components/plan-import/review-calendar';
import { ReviewFinish } from '@/components/plan-import/review-finish';
import { generalErrors, ReviewGeneral } from '@/components/plan-import/review-general';
import { itemsErrors, ReviewItems } from '@/components/plan-import/review-items';
import type {
  ApplyResult,
  CurriculumScan,
  Draft,
  RecognizedCalendar,
  ScanEngineStatus,
} from '@/components/plan-import/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApi, useApiMutation } from '@/lib/query';
import { cn } from '@/lib/utils';

const STEPS = [
  { title: 'Загрузка скана', description: 'PDF или фото страниц' },
  { title: 'Распознавание', description: 'Около минуты' },
  { title: 'Общие сведения', description: 'Специальность, план' },
  { title: 'Календарный график', description: 'Семестры, сессии, каникулы' },
  { title: 'Дисциплины и часы', description: 'По семестрам' },
  { title: 'Создание', description: 'Группа и итог' },
];
const STATUS: Record<CurriculumScan['status'], { label: string; variant: 'info' | 'success' | 'destructive' | 'muted' }> = {
  PROCESSING: { label: 'Распознаётся', variant: 'info' },
  READY: { label: 'Ожидает проверки', variant: 'success' },
  FAILED: { label: 'Ошибка', variant: 'destructive' },
  APPLIED: { label: 'План создан', variant: 'muted' },
};
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.tif,.tiff,.bmp,.webp';

/** Данные для запроса: без служебных полей распознавания (фрагменты скана, замечания) */
function payload(draft: Draft) {
  return {
    ...draft,
    program: { ...draft.program, title: draft.program.title.trim() || undefined },
    items: draft.items.map(({ issues: _issues, ...item }) => ({
      ...item,
      semesters: item.semesters.map(({ cells: _cells, ...s }) => s),
    })),
    group: draft.group ?? undefined,
  };
}

function UploadStep({ status, onUploaded }: { status?: ScanEngineStatus; onUploaded: (scan: CurriculumScan) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const upload = useApiMutation(
    (list: File[]) => {
      const form = new FormData();
      list.forEach((f) => form.append('files', f));
      return api.post<CurriculumScan>('/curriculum-scans', form);
    },
    { invalidate: [['scans']], onSuccess: (scan) => onUploaded(scan) },
  );
  const add = (list: FileList | null) => {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, 40));
  };
  const unavailable = status && !status.available;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Загрузите скан учебного плана</CardTitle>
        <CardDescription>
          Система распознает титульный лист, календарный учебный график и план по семестрам, проверит суммы часов и предложит
          данные для проверки. Ничего не создаётся, пока вы не подтвердите данные.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {unavailable && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>Распознавание недоступно</AlertTitle>
            <AlertDescription>{status.error}</AlertDescription>
          </Alert>
        )}
        <div
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            add(e.dataTransfer.files);
          }}
          className={cn(
            'flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
            drag ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
          )}
        >
          <Upload className="text-muted-foreground size-9" />
          <div className="font-medium">Перетащите файлы сюда или нажмите, чтобы выбрать</div>
          <div className="text-muted-foreground max-w-xl text-sm">
            PDF со сканом (можно многостраничный) или фотографии страниц JPG/PNG. Нужны: титульный лист, календарный график и
            страницы «план по семестрам» (часы по видам занятий).
          </div>
          <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => add(e.target.files)} />
        </div>
        {files.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {files.map((f, i) => (
                <Badge key={`${f.name}-${i}`} variant="outline" className="h-7 gap-2">
                  <FileScan /> {f.name} · {(f.size / 1024 / 1024).toFixed(1)} МБ
                  <button type="button" aria-label="Убрать файл" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                    ×
                  </button>
                </Badge>
              ))}
            </div>
            <Button onClick={() => upload.mutate(files)} disabled={upload.isPending || unavailable}>
              {upload.isPending ? <Spinner /> : <ScanLine />} Распознать
            </Button>
          </div>
        )}
        <div className="text-muted-foreground grid gap-1 text-xs sm:grid-cols-3">
          <div>• Сканируйте с разрешением от 300 dpi, страница целиком</div>
          <div>• Фото — без сильного наклона и бликов</div>
          <div>• Таблицы распознаются по линиям сетки</div>
        </div>
      </CardContent>
    </Card>
  );
}

function RecentScans({ onOpen }: { onOpen: (id: string) => void }) {
  const scans = useApi<CurriculumScan[]>(['scans'], '/curriculum-scans');
  const remove = useApiMutation((id: string) => api.delete(`/curriculum-scans/${id}`), {
    success: 'Скан удалён',
    invalidate: [['scans']],
  });
  if (!scans.data?.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Загруженные ранее</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Файлы</TableHead>
              <TableHead>Загружен</TableHead>
              <TableHead>Состояние</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {scans.data.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="max-w-md truncate">{s.fileNames.join(', ')}</TableCell>
                <TableCell>{formatDateTime(s.createdAt)}</TableCell>
                <TableCell>
                  <Badge variant={STATUS[s.status].variant}>{STATUS[s.status].label}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  {s.status === 'APPLIED' && s.programId ? (
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/programs/${s.programId}`}>Учебный план</Link>
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => onOpen(s.id)}>
                      Открыть
                    </Button>
                  )}
                  {s.status !== 'PROCESSING' && (
                    <Confirm
                      trigger={
                        <Button variant="ghost" size="icon-sm" aria-label="Удалить скан">
                          <Trash2 />
                        </Button>
                      }
                      title="Удалить скан?"
                      description="Распознанные данные будут удалены. Созданный по скану учебный план останется."
                      destructive
                      confirmText="Удалить"
                      onConfirm={() => remove.mutate(s.id)}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Done({ result }: { result: ApplyResult }) {
  return (
    <Card className="border-emerald-300 dark:border-emerald-800">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CircleCheck className="size-6 text-emerald-600" /> Учебный план создан
        </CardTitle>
        <CardDescription>
          Семестров: {result.created.semesters}, циклов: {result.created.cycles}, дисциплин и практик: {result.created.items}, строк часов:{' '}
          {result.created.semesterItems}, периодов календарного графика: {result.created.calendarEvents}
          {result.groupId ? ', создана учебная группа' : ''}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm">
          Следующий шаг — назначить преподавателей на дисциплины (нагрузка), затем можно составлять расписание.
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/setup">
              Продолжить настройку <ArrowRight />
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to={`/programs/${result.programId}`}>Открыть учебный план</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/calendar">Календарный график</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/workload">Нагрузка</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PlanImportPage() {
  const [params, setParams] = useSearchParams();
  const scanId = params.get('scan');
  const status = useApi<ScanEngineStatus>(['scan-engine'], '/curriculum-scans/status', undefined, { staleTime: 60_000 });
  const scan = useApi<CurriculumScan>(['scan', scanId], scanId ? `/curriculum-scans/${scanId}` : null, undefined, {
    refetchInterval: (q) => (q.state.data?.status === 'PROCESSING' ? 1500 : false),
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [calendar, setCalendar] = useState<RecognizedCalendar[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [reviewStep, setReviewStep] = useState(0);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [serverErrors, setServerErrors] = useState<string[]>([]);

  useEffect(() => {
    const data = scan.data;
    if (data && data.id !== loadedFor && data.draft) {
      setDraft(data.draft);
      setCalendar(data.resultJson?.calendar ?? []);
      setLoadedFor(data.id);
      setReviewStep(0);
      setServerErrors([]);
    }
  }, [scan.data, loadedFor]);

  const apply = useApiMutation((d: Draft) => api.post<ApplyResult>(`/curriculum-scans/${scanId}/apply`, payload(d)), {
    success: 'Учебный план создан',
    invalidate: [['programs'], ['scans'], ['groups'], ['setup-status']],
    onSuccess: (r) => {
      setResult(r);
      setServerErrors([]);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors.length) {
        setServerErrors(e.errors);
      }
      return false;
    },
  });

  const open = (id: string | null) => {
    setResult(null);
    setDraft(null);
    setLoadedFor(null);
    setParams(id ? { scan: id } : {});
  };

  const onCalendarChange = (next: RecognizedCalendar[]) => {
    setCalendar(next);
    if (!draft) return;
    const derived = deriveFromCalendar(next, draft.semesters.map((s) => s.number));
    setDraft({
      ...draft,
      semesters: draft.semesters.map((s) => derived.semesters.find((d) => d.number === s.number) ?? s),
      periods: derived.periods,
    });
  };

  const s = scan.data;
  const stepIndex = !scanId ? 0 : !s || s.status === 'PROCESSING' ? 1 : s.status === 'APPLIED' || result ? 6 : 2 + reviewStep;
  const errors =
    draft && s?.status !== 'APPLIED'
      ? [generalErrors(draft), calendarErrors(calendar, draft), itemsErrors(draft), []][reviewStep]
      : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Импорт учебного плана со скана"
        description="Загрузите скан — система сама создаст специальность, учебный план, семестры, дисциплины с часами и календарный график"
        actions={
          scanId && (
            <Button variant="outline" onClick={() => open(null)}>
              <FileUp /> Другой файл
            </Button>
          )
        }
      />
      <Stepper steps={STEPS} current={stepIndex} onSelect={stepIndex >= 2 && stepIndex < 6 ? (i) => i >= 2 && setReviewStep(i - 2) : undefined} />

      {!scanId && (
        <>
          <UploadStep status={status.data} onUploaded={(created) => open(created.id)} />
          <RecentScans onOpen={(id) => open(id)} />
        </>
      )}

      {scanId && scan.isLoading && <LoadingState rows={4} />}
      {scanId && scan.error && <ErrorState error={scan.error} onRetry={() => scan.refetch()} />}

      {s?.status === 'PROCESSING' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Spinner /> Распознавание: {s.fileNames.join(', ')}
            </CardTitle>
            <CardDescription>Можно закрыть страницу — распознавание продолжится, скан будет в списке «Загруженные ранее».</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Progress value={Math.round(s.progress * 100)} />
            <div className="text-muted-foreground text-sm">
              {s.message ?? 'Подготовка'} · {Math.round(s.progress * 100)}%
            </div>
          </CardContent>
        </Card>
      )}

      {s?.status === 'FAILED' && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Не удалось распознать скан</AlertTitle>
          <AlertDescription>
            <div>{s.error}</div>
            <div className="mt-2">Попробуйте загрузить скан лучшего качества (от 300 dpi) или фотографии страниц по отдельности.</div>
            <Button className="mt-3" variant="outline" size="sm" onClick={() => open(null)}>
              Загрузить другой файл
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {s?.status === 'APPLIED' && !result && (
        <Alert variant="success">
          <CircleCheck />
          <AlertTitle>По этому скану уже создан учебный план</AlertTitle>
          <AlertDescription>
            <Button className="mt-2" size="sm" asChild>
              <Link to={`/programs/${s.programId}`}>Открыть учебный план</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {result && <Done result={result} />}

      {s?.status === 'READY' && draft && !result && (
        <>
          {s.resultJson?.stats && (
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="info" className="h-7">
                Страниц: {s.resultJson.stats.pages}
              </Badge>
              <Badge variant="info" className="h-7">
                Строк плана: {s.resultJson.stats.items}
              </Badge>
              <Badge variant={s.resultJson.stats.corrected ? 'warning' : 'success'} className="h-7">
                Исправлено по суммам: {s.resultJson.stats.corrected}
              </Badge>
              <Badge variant={s.resultJson.stats.uncertain ? 'destructive' : 'success'} className="h-7">
                Требуют проверки: {s.resultJson.stats.uncertain}
              </Badge>
              <Badge variant="muted" className="h-7">
                Время: {Math.round(s.resultJson.stats.durationMs / 1000)} с
              </Badge>
            </div>
          )}
          {reviewStep === 0 && <ReviewGeneral draft={draft} onChange={setDraft} />}
          {reviewStep === 1 && (
            <ReviewCalendar
              calendar={calendar}
              draft={draft}
              onCalendarChange={onCalendarChange}
              onSemestersChange={(semesters) => setDraft({ ...draft, semesters })}
            />
          )}
          {reviewStep === 2 && <ReviewItems draft={draft} onChange={setDraft} />}
          {reviewStep === 3 && <ReviewFinish draft={draft} warnings={s.resultJson?.warnings ?? []} onChange={setDraft} />}

          {(errors.length > 0 || serverErrors.length > 0) && (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>Нужно исправить</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {[...errors, ...serverErrors].map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <div className="bg-background/95 sticky bottom-0 flex justify-between gap-2 border-t py-3 backdrop-blur">
            <Button variant="outline" disabled={reviewStep === 0} onClick={() => setReviewStep(reviewStep - 1)}>
              <ArrowLeft /> Назад
            </Button>
            {reviewStep < 3 ? (
              <Button disabled={errors.length > 0} onClick={() => setReviewStep(reviewStep + 1)}>
                Далее <ArrowRight />
              </Button>
            ) : (
              <Button
                disabled={apply.isPending || [generalErrors(draft), calendarErrors(calendar, draft), itemsErrors(draft)].some((e) => e.length)}
                onClick={() => apply.mutate(draft)}
              >
                {apply.isPending ? <Spinner /> : <CircleCheck />} Создать учебный план
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
