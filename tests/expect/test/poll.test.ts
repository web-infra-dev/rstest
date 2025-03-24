import { describe, expect, it } from '@rstest/core';

describe('Expect Poll API', () => {
  it('should run expect poll succeed', async () => {
    const logs: string[] = [];
    setTimeout(() => {
      logs.push('hello world');
    }, 100);

    await expect
      .poll(() => logs.some((log) => log.includes('hello world')))
      .toBeTruthy();
  });

  it.fails('should run expect poll failed when unmatched', async () => {
    const logs: string[] = [];
    setTimeout(() => {
      logs.push('hello world');
    }, 100);

    await expect
      .poll(() => logs.some((log) => log.includes('hello world!')))
      .toBeTruthy();
  });

  it.fails('should run expect poll failed when timeout', async () => {
    const logs: string[] = [];
    setTimeout(() => {
      logs.push('hello world');
    }, 100);

    await expect
      .poll(() => logs.some((log) => log.includes('hello world!')), {
        timeout: 50,
      })
      .toBeTruthy();
  });
});
