import { expect, it } from '@rstest/core';

it('resolves the local setup from the inherited root', () => {
  expect(process.env.RSTEST_GLOB_SETUP).toBe('beta');
});
