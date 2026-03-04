import type { BrowserDispatchHandler } from './protocol';

export type RstestBrowserProvider = 'playwright';

/**
 * @internal
 * Internal extension contract token for Rsbuild plugins.
 * Host exposes this API via `api.useExposed(RSTEST_BROWSER_EXPOSE_ID)`.
 */
export const RSTEST_BROWSER_EXPOSE_ID = 'rstest:browser' as const;

/**
 * @internal
 * Provider helpers for Playwright-based dispatch handlers.
 * Kept structurally typed to allow host-side wrappers in plugin space.
 */
export type PlaywrightDispatchContext = {
  /** The container Page hosting runner iframes. */
  getContainerPage: () => import('playwright').Page;
  /** Iframe handle for a given test file. */
  getFrameForTestFile: (
    testFile: string,
  ) => Promise<import('playwright').Frame>;
  /** Frame object for a given test file. */
  getIframeElementForTestFile: (
    testFile: string,
  ) => Promise<import('playwright').ElementHandle<HTMLIFrameElement>>;
};

/**
 * @internal
 * Provider-discriminated dispatch context passed to extension handlers.
 */
export type BrowserDispatchContext = {
  provider: RstestBrowserProvider;
  playwright: PlaywrightDispatchContext;
};

/**
 * @internal
 * API exposed by @rstest/browser to Rsbuild plugins for registering
 * namespace handlers on the host dispatch router.
 */
export interface RstestBrowserExposedApi {
  /** Register a dispatch handler for one dispatch namespace. */
  registerDispatchHandler: (
    namespace: string,
    handler: BrowserDispatchHandler,
  ) => void;
  /** Provider context helpers for extension handlers that need DOM/browser access. */
  browser: BrowserDispatchContext;
}
