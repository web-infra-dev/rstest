import * as React from 'react';
import { cn } from '../../lib/utils';

type ProgressProps = React.HTMLAttributes<HTMLDivElement> & {
  value?: number;
  max?: number;
};

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, max = 100, ...props }, ref) => {
    const hasData = max > 0;
    const safeMax = hasData ? max : 1;
    const clamped = Math.min(Math.max(value, 0), safeMax);
    const percent = hasData ? (clamped / safeMax) * 100 : 0;
    const barBackground = hasData
      ? `linear-gradient(to right, #4ade80 0%, #4ade80 ${percent}%, #f87171 ${percent}%, #f87171 100%)`
      : 'var(--divider)';

    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={clamped}
        className={cn(
          'relative h-2 w-full overflow-hidden rounded-full border border-[color:var(--divider)] bg-[color:var(--muted)]/40',
          className,
        )}
        {...props}
      >
        <div
          className="h-full w-full transition-all duration-200"
          style={{ background: barBackground }}
        />
      </div>
    );
  },
);

Progress.displayName = 'Progress';

export { Progress };
