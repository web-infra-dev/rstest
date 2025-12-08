import * as React from 'react';
import { cn } from '../../lib/utils';
import { Button } from './button';

type AccordionType = 'single' | 'multiple';

type AccordionContextValue = {
  type: AccordionType;
  openValues: string[];
  toggleItem: (value: string) => void;
  isItemOpen: (value: string) => boolean;
};

const AccordionContext = React.createContext<AccordionContextValue | null>(
  null,
);

const useAccordion = (component: string) => {
  const ctx = React.useContext(AccordionContext);
  if (!ctx) {
    throw new Error(`${component} must be used within <Accordion>`);
  }
  return ctx;
};

type AccordionProps = {
  type?: AccordionType;
  defaultValue?: string | string[];
  value?: string | string[];
  collapsible?: boolean;
  onValueChange?: (value: string | string[]) => void;
} & React.HTMLAttributes<HTMLDivElement>;

const normalizeValue = (value: string | string[] | undefined): string[] => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const Accordion: React.FC<AccordionProps> = ({
  type = 'single',
  defaultValue,
  value,
  collapsible = false,
  onValueChange,
  className,
  children,
  ...props
}) => {
  const [internalValue, setInternalValue] = React.useState<string[]>(
    normalizeValue(defaultValue),
  );
  const currentValues = value !== undefined ? normalizeValue(value) : internalValue;

  const setValues = React.useCallback(
    (next: string[]) => {
      if (value === undefined) {
        setInternalValue(next);
      }
      onValueChange?.(type === 'single' ? next[0] ?? '' : next);
    },
    [onValueChange, type, value],
  );

  const toggleItem = React.useCallback(
    (itemValue: string) => {
      if (type === 'single') {
        const isOpen = currentValues.includes(itemValue);
        if (isOpen && !collapsible) return;
        setValues(isOpen ? [] : [itemValue]);
      } else {
        const isOpen = currentValues.includes(itemValue);
        setValues(
          isOpen
            ? currentValues.filter((v) => v !== itemValue)
            : [...currentValues, itemValue],
        );
      }
    },
    [collapsible, currentValues, setValues, type],
  );

  const isItemOpen = React.useCallback(
    (itemValue: string) => currentValues.includes(itemValue),
    [currentValues],
  );

  const contextValue = React.useMemo<AccordionContextValue>(
    () => ({
      type,
      openValues: currentValues,
      toggleItem,
      isItemOpen,
    }),
    [currentValues, isItemOpen, toggleItem, type],
  );

  return (
    <AccordionContext.Provider value={contextValue}>
      <div className={cn(className)} {...props}>
        {children}
      </div>
    </AccordionContext.Provider>
  );
};

type AccordionItemProps = React.HTMLAttributes<HTMLDivElement> & {
  value: string;
};

const AccordionItem: React.FC<AccordionItemProps> = ({
  value,
  className,
  ...props
}) => {
  return (
    <div
      data-accordion-item
      data-value={value}
      className={cn('w-full', className)}
      {...props}
    />
  );
};

type AccordionTriggerProps = React.HTMLAttributes<HTMLElement> & {
  asChild?: boolean;
  value?: string;
};

const AccordionTrigger = React.forwardRef<HTMLElement, AccordionTriggerProps>(
  ({ asChild = false, children, className, value, ...props }, forwardedRef) => {
    const ctx = useAccordion('AccordionTrigger');
    const targetValue =
      value ??
      (typeof props['data-value'] === 'string'
        ? (props['data-value'] as string)
        : undefined);
    if (!targetValue) {
      throw new Error('AccordionTrigger requires a `value` prop');
    }
    const isOpen = ctx.isItemOpen(targetValue);

    const handleClick = (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault();
      ctx.toggleItem(targetValue);
    };

    const sharedProps = {
      'data-state': isOpen ? 'open' : 'closed',
      'aria-expanded': isOpen,
      className: cn(
        'flex w-full items-center justify-between gap-2 text-left',
        className,
      ),
      ref: forwardedRef as React.Ref<HTMLElement>,
      ...props,
    };

    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement;
      const mergedOnClick = (event: React.MouseEvent<HTMLElement>) => {
        child.props?.onClick?.(event);
        if (event.defaultPrevented) return;
        handleClick(event);
      };

      return React.cloneElement(child, {
        ...sharedProps,
        onClick: mergedOnClick,
      });
    }

    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleClick}
        className={cn(
          sharedProps.className,
          'justify-start px-2 py-1.5 hover:bg-transparent',
        )}
        {...sharedProps}
      >
        {children}
      </Button>
    );
  },
);

AccordionTrigger.displayName = 'AccordionTrigger';

type AccordionContentProps = React.HTMLAttributes<HTMLDivElement> & {
  value?: string;
};

const AccordionContent = React.forwardRef<HTMLDivElement, AccordionContentProps>(
  ({ className, children, value, ...props }, ref) => {
    const ctx = useAccordion('AccordionContent');
    const targetValue =
      value ??
      (typeof props['data-value'] === 'string'
        ? (props['data-value'] as string)
        : undefined);
    if (!targetValue) {
      throw new Error('AccordionContent requires a `value` prop');
    }
    const isOpen = ctx.isItemOpen(targetValue);
    return (
      <div
        ref={ref}
        data-state={isOpen ? 'open' : 'closed'}
        className={cn(
          'overflow-hidden transition-all duration-200 data-[state=closed]:max-h-0 data-[state=open]:max-h-[600px]',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);

AccordionContent.displayName = 'AccordionContent';

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };
