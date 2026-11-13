import { rstest } from '@rstest/core';
import { expect, test as base } from '@rstest/playwright';
import type { Browser } from 'playwright';

const test = base.extend({
  playwright: {
    launchOptions: process.env.CI ? { channel: 'chrome' } : undefined,
    trace: { mode: 'retain-on-failure', summary: false, print: false },
  },
});

let previousBrowser: Browser;

test.sequential('stalled cleanup', async ({ browser, context }) => {
  previousBrowser = browser;
  browser.once('disconnected', () => {
    console.log('RSTEST_PLAYWRIGHT_TIMEOUT_BROWSER_CLOSED');
  });
  const stage = process.env.RSTEST_E2E_CLEANUP_STAGE;
  const hookTimeout = rstest.getConfig().hookTimeout;
  const stall = () => {
    console.log(
      `RSTEST_PLAYWRIGHT_STALLED_${stage}`,
      rstest.getConfig().hookTimeout,
    );
    // The injected operation has already captured its short deadline. Let
    // real context/browser cleanup and the recovery test use the normal budget.
    rstest.setConfig({ hookTimeout });
    return new Promise<void>(() => {});
  };
  if (stage === 'trace') {
    context.tracing.stop = stall;
    context.on('close', () => {
      console.log('RSTEST_PLAYWRIGHT_TIMEOUT_CONTEXT_CLOSED');
    });
  } else if (stage === 'browser') {
    browser.close = stall;
  } else {
    context.close = stall;
  }

  // Setup has its own test budget; only the injected cleanup uses this limit.
  rstest.setConfig({ hookTimeout: 200 });
  if (process.env.RSTEST_E2E_CLEANUP_RESULT === 'timeout') {
    return new Promise<void>(() => {});
  }
  if (process.env.RSTEST_E2E_CLEANUP_RESULT === 'fail') {
    throw new Error('original body failure');
  }
});

if (process.env.RSTEST_E2E_CLEANUP_STAGE !== 'browser') {
  test.sequential(
    'recovers after stalled cleanup',
    async ({ browser, page }) => {
      expect(previousBrowser.isConnected()).toBe(false);
      expect(browser).not.toBe(previousBrowser);
      await page.setContent('<h1>Recovered</h1>');
      await expect(page.locator('h1')).toHaveText('Recovered');
      console.log('RSTEST_PLAYWRIGHT_TIMEOUT_RECOVERED');
    },
  );
}
