import { AlertCircle, AlertTriangle, Info } from 'lucide-react';
import type { ValidationIssue } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Список ошибок и предупреждений проверки */
export function IssuesList({ issues, max = 50, className }: { issues: ValidationIssue[]; max?: number; className?: string }) {
  if (issues.length === 0) return null;
  return (
    <ul className={cn('space-y-1.5 text-sm', className)}>
      {issues.slice(0, max).map((i, idx) => (
        <li key={idx} className="flex items-start gap-2">
          {i.severity === 'ERROR' ? (
            <AlertCircle className="text-destructive mt-0.5 size-4 shrink-0" />
          ) : i.severity === 'WARNING' ? (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
          ) : (
            <Info className="mt-0.5 size-4 shrink-0 text-sky-500" />
          )}
          <span>{i.message}</span>
        </li>
      ))}
      {issues.length > max && <li className="text-muted-foreground text-xs">…и ещё {issues.length - max}</li>}
    </ul>
  );
}

/** Извлечение списка конфликтов из ошибки 409 */
export function issuesFromError(error: unknown): ValidationIssue[] | null {
  const e = error as { status?: number; details?: { issues?: ValidationIssue[] } };
  if (e?.status === 409 && Array.isArray(e.details?.issues)) return e.details.issues;
  return null;
}
