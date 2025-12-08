'use client';

import * as React from 'react';
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type PanelGroupProps,
  type PanelProps,
  type PanelResizeHandleProps,
} from 'react-resizable-panels';
import { cn } from '../../lib/utils';

const ResizablePanelGroup = ({ className, ...props }: PanelGroupProps) => (
  <PanelGroup className={cn('h-full w-full', className)} {...props} />
);

const ResizablePanel = ({ className, ...props }: PanelProps) => (
  <Panel className={cn('h-full', className)} {...props} />
);

const ResizableHandle = ({ className, ...props }: PanelResizeHandleProps) => (
  <PanelResizeHandle
    className={cn(
      'group relative flex w-2 cursor-col-resize items-center justify-center bg-transparent transition-colors duration-200 hover:bg-[color:var(--muted)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0',
      className,
    )}
    {...props}
  >
    <span
      className="pointer-events-none h-9 w-px rounded-full bg-[color:var(--foreground)]/30 transition-all duration-200 group-hover:scale-y-110 group-hover:bg-[color:var(--foreground)]/60"
      aria-hidden="true"
    />
  </PanelResizeHandle>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
