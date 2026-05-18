import { describe, expect, it } from '@rstest/core';
import { getCount, increment } from '../src/index';

// Sibling file: also calls `increment`. With `isolate: true` (default), each
// file runs in a fresh worker, so this file's count starts at 0 regardless
// of basic.test.ts's mutation.
describe('threads pool - isolate', () => {
  it('starts source-module state from zero', () => {
    expect(getCount()).toBe(0);
    increment();
    expect(getCount()).toBe(1);
  });
});
