import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cn } from '@/lib/utils';

function Progress({
  className,
  value,
  indicatorClassName,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & { indicatorClassName?: string }) {
  // Полоса «дорастает» до значения после появления
  const [shown, setShown] = React.useState(0);
  React.useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(value || 0));
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn('bg-primary/12 relative h-2 w-full overflow-hidden rounded-full', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn('bg-primary h-full w-full flex-1 rounded-full transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]', indicatorClassName)}
        style={{ transform: `translateX(-${100 - Math.min(100, Math.max(0, shown))}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
