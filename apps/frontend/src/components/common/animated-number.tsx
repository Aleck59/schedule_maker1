import { useCountUp } from '@/lib/use-count-up';

/** Число, которое «досчитывается» при появлении и изменении */
export function AnimatedNumber({ value, format }: { value: number; format?: (n: number) => string }) {
  const n = useCountUp(value);
  return <>{format ? format(n) : n.toLocaleString('ru-RU')}</>;
}
