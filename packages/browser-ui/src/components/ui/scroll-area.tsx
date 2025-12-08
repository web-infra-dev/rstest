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
          'scroll-area',
          className,
        )}
        {...props}
      >
        <div className="h-full w-full overflow-auto">{children}</div>
      </div>
    );
  },
);

ScrollArea.displayName = 'ScrollArea';
