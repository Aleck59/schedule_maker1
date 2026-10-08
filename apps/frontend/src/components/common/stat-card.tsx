import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function StatCard({
  title,
  value,
  hint,
  icon: Icon,
  tone = 'default',
  onClick,
}: {
  title: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  onClick?: () => void;
}) {
  const toneClass = {
    default: 'bg-primary/10 text-primary',
    success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    danger: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    info: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  }[tone];
  return (
    <Card className={cn('py-4', onClick && 'cursor-pointer transition-shadow hover:shadow-md')} onClick={onClick}>
      <CardContent className="flex items-start justify-between gap-3 px-4">
        <div className="min-w-0">
          <div className="text-muted-foreground text-xs font-medium">{title}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
          {hint && <div className="text-muted-foreground mt-0.5 text-xs">{hint}</div>}
        </div>
        {Icon && (
          <div className={cn('rounded-lg p-2', toneClass)}>
            <Icon className="size-5" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
