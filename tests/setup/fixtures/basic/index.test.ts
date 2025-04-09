import { expect, it } from '@rstest/core';

it('should run setup file correctly', () => {
  expect(process.env.RETEST_SETUP_FLAG).toBe('1');
});
