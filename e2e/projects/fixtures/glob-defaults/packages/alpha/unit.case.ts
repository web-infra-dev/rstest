import { expect, it } from '@rstest/core';

it('loads the package-relative shared setup', () => {
  expect(process.env.RSTEST_GLOB_SETUP).toBe('alpha');
});
