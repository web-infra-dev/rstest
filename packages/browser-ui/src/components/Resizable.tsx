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

  // Load saved sizes from localStorage
  const getSavedSizes = React.useCallback((): number[] | null => {
    if (!autoSaveId) return null;
    try {
      const saved = localStorage.getItem(autoSaveId);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length === panels.length) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return null;
  }, [autoSaveId, panels.length]);

  const savedSizes = getSavedSizes();

  const items = panels.map((panel, index) => {
    const {
      defaultSize,
      minSize,
      maxSize,
      children: panelChildren,
    } = panel.props;

    // Use saved size if available, otherwise use defaultSize
    const size = savedSizes?.[index] ?? defaultSize;

    return {
      defaultSize: size ? `${size}%` : undefined,
      min: minSize ? `${minSize}%` : undefined,
      max: maxSize ? `${maxSize}%` : undefined,
      children: panelChildren,
    };
  });

  const handleSizesChange = React.useCallback(
    (sizes: number[]) => {
      if (!autoSaveId) return;
      try {
        localStorage.setItem(autoSaveId, JSON.stringify(sizes));
      } catch {
        // ignore
      }
    },
    [autoSaveId],
  );

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
      onResizeEnd={handleSizesChange}
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
