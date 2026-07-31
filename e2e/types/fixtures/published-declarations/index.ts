import { expect, test } from '@rstest/core';

expect(true).toBe(true);

const objectTest = test.extend<{ objectValue: string }>({
  objectValue: [
    async ({ task }, use) => {
      await use(task.name);
    },
    { auto: false },
  ],
});

objectTest('object fixtures remain test scoped', ({ objectValue }) => {
  expect(objectValue).toBeTypeOf('string');
});

test.extend<{ workerValue: string }>({
  workerValue: [
    async (_context, use) => {
      await use('worker');
    },
    // @ts-expect-error File and worker scopes use the builder overload.
    { scope: 'worker' },
  ],
});

const workerTest = test.extend(
  'workerValue',
  { scope: 'worker' },
  (_context, { onCleanup }) => {
    onCleanup(() => {});
    return 5000;
  },
);

const fileTest = workerTest.extend(
  'fileValue',
  { scope: 'file' },
  ({ workerValue }) => String(workerValue),
);

// @ts-expect-error Scoped overrides must repeat their inherited scope.
workerTest.extend('workerValue', 6000);

workerTest.extend('workerValue', { scope: 'worker' }, 6000);

workerTest.extend(
  'workerValue',
  { scope: 'worker' },
  // @ts-expect-error A replacement cannot depend on itself.
  ({ workerValue }) => workerValue,
);

// @ts-expect-error A worker fixture cannot be changed to test scope.
workerTest.extend('workerValue', { scope: 'test' }, 6000);

workerTest.extend<{ workerValue: number }>({
  // @ts-expect-error Object fixtures cannot override a worker fixture.
  workerValue: 6000,
});

fileTest.extend(
  'testValue',
  { scope: 'test' },
  ({ fileValue, workerValue, task }) =>
    `${fileValue}:${workerValue}:${task.name}`,
);

workerTest.extend(
  'invalidWorkerValue',
  { scope: 'worker' },
  // @ts-expect-error Worker fixtures cannot access the per-test context.
  ({ task }) => task.name,
);
