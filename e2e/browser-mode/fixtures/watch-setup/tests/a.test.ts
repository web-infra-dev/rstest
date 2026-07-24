import { expect, it } from '@rstest/core';

it('a sees setup state', () => {
  expect(
    typeof (globalThis as { __SETUP_VALUE__?: string }).__SETUP_VALUE__,
  ).toBe('string');
});
