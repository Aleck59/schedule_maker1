import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import { ApiError, errorMessage } from '@/lib/api';

export function LoadingState({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`size-4 animate-spin ${className}`} />;
}

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="animate-fade-in flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center">
      <Inbox className="text-muted-foreground/70 mb-1 size-6" />
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
    <div className="border-destructive/30 bg-destructive/5 text-destructive animate-fade-in flex flex-col items-center gap-2 rounded-xl border px-6 py-8 text-center">
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
