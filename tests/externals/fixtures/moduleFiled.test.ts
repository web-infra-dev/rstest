import { expect, it } from '@rstest/core';
import { test } from './test-pkg/importModule';

it('should interop correctly', () => {
  expect(test.a).toBe(1);
});
