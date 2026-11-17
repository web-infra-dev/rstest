export const parseViewportSize = (
  width: unknown,
  height: unknown,
): { width: number; height: number } => {
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
