import { ArrowRight, Check, Circle, Compass } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState, LoadingState } from '@/components/common/states';
import { guideLink, useSetupStatus } from '@/components/setup/use-setup';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

/** Мастер настройки: пошаговая подготовка расписания для администратора */
export default function SetupPage() {
  const setup = useSetupStatus();
  if (setup.isLoading) return <LoadingState rows={8} />;
  if (setup.error) return <ErrorState error={setup.error} onRetry={() => setup.refetch()} />;
  const data = setup.data!;
  const next = data.steps.find((s) => s.key === data.next);
  const percent = Math.round((data.completed / data.total) * 100);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Мастер настройки"
        description="Пошаговая подготовка расписания: выполняйте шаги по порядку — система подскажет, что делать дальше"
      />
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              Выполнено {data.completed} из {data.total} шагов
            </span>
            <span className="text-muted-foreground">{percent}%</span>
          </div>
          <Progress value={percent} />
        </CardContent>
      </Card>
      {next ? (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Compass className="text-primary size-5" /> Следующий шаг: {next.title}
            </CardTitle>
            <CardDescription>{next.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Badge variant="warning" className="h-7">
              {next.status}
            </Badge>
            <Button asChild size="lg">
              <Link to={guideLink(next.link)}>
                {next.action} <ArrowRight />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-emerald-300 dark:border-emerald-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Check className="size-5 text-emerald-600" /> Всё готово
            </CardTitle>
            <CardDescription>
              Расписание составлено, проверено и опубликовано. Дальше — ежедневная работа: отметки о проведении, отмены, замены и
              отработки.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      <ol className="space-y-2">
        {data.steps.map((step, i) => {
          const current = step.key === data.next;
          return (
            <li
              key={step.key}
              className={cn(
                'bg-card flex flex-wrap items-center gap-4 rounded-lg border p-4',
                current && 'border-primary ring-primary/30 ring-2',
              )}
            >
              <span
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold',
                  step.done && 'border-emerald-500 bg-emerald-500 text-white',
                  current && 'border-primary bg-primary text-white',
                )}
              >
                {step.done ? <Check className="size-5" /> : current ? i + 1 : <Circle className="text-muted-foreground size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {i + 1}. {step.title}
                </div>
                <div className="text-muted-foreground text-sm">{step.description}</div>
                <div className={cn('mt-0.5 text-xs', step.done ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400')}>
                  {step.status}
                </div>
              </div>
              <Button variant={current ? 'default' : 'outline'} asChild>
                <Link to={guideLink(step.link)}>{step.done ? 'Открыть' : step.action}</Link>
              </Button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
