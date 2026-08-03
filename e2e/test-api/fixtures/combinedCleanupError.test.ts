import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, expect, test } from '@rstest/core';

const snapshotPath = join(__dirname, '.combined-cleanup-error.snap');

const fileTest = test
  .extend('firstFileValue', { scope: 'file' }, (_context, { onCleanup }) => {
    onCleanup(() => {
      throw new Error('first file fixture cleanup root cause');
    });
    return 'first snapshot value';
  })
  .extend('secondFileValue', { scope: 'file' }, (_context, { onCleanup }) => {
    onCleanup(() => {
      throw new Error('second file fixture cleanup root cause');
    });
    return 'second snapshot value';
  });

afterAll(async () => {
  await mkdir(snapshotPath, { recursive: true });
});

fileTest(
  'fails while saving its snapshot',
  ({ firstFileValue, secondFileValue }) => {
    expect([firstFileValue, secondFileValue]).toMatchSnapshot();
  },
);
