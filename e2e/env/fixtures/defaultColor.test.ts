import { expect, it } from '@rstest/core';

it('should not set FORCE_COLOR when no color env is set by user', () => {
  // When neither FORCE_COLOR nor NO_COLOR is set by the user,
  // rstest should not intervene - let child processes decide (like vitest)
  expect(process.env.FORCE_COLOR).toBeUndefined();
  expect(process.env.NO_COLOR).toBeUndefined();
});
