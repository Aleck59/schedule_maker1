import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, LoadingState, Spinner } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApi, useApiMutation } from '@/lib/query';
import { formatWait } from '@/lib/wait-watch';

interface SlowLoad {
  id: string;
  page: string;
  requests: string[];
  durationMs: number;
  outcome: 'LOADED' | 'ERROR' | 'LEFT';
  createdAt: string;
  user: { id: string; fullName: string; email: string } | null;
}

const OUTCOMES: Record<SlowLoad['outcome'], { label: string; variant: 'secondary' | 'destructive' | 'outline' }> = {
  LOADED: { label: 'Загрузилось', variant: 'secondary' },
  ERROR: { label: 'Ошибка', variant: 'destructive' },
  LEFT: { label: 'Ушёл, не дождавшись', variant: 'outline' },
};

/** Журнал страниц, которые загружались дольше 15 секунд */
export function SlowLoadsLog({ canClear }: { canClear: boolean }) {
  const [page, setPage] = useState(0);
  const take = 50;
  const data = useApi<{ items: SlowLoad[]; total: number }>(['slow-loads', page], '/slow-loads', { take, skip: page * take });
  const clear = useApiMutation(() => api.delete<{ deleted: number }>('/slow-loads'), {
    success: (r) => `Удалено записей: ${r.deleted}`,
    invalidate: [['slow-loads']],
    onSuccess: () => setPage(0),
  });
  const total = data.data?.total ?? 0;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>Долгие загрузки</CardTitle>
          <CardDescription>
            Страницы, данные которых пользователи ждали дольше 15 секунд. Через 5 секунд ожидания на странице появляется счётчик
            «Ожидание». Записи хранятся 90 дней.
          </CardDescription>
        </div>
        {canClear && total > 0 && (
          <Button variant="outline" size="sm" onClick={() => clear.mutate(undefined)} disabled={clear.isPending}>
            {clear.isPending ? <Spinner /> : <Trash2 className="size-4" />} Очистить журнал
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {data.isLoading ? (
          <LoadingState rows={6} />
        ) : data.error ? (
          <ErrorState error={data.error} onRetry={() => data.refetch()} />
        ) : data.data!.items.length === 0 ? (
          <EmptyState title="Долгих загрузок не было" description="Здесь появятся страницы, которые открывались дольше 15 секунд." />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Время</TableHead>
                  <TableHead>Пользователь</TableHead>
                  <TableHead>Страница</TableHead>
                  <TableHead className="text-right">Ожидание</TableHead>
                  <TableHead>Итог</TableHead>
                  <TableHead>Запросы</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data!.items.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap">{formatDateTime(s.createdAt)}</TableCell>
                    <TableCell>{s.user?.fullName ?? '—'}</TableCell>
                    <TableCell className="max-w-64 truncate">
                      <Link to={s.page} className="font-mono text-xs hover:underline" title={s.page}>
                        {s.page}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">{formatWait(s.durationMs)}</TableCell>
                    <TableCell>
                      <Badge variant={OUTCOMES[s.outcome]?.variant ?? 'outline'}>{OUTCOMES[s.outcome]?.label ?? s.outcome}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-80 font-mono text-xs break-all">{s.requests.join(', ')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="text-muted-foreground flex items-center justify-between text-sm">
              <span>Всего записей: {total}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  Назад
                </Button>
                <Button size="sm" variant="outline" disabled={(page + 1) * take >= total} onClick={() => setPage(page + 1)}>
                  Вперёд
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
