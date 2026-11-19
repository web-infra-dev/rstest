import { afterAll, expect, it } from '@rstest/core';

// Wrap the runtime's stack formatter the way a user stack-enhancer does:
// capture whatever is installed after worker startup, then delegate to it.
const previousPrepareStackTrace = Error.prepareStackTrace;
const wrapper: NonNullable<typeof Error.prepareStackTrace> = (error, stack) =>
  `wrapped(${previousPrepareStackTrace?.(error, stack)})`;
Error.prepareStackTrace = wrapper;

const readStack = (): string => new Error('wrapper marker').stack!;

it('keeps a user wrapper around the lazily installed formatter', () => {
  const first = readStack();
  const second = readStack();

  expect(Error.prepareStackTrace).toBe(wrapper);
  expect(first.startsWith('wrapped(')).toBe(true);
  expect(second.startsWith('wrapped(')).toBe(true);
  // Frames still map back to this source file after the wrapper was restored.
  expect(first).toContain('errorStackWrapper.test.ts:10:');
  expect(second).toContain('errorStackWrapper.test.ts:10:');
});

// Restore the global so an `isolate: false` worker running further files is
// not left with this wrapper.
afterAll(() => {
  Error.prepareStackTrace = previousPrepareStackTrace;
});
