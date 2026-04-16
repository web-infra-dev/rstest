import { expect, it } from '@rstest/core';

it('should pass through NO_COLOR when user sets it', () => {
  // When NO_COLOR=1 is set by user, rstest should pass it through
  // without adding extra env vars (like vitest)
  expect(process.env.NO_COLOR).toBe('1');
  // FORCE_COLOR should not be set by rstest when user controls color via NO_COLOR
  expect(process.env.FORCE_COLOR).toBeUndefined();
});
