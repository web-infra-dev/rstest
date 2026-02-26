import type { BrowserRpcRequest } from '../rpcProtocol';
import { playwrightProviderImplementation } from './playwright';

/**
 * Browser provider contract hub.
 *
 * When adding a new built-in provider, implement `BrowserProviderImplementation`
 * and register it in `providerImplementations` below.
 */
export type BrowserProvider = 'playwright';

/** Minimal console shape needed by host logging bridge. */
export type BrowserConsoleMessage = {
  text: () => string;
};

/**
 * Minimal page API surface required by hostController.
 *
 * This is a structural type (shape interface), NOT a direct Playwright import.
 * It currently mirrors a subset of Playwright's Page API because that is the
 * only provider. When adding a second provider whose page primitive diverges
 * (e.g. WebDriver BiDi), consider pushing page-level orchestration (goto,
 * exposeFunction, addInitScript, event listeners) into provider-specific
 * implementations so hostController only calls high-level semantic methods.
 */
export type BrowserProviderPage = {
  goto: (url: string, options?: { waitUntil?: 'load' }) => Promise<unknown>;
  exposeFunction: (name: string, fn: (...args: any[]) => any) => Promise<void>;
  addInitScript: (script: string) => Promise<void>;
  on: {
    (event: 'popup', listener: (page: BrowserProviderPage) => void): void;
    (
      event: 'console',
      listener: (message: BrowserConsoleMessage) => void,
    ): void;
  };
  close: () => Promise<void>;
};

/** Minimal browser context API surface required by hostController. */
export type BrowserProviderContext = {
  newPage: () => Promise<BrowserProviderPage>;
  on: (event: 'page', listener: (page: BrowserProviderPage) => void) => void;
  close: () => Promise<void>;
};

/** Minimal browser API surface required by hostController. */
export type BrowserProviderBrowser = {
  close: () => Promise<void>;
  newContext: (options: {
    viewport: { width: number; height: number } | null;
  }) => Promise<BrowserProviderContext>;
};

/** Provider launch result consumed by hostController. */
export type BrowserProviderRuntime = {
  browser: BrowserProviderBrowser;
};

/** Input contract for browser launch. */
export type LaunchBrowserInput = {
  browserName: 'chromium' | 'firefox' | 'webkit';
  headless: boolean | undefined;
};

/** Input contract for provider-side browser RPC dispatch. */
export type DispatchBrowserRpcInput = {
  containerPage?: BrowserProviderPage;
  runnerPage?: BrowserProviderPage;
  request: BrowserRpcRequest;
  timeoutFallbackMs: number;
};

/**
 * Core provider implementation contract.
 *
 * Any new built-in provider must:
 * - launch browser runtime for test execution
 * - execute browser RPC requests (locator actions + assertions)
 */
export type BrowserProviderImplementation = {
  name: BrowserProvider;
  launchRuntime: (input: LaunchBrowserInput) => Promise<BrowserProviderRuntime>;
  dispatchRpc: (input: DispatchBrowserRpcInput) => Promise<unknown>;
};

const providerImplementations: Record<
  BrowserProvider,
  BrowserProviderImplementation
> = {
  playwright: playwrightProviderImplementation,
};

export function getBrowserProviderImplementation(
  provider: BrowserProvider,
): BrowserProviderImplementation {
  const implementation = providerImplementations[provider];
  if (!implementation) {
    throw new Error(`Unsupported browser provider: ${String(provider)}`);
  }
  return implementation;
}
