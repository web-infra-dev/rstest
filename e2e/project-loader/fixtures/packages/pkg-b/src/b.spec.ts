import { expect, it } from '@rstest/core';

it('runs pkg-b with globals disabled', () => {
  expect((globalThis as Record<string, unknown>).describe).toBeUndefined();
});
