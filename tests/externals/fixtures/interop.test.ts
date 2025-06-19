import { expect, it } from '@rstest/core';
import { test } from './test-pkg/importInterop';

it('should interop correctly', () => {
  expect(test()).toBe('hello world');
});
