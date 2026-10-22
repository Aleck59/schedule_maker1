import { cn } from '@/lib/utils';

export interface ChipOption {
  value: string;
  label: string;
  count?: number;
}

/** Быстрый фильтр: ряд кнопок-чипов, «Все» — без фильтра (value = null) */
export function FilterChips({
  label,
  value,
  onChange,
  options,
  allCount,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  options: ChipOption[];
  allCount?: number;
}) {
  const chip = (v: string | null, text: string, count?: number) => {
    const active = value === v;
    return (
      <button
        key={v ?? '__all'}
        type="button"
        aria-pressed={active}
        onClick={() => onChange(v)}
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-colors',
          active
            ? 'border-primary bg-primary text-primary-foreground shadow-sm'
            : 'bg-card text-muted-foreground hover:text-foreground hover:border-foreground/30',
        )}
      >
        {text}
        {count !== undefined && <span className={cn('tabular-nums', active ? 'opacity-80' : 'opacity-60')}>{count}</span>}
      </button>
    );
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-muted-foreground w-20 shrink-0 text-xs">{label}</span>
      {chip(null, 'Все', allCount)}
      {options.map((o) => chip(o.value, o.label, o.count))}
    </div>
  );
}
