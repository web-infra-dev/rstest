import { expect } from '@rstest/core';
import { workerTest } from './workerScope';

workerTest(
  'reuses the worker fixture in the second file',
  ({ browserWorkerValue }) => {
    expect(browserWorkerValue).toBe('worker');
  },
);
