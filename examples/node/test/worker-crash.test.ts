import { execSync } from 'node:child_process';
import { describe, expect, it } from '@rstest/core';

describe('Worker crash', () => {
  it('completes quickly then crashes after idle', () => {
    // This test completes immediately. With isolate: false, the worker goes
    // idle in tinypool's pool. The delayed kill fires when no task is pending,
    // so tinypool's "Worker exited unexpectedly" error escapes the .catch()
    // and becomes an uncaughtException in the main process.
    setTimeout(() => {
      execSync(`kill -9 ${process.pid}`);
    }, 200);
    expect(1 + 1).toBe(2);
  });
});
