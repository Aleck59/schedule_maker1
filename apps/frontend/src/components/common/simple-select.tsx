import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CheckIcon, ChevronDownIcon, SearchIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const EMPTY = '__none__';

/** Начиная с этого числа пунктов в списке появляется поле поиска */
export const SEARCH_THRESHOLD = 20;

export interface Option {
  value: string;
  label: string;
  /** Пояснение мелким шрифтом под названием (в поле не показывается) */
  hint?: string;
  disabled?: boolean;
}

interface SimpleSelectProps {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  options: Option[];
  placeholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
  size?: 'sm' | 'default';
  disabled?: boolean;
  id?: string;
}

/** Выпадающий список с поддержкой пустого значения; длинные списки — с поиском */
export function SimpleSelect(props: SimpleSelectProps) {
  if (props.options.length > SEARCH_THRESHOLD) return <SearchSelect {...props} />;
  const { value, onChange, options, placeholder = 'Выберите…', allowEmpty, emptyLabel = 'Не выбрано', className, size, disabled, id } = props;
  return (
    <Select
      value={value ?? (allowEmpty ? EMPTY : undefined)}
      onValueChange={(v) => onChange(v === EMPTY ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger className={className} size={size} id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-w-[max(var(--radix-select-trigger-width),20rem)]">
        {allowEmpty && <SelectItem value={EMPTY}>{emptyLabel}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled} description={o.hint} className="whitespace-normal">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Без учёта регистра и «ё» */
function normalize(s: string) {
  return s.toLocaleLowerCase('ru').replace(/ё/g, 'е');
}

function SearchSelect({
  value,
  onChange,
  options,
  placeholder = 'Выберите…',
  allowEmpty,
  emptyLabel = 'Не выбрано',
  className,
  size = 'default',
  disabled,
  id,
}: SimpleSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const all = useMemo<Option[]>(
    () => (allowEmpty ? [{ value: EMPTY, label: emptyLabel }, ...options] : options),
    [allowEmpty, emptyLabel, options],
  );
  const current = value ?? (allowEmpty ? EMPTY : null);
  const selected = all.find((o) => o.value === current);

  const filtered = useMemo(() => {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    if (!words.length) return all;
    return all.filter((o) => {
      const text = normalize(`${o.label} ${o.hint ?? ''}`);
      return words.every((w) => text.includes(w));
    });
  }, [all, query]);

  // При открытии — подсветить выбранный пункт и прокрутить к нему
  useEffect(() => {
    if (!open) return;
    setQuery('');
    const i = all.findIndex((o) => o.value === current);
    setActive(Math.max(0, i));
    requestAnimationFrame(() => listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (o: Option | undefined) => {
    if (!o || o.disabled) return;
    onChange(o.value === EMPTY ? null : o.value);
    setOpen(false);
  };

  const move = (delta: number) => {
    if (!filtered.length) return;
    let i = active;
    for (let step = 0; step < filtered.length; step++) {
      i = (i + delta + filtered.length) % filtered.length;
      if (!filtered[i].disabled) break;
    }
    setActive(i);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Home' && !query) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End' && !query) {
      e.preventDefault();
      setActive(filtered.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(filtered[active]);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          id={id}
          data-slot="select-trigger"
          data-size={size}
          data-placeholder={selected ? undefined : ''}
          className={cn(
            "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow,border-color] duration-200 outline-none hover:border-primary/30 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 [&_svg]:pointer-events-none [&_svg]:shrink-0",
            className,
          )}
        >
          <span className="block min-w-0 truncate text-left">{selected?.label ?? placeholder}</span>
          <ChevronDownIcon className="size-4 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex max-h-[min(24rem,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] min-w-[16rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.querySelector('input')?.focus();
        }}
      >
        <div className="border-b p-1.5">
          <div className="relative">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Поиск…"
              aria-label="Поиск по списку"
              className="placeholder:text-muted-foreground focus-visible:ring-ring/40 h-8 w-full rounded-md bg-muted/50 pr-2 pl-8 text-sm outline-none focus-visible:ring-2"
            />
          </div>
        </div>
        <div ref={listRef} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1">
          {filtered.length === 0 && <div className="text-muted-foreground px-2 py-6 text-center text-sm">Ничего не найдено</div>}
          {filtered.map((o, i) => {
            const isSelected = o.value === current;
            return (
              <div
                key={o.value}
                role="option"
                aria-selected={isSelected}
                aria-disabled={o.disabled || undefined}
                data-active={i === active}
                onMouseMove={() => i !== active && !o.disabled && setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o)}
                className={cn(
                  'relative flex w-full cursor-default flex-col rounded-sm py-1.5 pr-8 pl-2 text-sm select-none',
                  'data-[active=true]:bg-accent data-[active=true]:text-accent-foreground',
                  o.disabled && 'pointer-events-none opacity-50',
                )}
              >
                <span className="break-words">{o.label}</span>
                {o.hint && <span className="text-muted-foreground text-xs break-words">{o.hint}</span>}
                {isSelected && <CheckIcon className="absolute top-2 right-2 size-4" />}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
