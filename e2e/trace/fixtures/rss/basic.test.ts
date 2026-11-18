import { setTimeout as wait } from 'node:timers/promises';
import { expect, test, rstest } from '@rstest/core';
import { value } from './src/value';

const waitReal = wait;

test('basic', async () => {
  if (process.env.TRACE_RSS_STAGE === 'tests') {
    process.stdout.write('BLOCKED:tests\n');
    await new Promise((resolve) => setTimeout(resolve, 30000));
  }
  if (process.env.TRACE_RSS_PERIODIC) {
    rstest.useFakeTimers();
    try {
      const allocation = Buffer.alloc(8 * 1024 * 1024, 1);
      await waitReal(1200);
      expect(allocation[0]).toBe(1);
    } finally {
      rstest.useRealTimers();
    }
  }
  expect(value).toBe(2);
});
