import * as React from 'react';
import { cn } from '../../lib/utils';

type ScrollAreaProps = React.HTMLAttributes<HTMLDivElement> & {
  scrollHideDelay?: number;
};

export const ScrollArea: React.ForwardRefExoticComponent<
  ScrollAreaProps & React.RefAttributes<HTMLDivElement>
> = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'relative overflow-hidden',
          'scroll-area rounded-lg border border-border/50 bg-muted/40',
          className,
        )}
        {...props}
      >
        <div className="h-full w-full overflow-auto pr-2">{children}</div>
      </div>
    );
  },
);

ScrollArea.displayName = 'ScrollArea';
