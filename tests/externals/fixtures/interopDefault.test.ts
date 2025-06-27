import { expect, it } from '@rstest/core';
import { test } from './test-pkg/interopDefault';

it('should interop correctly', () => {
  expect(test()).toBe('hello world');
});
