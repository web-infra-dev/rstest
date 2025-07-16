import { expect, it } from '@rstest/core';
import { a } from './test-pkg/testBundle';

it('should load pkg correctly with bundled', () => {
  expect(a).toBe(1);
});
