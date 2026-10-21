import { ArrowLeft, CheckCircle2, Eye, Upload } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Confirm } from '@/components/common/confirm';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, ErrorState, LoadingState, Spinner } from '@/components/common/states';
import { JobStatusBadge } from '@/components/common/status-badge';
import { PreviewGrid } from '@/components/generation/preview-grid';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useSettings } from '@/hooks/use-reference';
import { api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { useApi, useApiMutation } from '@/lib/query';
import type { GenerationJob, GenerationResult } from '@/lib/types';

/** Предпросмотр результата генерации: расписание ещё не применено и не опубликовано */
export default function GenerationPreviewPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const settings = useSettings();
  const job = useApi<GenerationJob>(['generation-job', jobId], jobId ? `/generation-jobs/${jobId}` : null);
  const apply = useApiMutation(() => api.post<{ created: number; deleted: number }>(`/generation-jobs/${jobId}/apply`), {
    success: (r) => `Расписание применено: создано ${r.created}, удалено ${r.deleted}`,
    invalidate: [
      ['generation-jobs'],
      ['generation-job'],
      ['lessons'],
      ['schedule-periods'],
      ['hour-control'],
      ['validation'],
      ['capacity'],
      ['dashboard'],
    ],
  });

  if (job.isLoading) return <LoadingState rows={8} />;
  if (job.error) return <ErrorState error={job.error} onRetry={() => job.refetch()} />;
  const result = job.data?.result as GenerationResult | null | undefined;
  const back = `/generation?${new URLSearchParams(
    job.data?.periodIds && job.data.periodIds.length > 1
      ? { scope: 'all', job: jobId! }
      : { period: job.data?.schedulePeriodId ?? '', job: jobId! },
  )}`;
  const canApply = (job.data?.status === 'COMPLETED' || job.data?.status === 'COMPLETED_WITH_CONFLICTS') && !!result;
  const s = settings.data?.settings;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Предпросмотр расписания"
        description={
          job.data && (
            <span className="flex flex-wrap items-center gap-2">
              Составлено {formatDateTime(job.data.createdAt)}
              {result && ` · ${formatDate(result.range.from)} — ${formatDate(result.range.to)}`}
              <JobStatusBadge status={job.data.status} />
            </span>
          )
        }
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to={back}>
                <ArrowLeft /> К составлению
              </Link>
            </Button>
            {canApply && (
              <Confirm
                trigger={<Button disabled={apply.isPending}>{apply.isPending ? <Spinner /> : <Upload />} Применить</Button>}
                title="Применить результат?"
                description={`Будет создано ${result!.lessons.length} занятий, заменено ${result!.replaceLessonIds.length} ранее составленных. Закреплённые, ручные и проведённые занятия не изменятся.`}
                confirmText="Применить"
                onConfirm={() => apply.mutate(undefined)}
              />
            )}
          </div>
        }
      />
      {!result ? (
        <EmptyState title="Нет результата" description="Генерация ещё не завершена или завершилась с ошибкой" />
      ) : (
        <>
          {job.data?.status === 'APPLIED' ? (
            <Alert variant="success">
              <CheckCircle2 />
              <AlertTitle>Результат уже применён</AlertTitle>
              <AlertDescription>
                Расписание перенесено в черновик периода и ещё не видно преподавателям и студентам, пока его не опубликуют.{' '}
                <Link
                  className="underline"
                  to={(job.data.periodIds?.length ?? 0) > 1 ? '/schedule' : `/schedule?period=${job.data.schedulePeriodId}`}
                >
                  Открыть расписание
                </Link>
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="info">
              <Eye />
              <AlertTitle>Черновик — не опубликовано</AlertTitle>
              <AlertDescription>
                Так будет выглядеть расписание после применения: {result.lessons.length} занятий, не поставлено{' '}
                {result.stats.unplacedLessons} пар. Его не видят преподаватели и студенты; текущее расписание не изменится, пока результат
                не применён.
              </AlertDescription>
            </Alert>
          )}
          <PreviewGrid
            result={result}
            lessonsPerDay={s?.lessonsPerDay ?? 6}
            workingDays={s?.workingDays ?? [1, 2, 3, 4, 5, 6]}
            views={['group', 'teacher', 'room']}
          />
        </>
      )}
    </div>
  );
}
