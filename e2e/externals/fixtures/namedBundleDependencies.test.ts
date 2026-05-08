import { expect, it } from '@rstest/core';
import { a, VERSION } from './test-pkg/namedBundleDependencies';

it('should load both package dependencies correctly', () => {
  expect(VERSION).toBe('4.17.21');
  expect(a).toBe(1);
});
