import { expect, rstest, test } from '@rstest/core';

let testSequence = 0;

const scopedTest = test
  .extend('workerValue', { scope: 'worker' }, (_context, { onCleanup }) => {
    console.log('browser-scope:worker:setup');
    onCleanup(() => {
      console.log('browser-scope:worker:cleanup');
      rstest.useFakeTimers();
    });
    return 'worker';
  })
  .extend('fileValue', { scope: 'file' }, ({ workerValue }, { onCleanup }) => {
    console.log('browser-scope:file:setup');
    onCleanup(() => {
      console.log('browser-scope:file:cleanup');
    });
    return `${workerValue}:file`;
  })
  .extend('testValue', ({ fileValue }, { onCleanup }) => {
    const value = `${fileValue}:test:${++testSequence}`;
    console.log(`browser-scope:test:setup:${testSequence}`);
    onCleanup(() => {
      console.log(`browser-scope:test:cleanup:${value}`);
    });
    return value;
  });

const baseGraphTest = test
  .extend('dependency', { scope: 'worker' }, 'base')
  .extend('derived', { scope: 'worker' }, ({ dependency }) => dependency);

let unusedWorkerReady = false;
test.extend('unusedWorker', { scope: 'worker' }, () => {
  unusedWorkerReady = true;
  return 'unused-worker';
});

scopedTest('first browser scoped test', ({ testValue }) => {
  expect(testValue).toBe('worker:file:test:1');
});

scopedTest('second browser scoped test', ({ testValue }) => {
  expect(testValue).toBe('worker:file:test:2');
});

baseGraphTest('uses the base browser worker dependency', ({ derived }) => {
  expect(derived).toBe('base');
});

test('does not initialize an unused scoped fixture', () => {
  expect(unusedWorkerReady).toBe(false);
});
