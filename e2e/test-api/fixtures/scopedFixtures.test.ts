import { expect, test } from '@rstest/core';

let testSequence = 0;

const scopedTest = test
  .extend('workerValue', { scope: 'worker' }, (_context, { onCleanup }) => {
    console.log('scope:worker:setup');
    onCleanup(() => {
      process.stdout.write('scope:worker:cleanup\n');
    });
    return 'worker';
  })
  .extend('port', { scope: 'worker' }, 5000)
  .extend('fileValue', { scope: 'file' }, ({ workerValue }, { onCleanup }) => {
    console.log('scope:file:setup');
    onCleanup(() => {
      console.log('scope:file:cleanup');
    });
    return `${workerValue}:file`;
  })
  .extend('testValue', ({ fileValue }, { onCleanup }) => {
    const value = `${fileValue}:test:${++testSequence}`;
    console.log(`scope:test:setup:${testSequence}`);
    onCleanup(() => {
      console.log(`scope:test:cleanup:${value}`);
    });
    return value;
  });

scopedTest('first scoped test', ({ port, testValue }) => {
  expect(port).toBe(5000);
  expect(testValue).toBe('worker:file:test:1');
});

scopedTest('second scoped test', ({ port, testValue }) => {
  expect(port).toBe(5000);
  expect(testValue).toBe('worker:file:test:2');
});
