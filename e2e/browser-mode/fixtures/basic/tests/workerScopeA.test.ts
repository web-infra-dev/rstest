import { expect } from '@rstest/core';
import { workerTest } from './workerScope';

workerTest(
  'uses the worker fixture in the first file',
  ({ browserWorkerValue }) => {
    expect(browserWorkerValue).toBe('worker');
  },
);
