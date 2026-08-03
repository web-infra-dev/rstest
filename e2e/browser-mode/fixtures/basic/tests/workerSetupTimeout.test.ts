import { expect, test } from '@rstest/core';

const scopedTest = test.extend(
  'workerValue',
  { scope: 'worker' },
  () => new Promise<string>(() => {}),
);

scopedTest(
  'bounds browser worker fixture setup',
  ({ workerValue }) => {
    expect(workerValue).toBe('worker');
  },
  100,
);
