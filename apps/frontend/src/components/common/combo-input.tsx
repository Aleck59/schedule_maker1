import { useRef, useState, type KeyboardEvent } from 'react';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

function normalize(s: string) {
  return s.toLocaleLowerCase('ru').replace(/ё/g, 'е');
}

/** Поле ввода со списком подсказок: можно выбрать из списка или ввести своё значение */
export function ComboInput({
  value,
  onChange,
  options,
  placeholder,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  // Фильтровать список только после того, как пользователь начал печатать
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(-1);
  const anchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const list = typed && value.trim() ? options.filter((o) => normalize(o).includes(normalize(value.trim()))) : options;
  const show = open && list.length > 0;

  const openList = (filter: boolean) => {
    setTyped(filter);
    setActive(-1);
    setOpen(true);
  };
  const pick = (o: string) => {
    onChange(o);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!show) return openList(false);
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + d + list.length) % list.length);
    } else if (e.key === 'Enter' && show && active >= 0) {
      e.preventDefault();
      pick(list[active]);
    } else if (e.key === 'Escape' && show) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <Popover open={show} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div ref={anchorRef} className="relative">
          <Input
            ref={inputRef}
            id={id}
            value={value}
            placeholder={placeholder}
            role="combobox"
            aria-expanded={show}
            aria-autocomplete="list"
            autoComplete="off"
            className="pr-9"
            onChange={(e) => {
              onChange(e.target.value);
              openList(true);
            }}
            onClick={() => !show && openList(false)}
            onKeyDown={onKeyDown}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label="Показать список"
            className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex w-9 cursor-pointer items-center justify-center"
            onClick={() => (show ? setOpen(false) : openList(false))}
          >
            <ChevronDownIcon className={cn('size-4 opacity-60 transition-transform duration-200', show && 'rotate-180')} />
          </button>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (anchorRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
      >
        <div role="listbox">
          {list.map((o, i) => {
            const selected = o === value;
            return (
              <div
                key={o}
                role="option"
                aria-selected={selected}
                data-active={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
                className="data-[active=true]:bg-accent data-[active=true]:text-accent-foreground relative flex w-full cursor-pointer items-center rounded-sm py-1.5 pr-8 pl-2 text-sm select-none"
              >
                {o}
                {selected && <CheckIcon className="text-primary absolute right-2 size-4" />}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
