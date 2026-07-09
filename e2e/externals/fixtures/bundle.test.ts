import { expect, it } from '@rstest/core';
import { a } from './test-pkg/testBundle';

it('should load typescript pkg correctly', () => {
  expect(a).toBe(1);
});
