import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import { ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatWait, useElapsed, usePageWait, WAIT_INDICATOR_MS, waitWatch } from '@/lib/wait-watch';

/** Спиннер с подписью «Ожидание 7.4с» */
export function WaitBadge({ ms, className }: { ms: number; className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'animate-fade-in bg-card/95 text-foreground inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-lg backdrop-blur',
        className,
      )}
    >
      <Loader2 className="text-primary size-4 animate-spin" />
      Ожидание <span className="tabular-nums">{formatWait(ms)}</span>
    </div>
  );
}

/** Заглушка загрузки; если данные не пришли за 5 с — поверх неё спиннер «Ожидание» с секундами */
export function LoadingState({ rows = 4 }: { rows?: number }) {
  const [start] = useState(() => Date.now());
  const ms = useElapsed(start);
  useEffect(() => waitWatch.registerInline(), []);
  return (
    <div className="relative space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
      {ms >= WAIT_INDICATOR_MS && (
        <div className="absolute inset-0 flex items-start justify-center pt-2">
          <WaitBadge ms={ms} />
        </div>
      )}
    </div>
  );
}

/**
 * Общий индикатор ожидания для страниц без своего блока загрузки: если данные страницы
 * не пришли за 5 с, внизу экрана появляется «Ожидание 5.0с»
 */
export function PageWaitIndicator() {
  const { start, inline } = usePageWait();
  const ms = useElapsed(start);
  if (start === null || inline > 0 || ms < WAIT_INDICATOR_MS) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <WaitBadge ms={ms} />
    </div>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`size-4 animate-spin ${className}`} />;
}

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="animate-fade-in bg-card/50 flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-6 py-10 text-center">
      <div className="bg-primary/8 text-primary/70 mb-1 flex size-12 items-center justify-center rounded-2xl">
        <Inbox className="size-6" />
      </div>
      <div className="font-medium">{title}</div>
      {description && <div className="text-muted-foreground max-w-md text-sm">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, back }: { error: unknown; onRetry?: () => void; back?: { to: string; label: string } }) {
  // Запись не найдена или нет доступа — повтор не поможет, предлагаем вернуться
  const status = error instanceof ApiError ? error.status : 0;
  const final = status === 403 || status === 404;
  return (
    <div className="border-destructive/30 bg-destructive/5 text-destructive animate-fade-in flex flex-col items-center gap-2 rounded-2xl border px-6 py-8 text-center">
      <AlertTriangle className="size-7" />
      <div className="font-medium">{status === 404 ? 'Не найдено' : 'Не удалось загрузить данные'}</div>
      <div className="text-sm opacity-90">{errorMessage(error)}</div>
      <div className="flex gap-2">
        {back && (
          <Button asChild variant="outline" size="sm">
            <Link to={back.to}>{back.label}</Link>
          </Button>
        )}
        {onRetry && !final && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Повторить
          </Button>
        )}
      </div>
    </div>
  );
}
