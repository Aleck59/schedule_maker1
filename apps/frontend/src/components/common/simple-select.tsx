import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const EMPTY = '__none__';

export interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Выпадающий список с поддержкой пустого значения */
export function SimpleSelect({
  value,
  onChange,
  options,
  placeholder = 'Выберите…',
  allowEmpty,
  emptyLabel = 'Не выбрано',
  className,
  size,
  disabled,
  id,
}: {
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
}) {
  return (
    <Select
      value={value ?? (allowEmpty ? EMPTY : undefined)}
      onValueChange={(v) => onChange(v === EMPTY ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger className={className} size={size} id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowEmpty && <SelectItem value={EMPTY}>{emptyLabel}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
