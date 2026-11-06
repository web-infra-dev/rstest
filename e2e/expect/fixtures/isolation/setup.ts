import { threadId } from 'node:worker_threads';
import { beforeAll, expect } from '@rstest/core';
import { registerExtensions } from './check';

// The native process survives VM files; this also makes the checks independent
// of file and project scheduling order.
const key = Symbol.for('rstest.e2e.expectExtension.fileCount');
const fileCount = (Reflect.get(process, key) ?? 0) + 1;
Reflect.set(process, key, fileCount);
console.log(`EXPECT_EXTENSION_WORKER:${process.pid}:${threadId}`);

const shared = process.env.EXPECT_EXTENSION_SHARED === 'true' && fileCount > 1;
beforeAll(() => {
  const first = { equalGroup: true, value: 1 };
  const second = { equalGroup: true, value: 2 };
  if (shared) {
    expect(first).toEqual(second);
    expect('override').toBe('different');
  } else {
    expect(first).not.toEqual(second);
    expect(() => expect('override').toBe('different')).toThrow();
    expect(() => expect('file').toFileValue()).toThrow('Invalid Chai property');
    expect(() => expect('context').toContextValue()).toThrow(
      'Invalid Chai property',
    );
  }
  expect(Object.hasOwn(expect, 'toFileValue')).toEqual(shared);
  expect(Object.hasOwn(expect.not, 'toFileValue')).toEqual(shared);
  expect(Object.hasOwn(expect.not, 'toContextValue')).toEqual(shared);
  expect('value').toMatchInlineSnapshot(shared ? 'latest' : '"value"');
});

expect.extend({
  toSetupValue: (value) => ({
    pass: value === 'setup',
    message: () => 'expected setup',
  }),
});

expect.addSnapshotSerializer({
  test: (value) => value === 'setup',
  serialize: () => 'from setup',
});

if (fileCount === 1 && process.env.EXPECT_EXTENSION_FAILURE === 'setup') {
  registerExtensions();
  expect.addSnapshotSerializer({
    test: (value) => value === 'value',
    serialize: () => 'leaked from failed setup',
  });
  throw new Error('EXPECT_EXTENSION_EXPECTED_SETUP_FAILURE');
}
