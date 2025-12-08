'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';

type TooltipSettings = {
  delayDuration: number;
};

const TooltipSettingsContext = React.createContext<TooltipSettings>({
  delayDuration: 0,
});

const TooltipProvider: React.FC<
  React.PropsWithChildren<{ delayDuration?: number }>
> = ({ delayDuration = 0, children }) => (
  <TooltipSettingsContext.Provider value={{ delayDuration }}>
    {children}
  </TooltipSettingsContext.Provider>
);

type TooltipContextValue = {
  open: boolean;
  contentId: string;
  scheduleOpen: () => void;
  scheduleClose: () => void;
  setOpen: (open: boolean) => void;
  triggerRef: React.MutableRefObject<HTMLElement | null>;
  triggerRect: DOMRect | null;
  updateTriggerRect: () => void;
};

const TooltipContext = React.createContext<TooltipContextValue | null>(null);

const useTooltipContext = (component: string) => {
  const context = React.useContext(TooltipContext);
  if (!context) {
    throw new Error(`${component} must be used within <Tooltip>`);
  }
  return context;
};

type TooltipProps = React.HTMLAttributes<HTMLSpanElement> & {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  delayDuration?: number;
};

const Tooltip: React.FC<TooltipProps> = ({
  children,
  defaultOpen = false,
  open,
  onOpenChange,
  delayDuration,
  className,
  ...props
}) => {
  const { delayDuration: providerDelay } = React.useContext(
    TooltipSettingsContext,
  );
  const contentId = React.useId();
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? Boolean(open) : internalOpen;
  const openTimeout = React.useRef<number | null>(null);
  const closeTimeout = React.useRef<number | null>(null);
  const triggerRef = React.useRef<HTMLElement | null>(null);
  const [triggerRect, setTriggerRect] = React.useState<DOMRect | null>(null);
  const effectiveDelay = delayDuration ?? providerDelay ?? 0;

  const clearTimers = React.useCallback(() => {
    if (openTimeout.current) {
      window.clearTimeout(openTimeout.current);
      openTimeout.current = null;
    }
    if (closeTimeout.current) {
      window.clearTimeout(closeTimeout.current);
      closeTimeout.current = null;
    }
  }, []);

  const updateTriggerRect = React.useCallback(() => {
    const node = triggerRef.current;
    if (!node) {
      setTriggerRect(null);
      return;
    }
    const rect = node.getBoundingClientRect();
    setTriggerRect(rect);
  }, []);

  React.useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  const changeOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) {
        setInternalOpen(next);
      }
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const scheduleOpen = React.useCallback(() => {
    updateTriggerRect();
    if (closeTimeout.current) {
      window.clearTimeout(closeTimeout.current);
      closeTimeout.current = null;
    }
    if (openTimeout.current) {
      window.clearTimeout(openTimeout.current);
    }
    openTimeout.current = window.setTimeout(() => changeOpen(true), effectiveDelay);
  }, [changeOpen, effectiveDelay, updateTriggerRect]);

  const scheduleClose = React.useCallback(() => {
    if (openTimeout.current) {
      window.clearTimeout(openTimeout.current);
      openTimeout.current = null;
    }
    if (closeTimeout.current) {
      window.clearTimeout(closeTimeout.current);
    }
    closeTimeout.current = window.setTimeout(() => changeOpen(false), 60);
  }, [changeOpen]);

  React.useLayoutEffect(() => {
    if (!isOpen) return;
    const handleUpdate = () => updateTriggerRect();
    handleUpdate();
    window.addEventListener('resize', handleUpdate);
    window.addEventListener('scroll', handleUpdate, true);
    return () => {
      window.removeEventListener('resize', handleUpdate);
      window.removeEventListener('scroll', handleUpdate, true);
    };
  }, [isOpen, updateTriggerRect]);

  const value = React.useMemo(
    () => ({
      open: isOpen,
      contentId,
      scheduleOpen,
      scheduleClose,
      setOpen: changeOpen,
      triggerRef,
      triggerRect,
      updateTriggerRect,
    }),
    [changeOpen, contentId, isOpen, scheduleClose, scheduleOpen, triggerRect, updateTriggerRect],
  );

  return (
    <TooltipContext.Provider value={value}>
      <span className={cn('relative inline-flex', className)} {...props}>
        {children}
      </span>
    </TooltipContext.Provider>
  );
};

Tooltip.displayName = 'Tooltip';

type TooltipTriggerProps = React.HTMLAttributes<HTMLElement> & {
  asChild?: boolean;
};

const composeRefs =
  <T,>(...refs: Array<React.Ref<T> | undefined>) =>
  (node: T | null) => {
    refs.forEach((ref) => {
      if (!ref) return;
      if (typeof ref === 'function') {
        ref(node);
        return;
      }
      try {
        (ref as React.MutableRefObject<T | null>).current = node;
      } catch {
        // ignore
      }
    });
  };

const composeEventHandlers = <E extends React.SyntheticEvent | Event>(
  theirs: ((event: E) => void) | undefined,
  ours: (event: E) => void,
) => {
  return (event: E) => {
    theirs?.(event);
    if ('defaultPrevented' in event && event.defaultPrevented) return;
    ours(event);
  };
};

const TooltipTrigger = React.forwardRef<HTMLElement, TooltipTriggerProps>(
  (
    {
      asChild = false,
      children,
      className,
      onMouseEnter,
      onMouseLeave,
      onFocus,
      onBlur,
      onKeyDown,
      ...props
    },
    forwardedRef,
  ) => {
    const context = useTooltipContext('TooltipTrigger');
    const ref = React.useMemo(
      () =>
        composeRefs(
          forwardedRef,
          (node: HTMLElement | null) => {
            context.triggerRef.current = node;
          },
        ),
      [context.triggerRef, forwardedRef],
    );

    const triggerHandlers = {
      onMouseEnter: composeEventHandlers(onMouseEnter, context.scheduleOpen),
      onMouseLeave: composeEventHandlers(onMouseLeave, context.scheduleClose),
      onFocus: composeEventHandlers(onFocus, context.scheduleOpen),
      onBlur: composeEventHandlers(onBlur, context.scheduleClose),
      onKeyDown: composeEventHandlers(onKeyDown, (event) => {
        if (
          event instanceof KeyboardEvent
            ? event.key === 'Escape'
            : (event as React.KeyboardEvent).key === 'Escape'
        ) {
          context.setOpen(false);
        }
      }),
    };

    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement;
      return React.cloneElement(child, {
        ref: composeRefs(child.ref as React.Ref<HTMLElement>, ref),
        className: cn(child.props?.className, className),
        'aria-describedby':
          child.props?.['aria-describedby'] ??
          (context.open ? context.contentId : undefined),
        'data-state': context.open ? 'open' : 'closed',
        onMouseEnter: composeEventHandlers(
          child.props?.onMouseEnter,
          triggerHandlers.onMouseEnter,
        ),
        onMouseLeave: composeEventHandlers(
          child.props?.onMouseLeave,
          triggerHandlers.onMouseLeave,
        ),
        onFocus: composeEventHandlers(
          child.props?.onFocus,
          triggerHandlers.onFocus,
        ),
        onBlur: composeEventHandlers(
          child.props?.onBlur,
          triggerHandlers.onBlur,
        ),
        onKeyDown: composeEventHandlers(
          child.props?.onKeyDown,
          triggerHandlers.onKeyDown,
        ),
        ...props,
      });
    }

    return (
      <button
        type="button"
        ref={ref as React.Ref<HTMLButtonElement>}
        className={className}
        aria-describedby={context.open ? context.contentId : undefined}
        data-state={context.open ? 'open' : 'closed'}
        {...triggerHandlers}
        {...props}
      >
        {children}
      </button>
    );
  },
);

TooltipTrigger.displayName = 'TooltipTrigger';

type TooltipContentProps = React.HTMLAttributes<HTMLDivElement> & {
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
};

const getPositionStyle = (
  side: TooltipContentProps['side'],
  align: TooltipContentProps['align'],
  sideOffset: number,
  triggerRect: DOMRect,
): React.CSSProperties => {
  const style: React.CSSProperties = {
    position: 'fixed',
    zIndex: 60,
  };
  const transforms: string[] = [];

  switch (side) {
    case 'bottom':
      style.top = triggerRect.bottom + sideOffset;
      break;
    case 'left':
      style.left = triggerRect.left - sideOffset;
      transforms.push('translateX(-100%)');
      break;
    case 'right':
      style.left = triggerRect.right + sideOffset;
      break;
    case 'top':
    default:
      style.top = triggerRect.top - sideOffset;
      transforms.push('translateY(-100%)');
      break;
  }

  if (side === 'top' || side === 'bottom') {
    switch (align) {
      case 'start':
        style.left = triggerRect.left;
        break;
      case 'end':
        style.left = triggerRect.right;
        transforms.push('translateX(-100%)');
        break;
      case 'center':
      default:
        style.left = triggerRect.left + triggerRect.width / 2;
        transforms.push('translateX(-50%)');
        break;
    }
  } else {
    switch (align) {
      case 'start':
        style.top = triggerRect.top;
        break;
      case 'end':
        style.top = triggerRect.bottom;
        transforms.push('translateY(-100%)');
        break;
      case 'center':
      default:
        style.top = triggerRect.top + triggerRect.height / 2;
        transforms.push('translateY(-50%)');
        break;
    }
  }

  if (transforms.length > 0) {
    style.transform = transforms.join(' ');
  }

  return style;
};

const TooltipContent = React.forwardRef<HTMLDivElement, TooltipContentProps>(
  (
    {
      className,
      side = 'top',
      align = 'center',
      sideOffset = 6,
      style,
      ...props
    },
    ref,
  ) => {
    const context = useTooltipContext('TooltipContent');

    if (!context.open || !context.triggerRect) return null;

    return createPortal(
      <div
        ref={ref}
        id={context.contentId}
        role="tooltip"
        className={cn(
          'pointer-events-none select-none rounded-none border border-[color:var(--border)] bg-[var(--muted)] px-2 py-1 text-xs text-foreground shadow-md whitespace-nowrap',
          'data-[side=top]:animate-in data-[side=top]:fade-in-0 data-[side=top]:slide-in-from-bottom-1',
          'data-[side=bottom]:animate-in data-[side=bottom]:fade-in-0 data-[side=bottom]:slide-in-from-top-1',
          'data-[side=left]:animate-in data-[side=left]:fade-in-0 data-[side=left]:slide-in-from-right-1',
          'data-[side=right]:animate-in data-[side=right]:fade-in-0 data-[side=right]:slide-in-from-left-1',
          className,
        )}
        data-side={side}
        data-align={align}
        style={{
          ...getPositionStyle(side, align, sideOffset, context.triggerRect),
          ...style,
        }}
        {...props}
      />
      , document.body,
    );
  },
);

TooltipContent.displayName = 'TooltipContent';

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
