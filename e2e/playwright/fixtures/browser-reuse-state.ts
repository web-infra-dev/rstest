import type { Browser } from 'playwright';

declare global {
  var __rstestPlaywrightCrossFileBrowser: Browser | undefined;
}

export const rememberBrowser = (browser: Browser) => {
  const previousBrowser = globalThis.__rstestPlaywrightCrossFileBrowser;
  globalThis.__rstestPlaywrightCrossFileBrowser = browser;
  return previousBrowser;
};
