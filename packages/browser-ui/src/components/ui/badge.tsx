import * as React from 'react';
import { cn } from '../../lib/utils';

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: 'default' | 'outline' | 'success' | 'destructive' | 'muted';
};

export const Badge: React.ForwardRefExoticComponent<
  BadgeProps & React.RefAttributes<HTMLSpanElement>
> = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
          variant === 'default' &&
            'border-transparent bg-primary/10 text-primary-foreground',
          variant === 'outline' && 'border-border bg-card text-foreground',
          variant === 'success' &&
            'border-transparent bg-emerald-500/15 text-emerald-700',
          variant === 'destructive' &&
            'border-transparent bg-rose-500/15 text-rose-700',
          variant === 'muted' &&
            'border-transparent bg-muted text-muted-foreground',
          className,
        )}
        {...props}
      />
    );
  },
);

Badge.displayName = 'Badge';
