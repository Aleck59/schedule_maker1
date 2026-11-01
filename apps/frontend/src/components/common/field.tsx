import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** Поле формы с подписью и ошибкой */
export function Field({
  label,
  error,
  hint,
  children,
  className,
  required,
}: {
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label>
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-muted-foreground text-xs">{hint}</p>}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}
