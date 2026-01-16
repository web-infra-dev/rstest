import type { BrowserDispatchHandler } from './protocol';

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
 * Capability for registering host-side dispatch namespace handlers.
 */
export interface BrowserDispatchCapability {
  registerDispatchHandler: (
    namespace: string,
    handler: BrowserDispatchHandler,
  ) => void;
}

/**
 * @internal
 * API exposed by @rstest/browser to Rsbuild plugins.
 *
 * This is intentionally modeled as a capability object rather than exposing
 * browser-internal state trees. Extensions consume only the concrete host
 * abilities they need.
 */
export interface RstestBrowserExposedApi {
  /** Dispatch-router extension capability. */
  dispatch: BrowserDispatchCapability;
  /** Playwright host helpers for extensions that need browser access. */
  playwright: PlaywrightDispatchContext;
}
