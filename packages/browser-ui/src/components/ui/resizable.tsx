'use client';

import { Splitter, type SplitterProps } from 'antd';
import * as React from 'react';

type ResizablePanelGroupProps = Omit<SplitterProps, 'children'> & {
  children: React.ReactNode;
  direction?: 'horizontal' | 'vertical';
  autoSaveId?: string;
  className?: string;
};

type ResizablePanelProps = {
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  className?: string;
  children?: React.ReactNode;
};

const ResizablePanelGroup = ({
  className,
  style,
  direction = 'horizontal',
  children,
  autoSaveId,
  ...props
}: ResizablePanelGroupProps): React.ReactElement => {
  const panels = React.Children.toArray(children).filter(
    (child): child is React.ReactElement<ResizablePanelProps> =>
      React.isValidElement(child) && child.type === ResizablePanel,
  );

  const items = panels.map((panel) => {
    const {
      defaultSize,
      minSize,
      maxSize,
      children: panelChildren,
    } = panel.props;
    return {
      defaultSize: defaultSize ? `${defaultSize}%` : undefined,
      min: minSize ? `${minSize}%` : undefined,
      max: maxSize ? `${maxSize}%` : undefined,
      children: panelChildren,
    };
  });

  return (
    <Splitter
      layout={direction === 'horizontal' ? 'horizontal' : 'vertical'}
      className={className}
      style={{
        height: '100%',
        width: '100%',
        padding: 0,
        margin: 0,
        ...style,
      }}
      {...props}
    >
      {items.map((item) => (
        <Splitter.Panel
          key={`panel-${item.defaultSize}-${item.min}-${item.max}`}
          {...item}
        >
          {item.children}
        </Splitter.Panel>
      ))}
    </Splitter>
  );
};

const ResizablePanel = ({
  children,
}: ResizablePanelProps): React.ReactElement => {
  return <>{children}</>;
};

const ResizableHandle = (): null => {
  return null;
};

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
