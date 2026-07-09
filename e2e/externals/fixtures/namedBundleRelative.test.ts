import { expect, it } from '@rstest/core';
import greet, { a } from './test-pkg/namedBundleRelative';

it('should bundle relative imports inside named dependencies', () => {
  expect(a).toBe('world');
  expect(greet()).toBe('hello world');
});
