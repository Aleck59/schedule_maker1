import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { AnimatedNumber } from '@/components/common/animated-number';
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
  // Цвет только у значка и только когда он что-то сообщает (успех, риск, ошибка)
  const toneClass = {
    default: 'text-muted-foreground',
    success: 'text-emerald-600 dark:text-emerald-400',
    warning: 'text-amber-600 dark:text-amber-400',
    danger: 'text-red-600 dark:text-red-400',
    info: 'text-muted-foreground',
  }[tone];
  return (
    <Card className={cn('py-4', onClick && 'lift cursor-pointer')} onClick={onClick}>
      <CardContent className="flex items-start justify-between gap-3 px-4">
        <div className="min-w-0">
          <div className="text-muted-foreground text-xs font-medium">{title}</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
            {typeof value === 'number' ? <AnimatedNumber value={value} /> : value}
          </div>
          {hint && <div className="text-muted-foreground mt-0.5 text-xs">{hint}</div>}
        </div>
        {Icon && (
          <div className={toneClass}>
            <Icon className="size-4" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
