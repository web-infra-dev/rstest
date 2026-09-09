import type { Browser } from 'playwright';
import { test as base } from '@rstest/playwright';
import type { PlaywrightOptions } from '@rstest/playwright';

export const browserTest = base.extend({
  playwright: {
    browserName: 'chromium',
    launchOptions: process.env.CI ? { channel: 'chrome' } : undefined,
  } satisfies PlaywrightOptions,
});

declare global {
  var __rstestPlaywrightCrossFileBrowser: Browser | undefined;
}

export const rememberBrowser = (browser: Browser) => {
  const previousBrowser = globalThis.__rstestPlaywrightCrossFileBrowser;
  globalThis.__rstestPlaywrightCrossFileBrowser = browser;
  return previousBrowser;
};
