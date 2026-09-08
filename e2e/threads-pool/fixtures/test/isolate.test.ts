import { describe, expect, it } from '@rstest/core';
import { getCount, increment } from '../src/index';

const FILE_MARKER = '__rstest_threads_pool_file_marker__';

// Sibling file: also calls `increment`. With `isolate: true` (default), each
// file runs in a fresh worker, so this file's count starts at 0 regardless
// of basic.test.ts's mutation.
describe('threads pool - isolate', () => {
  it('starts source-module state from zero', () => {
    expect(getCount()).toBe(0);
    increment();
    expect(getCount()).toBe(1);
  });

  it('starts with a clean file global after the previous file', () => {
    const fileGlobal = globalThis as typeof globalThis &
      Record<string, unknown>;
    expect(fileGlobal[FILE_MARKER]).toBeUndefined();
    fileGlobal[FILE_MARKER] = 'isolate';
  });
});
