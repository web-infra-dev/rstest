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
      'relative flex w-4 cursor-col-resize items-center justify-center bg-[#1e2230] hover:bg-[#2a3042] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0',
      className,
    )}
    {...props}
  >
    <span
      className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-[#2a3042]"
      aria-hidden="true"
    />
  </PanelResizeHandle>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
