import { expect, rstest, test } from '@rstest/core';
import type { Page } from 'playwright';

const createPage = (title: string) =>
  ({
    goto: async () => null,
    locator: () => ({}),
    title: async () => title,
    url: () => 'https://example.com/dashboard',
  }) as unknown as Page;

const realPerformanceNow = performance.now.bind(performance);

test('uses core real timers when imported after fake timers are enabled', async () => {
  try {
    rstest.useFakeTimers({ now: 0 });
    const realStart = realPerformanceNow();
    const imported = await import('../src/expect');
    await expect(
      imported.expect(createPage('Example Domain')).toHaveTitle('Other', {
        timeout: 20,
      }),
    ).rejects.toThrow('Expected page to have title');

    expect(Date.now()).toBe(0);
    expect(realPerformanceNow() - realStart).toBeLessThan(1000);
  } finally {
    rstest.useRealTimers();
  }
});
