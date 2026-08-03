import { expect, test } from '@rstest/core';

expect(true).toBe(true);

const scopedTest = test
  .extend('port', { scope: 'worker' }, 5000)
  .extend('server', { scope: 'file' }, ({ port }) => ({ port }))
  .extend('client', ({ server }) => server);

scopedTest('exposes scoped values', ({ client, port, server }) => {
  expect(client).toEqual(server);
  expect(port).toBe(5000);
});

// @ts-expect-error scoped fixtures do not support automatic setup
test.extend('automaticWorker', { scope: 'worker', auto: true }, () => 1);

const arrayValueTest = test.extend<{
  objectValue: readonly [number, { scope: 'worker' }];
}>({
  objectValue: [1, { scope: 'worker' as const }],
});

arrayValueTest(
  'keeps scope-shaped arrays as test fixture values',
  ({ objectValue }) => {
    expect(objectValue[1].scope).toBe('worker');
  },
);

const workerTest = test.extend('workerValue', { scope: 'worker' }, 'worker');

// @ts-expect-error scoped fixtures cannot be overridden with the builder form
workerTest.extend('workerValue', 'replacement');

// @ts-expect-error scoped fixtures cannot be overridden with the object form
workerTest.extend({ workerValue: 'replacement' });

test.extend(
  'invalidWorkerContext',
  { scope: 'worker' },
  // @ts-expect-error worker fixtures cannot access the test context
  ({ task }) => task.name,
);
