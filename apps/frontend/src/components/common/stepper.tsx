import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Step {
  title: string;
  description?: string;
}

/** Шаги мастера: номер, название, отметка о выполнении */
export function Stepper({
  steps,
  current,
  onSelect,
  className,
}: {
  steps: Step[];
  current: number;
  onSelect?: (index: number) => void;
  className?: string;
}) {
  return (
    <ol className={cn('flex flex-wrap gap-2', className)}>
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        const clickable = !!onSelect && i <= current;
        return (
          <li key={step.title} className="min-w-0 flex-1 basis-40">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => onSelect?.(i)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors',
                active && 'border-primary bg-primary/5',
                done && 'border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30',
                !active && !done && 'opacity-70',
                clickable && !active && 'hover:bg-muted cursor-pointer',
              )}
            >
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                  active && 'bg-primary border-primary text-white',
                  done && 'border-emerald-500 bg-emerald-500 text-white',
                )}
              >
                {done ? <Check className="size-4" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{step.title}</span>
                {step.description && <span className="text-muted-foreground block truncate text-xs">{step.description}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
