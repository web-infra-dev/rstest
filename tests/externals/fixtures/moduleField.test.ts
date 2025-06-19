import { expect, it } from '@rstest/core';
import { a } from './test-pkg/importModule';

it('should interop correctly', () => {
  expect(a).toBe(1);
});
