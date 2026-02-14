import type { BrowserProviderRuntime } from '../index';

type PlaywrightModule = typeof import('playwright');
type PlaywrightBrowserType = PlaywrightModule['chromium'];

export async function launchPlaywrightBrowser({
  browserName,
  headless,
}: {
  browserName: 'chromium' | 'firefox' | 'webkit';
  headless: boolean | undefined;
}): Promise<BrowserProviderRuntime> {
  const playwright = await import('playwright');
  const browserType = playwright[browserName] as PlaywrightBrowserType;

  const browser = await browserType.launch({
    headless,
    // Chromium-specific args (ignored by other browsers)
    args:
      browserName === 'chromium'
        ? [
            '--disable-popup-blocking',
            '--no-first-run',
            '--no-default-browser-check',
          ]
        : undefined,
  });

  return {
    browser: browser as unknown as BrowserProviderRuntime['browser'],
  };
}
