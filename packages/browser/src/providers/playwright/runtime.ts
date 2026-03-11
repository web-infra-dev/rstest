import type { BrowserProviderContext, BrowserProviderRuntime } from '../index';

export async function launchPlaywrightBrowser({
  browserName,
  headless,
  providerOptions,
}: {
  browserName: 'chromium' | 'firefox' | 'webkit';
  headless: boolean | undefined;
  providerOptions: Record<string, unknown>;
}): Promise<BrowserProviderRuntime> {
  const playwright = await import('playwright');
  const browserType = playwright[browserName];
  const launchOptions = providerOptions.launch as
    | Record<string, unknown>
    | undefined;

  const browser = await browserType.launch({
    ...launchOptions,
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

  const wrappedBrowser: BrowserProviderRuntime['browser'] = {
    close: async () => browser.close(),
    newContext: async ({
      providerOptions: contextProviderOptions,
      viewport,
    }) => {
      const contextOptions = contextProviderOptions?.context as
        | Record<string, unknown>
        | undefined;
      const context = await browser.newContext({
        ...contextOptions,
        viewport,
      });

      return context as unknown as BrowserProviderContext;
    },
  };

  return {
    browser: wrappedBrowser,
  };
}
