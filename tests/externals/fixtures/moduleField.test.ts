import { expect, it } from '@rstest/core';
import { a, b } from './test-pkg/importModule';

it('should interop correctly', () => {
  expect(a).toBe(1);
});

it('should load correctly via require', () => {
  expect(b).toBe(1);
});
