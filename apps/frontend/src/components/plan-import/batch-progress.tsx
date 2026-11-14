import { CircleCheck, Clock, FileText, FileUp, ListChecks, TriangleAlert, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Spinner } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useApi } from '@/lib/query';
import { cn } from '@/lib/utils';
import type { CurriculumScan } from './types';

/** Состояние одного файла пакетной загрузки */
export function batchItemState(s: CurriculumScan) {
  if (s.status === 'PROCESSING') {
    return s.progress > 0
      ? { key: 'work', label: 'Обрабатывается', variant: 'info' as const }
      : { key: 'queue', label: 'В очереди', variant: 'muted' as const };
  }
  if (s.status === 'APPLIED') return { key: 'done', label: 'План создан', variant: 'success' as const };
  if (s.status === 'FAILED') return { key: 'fail', label: 'Ошибка', variant: 'destructive' as const };
  return { key: 'review', label: 'Нужна проверка', variant: 'warning' as const };
}

const fileName = (s: CurriculumScan) => s.fileNames[0] ?? '—';

/** Ход пакетной загрузки: сводка и таблица по каждому файлу, обновляется сама */
export function BatchProgress({
  batchId,
  onOpen,
  onClose,
}: {
  batchId: string;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const list = useApi<CurriculumScan[]>(['scans', 'batch', batchId], '/curriculum-scans', { batchId }, {
    refetchInterval: (q) => (q.state.data?.some((s) => s.status === 'PROCESSING') ? 1500 : false),
  });
  const items = list.data ?? [];
  const total = items.length;
  const count = (key: string) => items.filter((s) => batchItemState(s).key === key).length;
  const done = items.filter((s) => s.status !== 'PROCESSING').length;
  const running = done < total;
  const summary = [
    { key: 'done', label: 'Создано', icon: CircleCheck, cls: 'text-emerald-600' },
    { key: 'review', label: 'На проверку', icon: ListChecks, cls: 'text-amber-600' },
    { key: 'fail', label: 'Ошибки', icon: TriangleAlert, cls: 'text-destructive' },
    { key: 'queue', label: 'В очереди', icon: Clock, cls: 'text-muted-foreground' },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            {running ? <Spinner /> : <CircleCheck className="size-5 text-emerald-600" />}
            {running ? `Обработка планов: ${done} из ${total}` : `Готово: обработано ${total} файлов`}
          </CardTitle>
          <CardDescription>
            {running
              ? 'Файлы обрабатываются в фоне по очереди. Можно закрыть страницу — по окончании придёт уведомление, а результат останется в «Загруженные ранее».'
              : 'Планы без ошибок созданы. Файлы «Нужна проверка» откройте и подтвердите вручную — причина указана в строке.'}
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            <FileUp /> Загрузить ещё
          </Button>
          <Button variant="ghost" size="icon" aria-label="Закрыть" onClick={onClose}>
            <X />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={total ? Math.round((done / total) * 100) : 0} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {summary.map(({ key, label, icon: Icon, cls }) => (
            <div key={key} className="bg-muted/40 flex items-center gap-2 rounded-lg border px-3 py-2">
              <Icon className={cn('size-5 shrink-0', cls)} />
              <div>
                <div className="text-xl leading-none font-semibold tabular-nums">
                  {key === 'queue' ? count('queue') + count('work') : count(key)}
                </div>
                <div className="text-muted-foreground text-xs">{label}</div>
              </div>
            </div>
          ))}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Файл</TableHead>
              <TableHead className="hidden md:table-cell">Состояние</TableHead>
              <TableHead className="hidden md:table-cell">Подробности</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((s) => {
              const st = batchItemState(s);
              const badge = (
                <Badge variant={st.variant} className="gap-1.5">
                  {st.key === 'work' && <Spinner />}
                  {st.label}
                </Badge>
              );
              const details =
                st.key === 'work'
                  ? s.message
                  : st.key === 'fail'
                    ? s.error
                    : st.key === 'review'
                      ? (s.message ?? '').replace(/^Нужна проверка: /, '')
                      : st.key === 'done'
                        ? s.message
                        : 'Ждёт своей очереди';
              return (
                <TableRow key={s.id}>
                  <TableCell className="max-w-[13rem] whitespace-normal md:max-w-xs">
                    <div className="flex items-center gap-2">
                      <FileText className="text-muted-foreground size-4 shrink-0" />
                      <span className="truncate" title={fileName(s)}>
                        {fileName(s)}
                      </span>
                    </div>
                    {/* Телефон: состояние и причина под именем файла */}
                    <div className="mt-1.5 space-y-1 md:hidden">
                      {badge}
                      {st.key !== 'queue' && <div className="text-muted-foreground line-clamp-3 text-xs">{details}</div>}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{badge}</TableCell>
                  <TableCell className="text-muted-foreground hidden max-w-md text-sm md:table-cell">
                    {st.key === 'work' ? (
                      <div className="flex items-center gap-2">
                        <Progress value={Math.round(s.progress * 100)} className="h-1.5 w-24" />
                        <span className="truncate">{s.message}</span>
                      </div>
                    ) : st.key === 'review' || st.key === 'fail' ? (
                      <span className="line-clamp-2" title={s.error ?? s.message ?? ''}>
                        {st.key === 'fail' ? s.error : (s.message ?? '').replace(/^Нужна проверка: /, '')}
                      </span>
                    ) : st.key === 'done' ? (
                      s.message
                    ) : (
                      'Ждёт своей очереди'
                    )}
                  </TableCell>
                  <TableCell className="pl-0 text-right whitespace-nowrap md:pl-2">
                    {st.key === 'done' && s.programId && (
                      <Button variant="outline" size="sm" asChild>
                        <Link to={`/programs/${s.programId}`}>
                          <span className="md:hidden">План</span>
                          <span className="hidden md:inline">Учебный план</span>
                        </Link>
                      </Button>
                    )}
                    {st.key === 'review' && (
                      <Button size="sm" onClick={() => onOpen(s.id)}>
                        Проверить
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
