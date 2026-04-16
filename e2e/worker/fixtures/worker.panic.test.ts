import { writeSync } from 'node:fs';
import { describe, it } from '@rstest/core';

describe('worker panic', () => {
  it('should crash the worker process', () => {
    writeSync(2, 'RSTEST_WORKER_PANIC_MARKER\n');
    process.abort();
  });
});
