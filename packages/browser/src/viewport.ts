import type { BrowserViewport } from '@rstest/core/internal/browser';

export type ViewportSize = Exclude<BrowserViewport, string>;

export const parseViewportSize = (
  width: unknown,
  height: unknown,
): ViewportSize => {
  if (
    typeof width !== 'number' ||
    !Number.isInteger(width) ||
    width <= 0 ||
    typeof height !== 'number' ||
    !Number.isInteger(height) ||
    height <= 0
  ) {
    throw new TypeError(
      'page.viewport() requires positive integer width and height.',
    );
  }
  return { width, height };
};
