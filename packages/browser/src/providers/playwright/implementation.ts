import type { Page } from 'playwright';
import type {
  BrowserProviderImplementation,
  BrowserProviderRuntime,
} from '../index';
import { dispatchPlaywrightBrowserRpc } from './dispatchBrowserRpc';
import { launchPlaywrightBrowser } from './runtime';

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
