import { expect, it } from '@rstest/core';
import { choose } from '../src/branch';

it('records only the executed branch', () => {
  expect(choose(true)).toBe('covered');
});
