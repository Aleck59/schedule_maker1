import { CircleCheck, Clock, FileText, FileUp, ListChecks, TriangleAlert, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Spinner } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useApi } from '@/lib/query';
import { cn } from '@/lib/utils';
import { useBatchUpload, type LocalBatchFile } from './batch-upload';
import type { CurriculumScan } from './types';

type ItemKey = 'queue' | 'upload' | 'work' | 'done' | 'review' | 'fail';

/** Состояние одного файла пакетной загрузки */
export function batchItemState(s: CurriculumScan) {
  if (s.status === 'PROCESSING') {
    return s.progress > 0
      ? { key: 'work' as const, label: 'Обрабатывается', variant: 'info' as const }
      : { key: 'queue' as const, label: 'В очереди', variant: 'muted' as const };
  }
  if (s.status === 'APPLIED') return { key: 'done' as const, label: 'План создан', variant: 'success' as const };
  if (s.status === 'FAILED') return { key: 'fail' as const, label: 'Ошибка', variant: 'destructive' as const };
  return { key: 'review' as const, label: 'Нужна проверка', variant: 'warning' as const };
}

/** Карточка плана в пакете: что показать и насколько заполнена полоса хода */
export interface BatchCard {
  id: string;
  name: string;
  key: ItemKey;
  label: string;
  variant: 'info' | 'muted' | 'success' | 'destructive' | 'warning';
  /** 0…100: первая половина — отправка файла, вторая — обработка на сервере */
  percent: number;
  details: string | null;
  scanId?: string;
  programId?: string | null;
}

/** Файлы пакета: отправленные — по данным сервера, остальные — по состоянию в браузере */
export function batchCards(scans: CurriculumScan[], local: LocalBatchFile[]): BatchCard[] {
  const byId = new Map(scans.map((s) => [s.id, s]));
  const fromScan = (s: CurriculumScan, name?: string): BatchCard => {
    const st = batchItemState(s);
    const percent =
      st.key === 'work' ? 50 + Math.round(Math.min(0.99, s.progress) * 50) : st.key === 'queue' ? 50 : 100;
    const details =
      st.key === 'fail'
        ? s.error
        : st.key === 'review'
          ? (s.message ?? '').replace(/^Нужна проверка: /, '')
          : st.key === 'queue'
            ? 'Ждёт своей очереди на сервере'
            : s.message;
    return { id: s.id, name: name ?? s.fileNames[0] ?? '—', ...st, percent, details, scanId: s.id, programId: s.programId };
  };
  if (!local.length) return scans.map((s) => fromScan(s));
  const used = new Set<string>();
  const cards = local.map((f): BatchCard => {
    const scan = f.scanId ? byId.get(f.scanId) : undefined;
    if (scan) {
      used.add(scan.id);
      return fromScan(scan, f.name);
    }
    if (f.phase === 'error') {
      return { id: f.key, name: f.name, key: 'fail', label: 'Не отправлен', variant: 'destructive', percent: 100, details: f.error ?? null };
    }
    if (f.phase === 'uploading' || f.phase === 'sent') {
      return {
        id: f.key,
        name: f.name,
        key: 'upload',
        label: 'Отправка',
        variant: 'info',
        percent: Math.round(f.uploaded * 50),
        details: `Отправлено ${Math.round(f.uploaded * 100)}% · ${(f.size / 1024 / 1024).toFixed(1)} МБ`,
      };
    }
    return { id: f.key, name: f.name, key: 'queue', label: 'В очереди', variant: 'muted', percent: 0, details: 'Отправится после предыдущего плана' };
  });
  // Файлы пакета, загруженные раньше (например, с другой вкладки)
  return [...cards, ...scans.filter((s) => !used.has(s.id)).map((s) => fromScan(s))];
}

const CARD_TONE: Record<ItemKey, string> = {
  queue: 'bg-card',
  upload: 'bg-card border-primary/40',
  work: 'bg-card border-primary/40',
  done: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40',
  review: 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30',
  fail: 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30',
};
const BAR_TONE: Partial<Record<ItemKey, string>> = {
  done: 'bg-emerald-500',
  review: 'bg-amber-500',
  fail: 'bg-red-500',
};

/** Ход пакетной загрузки: сводка и карточка с полосой хода у каждого плана */
export function BatchProgress({
  batchId,
  onOpen,
  onClose,
}: {
  batchId: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const live = useBatchUpload();
  // Загрузка идёт из этой вкладки: файлы ещё не на сервере видны из состояния браузера
  const own = live.files.length > 0 && (!batchId || live.batchId === batchId);
  const uploading = own && live.running;
  const list = useApi<CurriculumScan[]>(['scans', 'batch', batchId], batchId ? '/curriculum-scans' : null, { batchId: batchId ?? undefined }, {
    refetchInterval: (q) => (uploading || q.state.data?.some((s) => s.status === 'PROCESSING') ? 1000 : false),
  });
  const cards = batchCards(list.data ?? [], own ? live.files : []);
  const total = cards.length;
  const count = (...keys: ItemKey[]) => cards.filter((c) => keys.includes(c.key)).length;
  const done = count('done', 'review', 'fail');
  const running = uploading || done < total;
  const percent = total ? Math.round(cards.reduce((sum, c) => sum + c.percent, 0) / total) : 0;
  const summary = [
    { keys: ['done'] as ItemKey[], label: 'Создано', icon: CircleCheck, cls: 'text-emerald-600' },
    { keys: ['review'] as ItemKey[], label: 'На проверку', icon: ListChecks, cls: 'text-amber-600' },
    { keys: ['fail'] as ItemKey[], label: 'Ошибки', icon: TriangleAlert, cls: 'text-destructive' },
    { keys: ['queue', 'upload', 'work'] as ItemKey[], label: 'В очереди', icon: Clock, cls: 'text-muted-foreground' },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            {running ? <Spinner /> : <CircleCheck className="size-5 text-emerald-600" />}
            {running ? `Загрузка планов: ${done} из ${total}` : `Готово: обработано ${total} файлов`}
          </CardTitle>
          <CardDescription>
            {uploading
              ? 'Планы загружаются по одному: следующий файл отправляется, когда предыдущий прочитан и создан. Не закрывайте вкладку, пока идёт отправка — по другим страницам приложения переходить можно.'
              : running
                ? 'Файлы обрабатываются на сервере по очереди. По окончании придёт уведомление, а результат останется в «Загруженные ранее».'
                : 'Планы без ошибок созданы. Файлы «Нужна проверка» откройте и подтвердите вручную — причина указана на карточке.'}
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={uploading}>
            <FileUp /> Загрузить ещё
          </Button>
          <Button variant="ghost" size="icon" aria-label="Закрыть" onClick={onClose}>
            <X />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={percent} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {summary.map(({ keys, label, icon: Icon, cls }) => (
            <div key={label} className="bg-muted/40 flex items-center gap-2 rounded-lg border px-3 py-2">
              <Icon className={cn('size-5 shrink-0', cls)} />
              <div>
                <div className="text-xl leading-none font-semibold tabular-nums">{count(...keys)}</div>
                <div className="text-muted-foreground text-xs">{label}</div>
              </div>
            </div>
          ))}
        </div>
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((c) => (
            <li
              key={c.id}
              data-state={c.key}
              className={cn('flex min-w-0 flex-col gap-2 rounded-xl border p-3 transition-colors duration-500', CARD_TONE[c.key])}
            >
              <div className="flex min-w-0 items-start gap-2">
                {c.key === 'done' ? (
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                ) : (
                  <FileText className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                )}
                <span className="min-w-0 flex-1 text-sm font-medium break-words" title={c.name}>
                  {c.name}
                </span>
                <Badge variant={c.variant} className="shrink-0 gap-1.5">
                  {(c.key === 'work' || c.key === 'upload') && <Spinner />}
                  {c.label}
                </Badge>
              </div>
              <Progress
                value={c.percent}
                className={cn('h-1.5', c.key === 'queue' && 'bg-muted')}
                indicatorClassName={BAR_TONE[c.key]}
                aria-label={`${c.name}: ${c.label}`}
              />
              <div className="flex min-h-7 items-center justify-between gap-2">
                <span className="text-muted-foreground line-clamp-2 text-xs" title={c.details ?? ''}>
                  {c.details}
                </span>
                {c.key === 'done' && c.programId && (
                  <Button variant="outline" size="sm" className="h-7 shrink-0 bg-white/70 dark:bg-transparent" asChild>
                    <Link to={`/programs/${c.programId}`}>Учебный план</Link>
                  </Button>
                )}
                {c.key === 'review' && c.scanId && (
                  <Button size="sm" className="h-7 shrink-0" onClick={() => onOpen(c.scanId!)}>
                    Проверить
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
