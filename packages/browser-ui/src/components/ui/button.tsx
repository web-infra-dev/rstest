import * as React from 'react';
import { cn } from '../../lib/utils';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'sm' | 'md';
};

export const Button: React.ForwardRefExoticComponent<
  ButtonProps & React.RefAttributes<HTMLButtonElement>
> = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'default',
      size = 'md',
      type = 'button',
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed',
          variant === 'default' &&
            'bg-primary text-primary-foreground hover:bg-primary/90',
          variant === 'outline' &&
            'border border-border bg-card hover:bg-accent hover:text-accent-foreground',
          variant === 'ghost' && 'hover:bg-accent hover:text-accent-foreground',
          size === 'md' && 'px-3 py-2 text-sm',
          size === 'sm' && 'px-2.5 py-1.5 text-xs',
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = 'Button';
