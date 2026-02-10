import type { GlobalToken } from 'antd/es/theme/interface';
import React, { useLayoutEffect, useRef } from 'react';
import type { ViewportSelection } from '../utils/viewport';
import { viewportSizeOf } from '../utils/viewport';

type ViewportFrameProps = {
  token: GlobalToken;
  selection: ViewportSelection;
  active: boolean;
  onResponsiveResize?: (size: { width: number; height: number }) => void;
  children: React.ReactNode;
  ['data-testid']?: string;
  ['data-test-project']?: string;
  ['data-test-file']?: string;
};

const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, n));

export const ViewportFrame: React.FC<ViewportFrameProps> = ({
  token,
  selection,
  active,
  onResponsiveResize,
  children,
  ...dataAttrs
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const size = viewportSizeOf(selection);

  useLayoutEffect(() => {
    if (!active) return;
    if (selection.mode !== 'responsive') return;
    if (!onResponsiveResize) return;

    const el = ref.current;
    if (!el) return;

    let initial = true;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;

      // The first ResizeObserver callback may run before layout settles.
      // Ignore it to avoid clobbering the intended initial size.
      if (initial) {
        initial = false;
        return;
      }

      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }

      const width = clamp(Math.round(rect.width), 1, 10000);
      const height = clamp(Math.round(rect.height), 1, 10000);

      // Avoid dispatch loops due to sub-pixel rounding.
      if (width === selection.width && height === selection.height) {
        return;
      }

      onResponsiveResize({ width, height });
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, [active, selection, onResponsiveResize]);

  if (!size) {
    return (
      <div
        className="h-full w-full"
        style={{ background: token.colorBgContainer }}
        {...dataAttrs}
      >
        {children}
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-start justify-center p-4 overflow-auto">
      <div
        ref={ref}
        className="shrink-0 relative group"
        style={{
          width: size.width,
          height: size.height,
          // Tailwind sets `box-sizing: border-box` globally.
          // Ensure the configured viewport matches the iframe content box.
          boxSizing: 'content-box',
          border: `1px solid ${token.colorBorder}`,
          borderRadius: 0,
          background: token.colorBgContainer,
          // CSS resize only works when overflow is not `visible`.
          overflow: 'hidden',
          resize: selection.mode === 'responsive' ? 'both' : 'none',
          minWidth: selection.mode === 'responsive' ? 1 : undefined,
          minHeight: selection.mode === 'responsive' ? 1 : undefined,
          maxWidth: selection.mode === 'responsive' ? 10000 : undefined,
          maxHeight: selection.mode === 'responsive' ? 10000 : undefined,
        }}
        {...dataAttrs}
      >
        {children}
      </div>
    </div>
  );
};
