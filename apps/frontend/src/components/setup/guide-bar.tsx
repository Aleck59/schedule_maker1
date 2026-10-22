import { ArrowLeft, ArrowRight, CircleCheck, Compass } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { guideLink, useSetupStatus } from './use-setup';

/**
 * Подсказка мастера настройки на странице шага: какой это шаг, что сделать,
 * переход к мастеру и к следующему шагу.
 */
export function GuideBar() {
  const [params] = useSearchParams();
  const location = useLocation();
  const setup = useSetupStatus();
  if (params.get('guide') !== '1' || !setup.data) return null;
  const steps = setup.data.steps;
  const index = steps.findIndex((s) => s.link.split('?')[0] === location.pathname);
  if (index < 0) return null;
  const step = steps[index];
  const next = steps.slice(index + 1).find((s) => !s.done) ?? steps[index + 1];
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm',
        step.done
          ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30'
          : 'border-primary/40 bg-primary/5',
      )}
    >
      {step.done ? <CircleCheck className="size-5 text-emerald-600" /> : <Compass className="text-primary size-5" />}
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          Шаг {index + 1} из {steps.length}: {step.title} {step.done && '— выполнен'}
        </div>
        <div className="text-muted-foreground">{step.description}</div>
        <div className="text-xs">{step.status}</div>
      </div>
      <Button variant="outline" size="sm" asChild>
        <Link to="/setup">
          <ArrowLeft /> К мастеру
        </Link>
      </Button>
      {next && (
        <Button size="sm" asChild variant={step.done ? 'default' : 'outline'}>
          <Link to={guideLink(next.link)}>
            Следующий шаг: {next.title} <ArrowRight />
          </Link>
        </Button>
      )}
    </div>
  );
}
