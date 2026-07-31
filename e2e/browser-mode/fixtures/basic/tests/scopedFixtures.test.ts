import { beforeAll, expect, test } from '@rstest/core';

let testSequence = 0;

const scopedTest = test
  .extend('workerValue', { scope: 'worker' }, (_context, { onCleanup }) => {
    console.log('browser-scope:worker:setup');
    onCleanup(() => {
      console.log('browser-scope:worker:cleanup');
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
const childGraphTest = baseGraphTest.extend(
  'dependency',
  { scope: 'worker' },
  'child',
);

let automaticWorkerReady = false;
let automaticFileReady = false;
let automaticTestReady = false;
const automaticScopedTest = test
  .extend('automaticWorker', { scope: 'worker', auto: true }, () => {
    automaticWorkerReady = true;
    return 'automatic-worker';
  })
  .extend(
    'automaticFile',
    { scope: 'file', auto: true },
    ({ automaticWorker }) => {
      automaticFileReady = automaticWorker === 'automatic-worker';
      return 'automatic-file';
    },
  )
  .extend('automaticTest', { scope: 'test', auto: true }, () => {
    automaticTestReady = true;
    return 'automatic-test';
  });

beforeAll(() => {
  expect(automaticWorkerReady).toBe(true);
  expect(automaticFileReady).toBe(true);
  expect(automaticTestReady).toBe(false);
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

childGraphTest(
  'uses the overridden browser worker dependency',
  ({ derived }) => {
    expect(derived).toBe('child');
  },
);

automaticScopedTest('initializes automatic scopes at their boundaries', () => {
  expect(automaticTestReady).toBe(true);
});
