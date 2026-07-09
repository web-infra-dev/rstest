import { expect, it } from '@rstest/core';
import { a, test } from './test-pkg/interopDefault';

it('should interop correctly', () => {
  expect(test()).toBe('hello world');
  expect(a).toBe('world');
});
