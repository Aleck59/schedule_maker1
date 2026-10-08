import { useState } from 'react';
import { ArrowRightLeft, Building2, CircleCheck, Trash2, UserRoundCog, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, LoadingState, Spinner } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/query';
import type { ValidationIssue } from '@/lib/types';
import { cn } from '@/lib/utils';

type FixAction = 'MOVE' | 'CHANGE_ROOM' | 'CHANGE_TEACHER' | 'DELETE';

interface FixOption {
  action: FixAction;
  lessonId: string;
  title: string;
  params: Record<string, unknown>;
}

interface IssueFix {
  key: string;
  issue: ValidationIssue;
  typeLabel: string;
  lessons: Array<{ id: string; label: string; movable: boolean }>;
  options: FixOption[];
  note: string | null;
}

interface FixesResponse {
  errors: number;
  warnings: number;
  canPublish: boolean;
  total: number;
  shown: number;
  fixes: IssueFix[];
}

interface AutoResult {
  applied: Array<{ issue: string; fix: string }>;
  failed: Array<{ issue: string; reason: string }>;
  errors: number;
  canPublish: boolean;
}

const ICONS: Record<FixAction, typeof ArrowRightLeft> = {
  MOVE: ArrowRightLeft,
  CHANGE_ROOM: Building2,
  CHANGE_TEACHER: UserRoundCog,
  DELETE: Trash2,
};

/**
 * Устранение конфликтов: для каждой ошибки проверки — готовые варианты исправления
 * (перенос, другая аудитория, замена преподавателя, удаление дубликата) и автоисправление.
 */
export function ConflictFixesDialog({
  periodId,
  open,
  onOpenChange,
  onChanged,
}: {
  periodId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const fixes = useApi<FixesResponse>(['fixes', periodId], open ? `/schedule-periods/${periodId}/fixes` : null, undefined, {
    staleTime: 0,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [auto, setAuto] = useState<AutoResult | null>(null);

  const refresh = async () => {
    await api.post(`/schedule-periods/${periodId}/validate`).catch(() => undefined);
    onChanged();
    await fixes.refetch();
  };

  const apply = async (fix: IssueFix, option: FixOption) => {
    setBusy(`${fix.key}#${option.title}`);
    try {
      await api.post(`/schedule-periods/${periodId}/fixes/apply`, option);
      toast.success(`Исправлено: ${option.title}`);
      await refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const fixAll = async () => {
    setBusy('auto');
    try {
      const r = await api.post<AutoResult>(`/schedule-periods/${periodId}/fixes/auto`);
      setAuto(r);
      toast.success(`Автоисправление: применено ${r.applied.length}, осталось ошибок ${r.errors}`);
      await refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const data = fixes.data;
  const errorFixes = data?.fixes.filter((f) => f.issue.severity === 'ERROR') ?? [];
  const warningFixes = data?.fixes.filter((f) => f.issue.severity !== 'ERROR') ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Устранение конфликтов</DialogTitle>
          <DialogDescription>
            Для каждой проблемы подобраны варианты, которые не создают новых конфликтов: перенос в свободный слот, другая
            аудитория, замена преподавателя. Выберите вариант или исправьте всё автоматически.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[68vh] space-y-3 overflow-y-auto pr-1">
          {fixes.isLoading && (
            <div className="space-y-2">
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Spinner /> Подбор вариантов исправления…
              </div>
              <LoadingState rows={4} />
            </div>
          )}
          {fixes.error && <ErrorState error={fixes.error} onRetry={() => fixes.refetch()} />}
          {data && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={data.errors ? 'destructive' : 'success'} className="h-7">
                {data.errors ? `Ошибок: ${data.errors}` : 'Ошибок нет — можно публиковать'}
              </Badge>
              {data.total > data.shown && (
                <Badge variant="muted" className="h-7">
                  Показаны первые {data.shown} из {data.total}
                </Badge>
              )}
              {errorFixes.some((f) => f.options.length) && (
                <Button className="ml-auto" onClick={fixAll} disabled={!!busy}>
                  {busy === 'auto' ? <Spinner /> : <Wand2 />} Исправить всё автоматически
                </Button>
              )}
            </div>
          )}
          {auto && (auto.applied.length > 0 || auto.failed.length > 0) && (
            <div className="rounded-lg border bg-emerald-50/60 p-3 text-sm dark:bg-emerald-950/30">
              <div className="font-medium">Применено исправлений: {auto.applied.length}</div>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {auto.applied.slice(0, 8).map((a, i) => (
                  <li key={i}>{a.fix}</li>
                ))}
              </ul>
              {auto.failed.length > 0 && (
                <div className="text-muted-foreground mt-1 text-xs">Не удалось исправить автоматически: {auto.failed.length}</div>
              )}
            </div>
          )}
          {data && data.fixes.length === 0 && (
            <EmptyState title="Конфликтов нет" description="Расписание прошло проверку. Его можно публиковать." />
          )}
          {[...errorFixes, ...warningFixes].map((fix) => (
            <div
              key={fix.key}
              className={cn(
                'rounded-lg border p-3',
                fix.issue.severity === 'ERROR' ? 'border-destructive/30' : 'border-amber-300 dark:border-amber-800',
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={fix.issue.severity === 'ERROR' ? 'destructive' : 'warning'}>{fix.typeLabel}</Badge>
              </div>
              <div className="mt-1.5 text-sm">{fix.issue.message}</div>
              {fix.lessons.length > 1 && (
                <ul className="text-muted-foreground mt-1 space-y-0.5 text-xs">
                  {fix.lessons.map((l) => (
                    <li key={l.id}>• {l.label}</li>
                  ))}
                </ul>
              )}
              {fix.options.length > 0 ? (
                <div className="mt-2 space-y-1.5">
                  <div className="text-muted-foreground text-xs font-medium">Как исправить:</div>
                  {fix.options.map((option, i) => {
                    const Icon = ICONS[option.action];
                    const id = `${fix.key}#${option.title}`;
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <Icon className="text-muted-foreground size-4 shrink-0" />
                        <span className="min-w-0 flex-1 text-sm">{option.title}</span>
                        <Button
                          size="sm"
                          variant={i === 0 ? 'default' : 'outline'}
                          disabled={!!busy}
                          onClick={() => apply(fix, option)}
                        >
                          {busy === id ? <Spinner /> : <CircleCheck />} Применить
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-muted-foreground mt-2 text-xs">{fix.note}</div>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
