import type { Page } from 'playwright';
import type {
  BrowserProviderImplementation,
  BrowserProviderRuntime,
} from '../index';
import { dispatchPlaywrightBrowserRpc } from './dispatchBrowserRpc';
import { launchPlaywrightBrowser } from './runtime';
import { createPlaywrightV8CoverageCollector } from './v8Coverage';

export const playwrightProviderImplementation: BrowserProviderImplementation = {
  name: 'playwright',
  async launchRuntime({
    browserName,
    headless,
    providerOptions,
  }): Promise<BrowserProviderRuntime> {
    return launchPlaywrightBrowser({
      browserName,
      headless,
      providerOptions,
    });
  },
  createV8CoverageCollector({ browserName }) {
    return browserName === 'chromium'
      ? createPlaywrightV8CoverageCollector()
      : null;
  },
  async dispatchRpc({
    containerPage,
    runnerPage,
    request,
    timeoutFallbackMs,
  }): Promise<unknown> {
    return dispatchPlaywrightBrowserRpc({
      containerPage: containerPage as Page | undefined,
      runnerPage: runnerPage as Page | undefined,
      request,
      timeoutFallbackMs,
    });
  },
};
