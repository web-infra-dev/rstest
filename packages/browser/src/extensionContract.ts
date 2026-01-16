import type { BrowserDispatchHandler } from './protocol';

/**
 * @internal
 * Internal extension contract token for Rsbuild plugins.
 * Host exposes this API via `api.useExposed(RSTEST_BROWSER_EXPOSE_ID)`.
 */
export const RSTEST_BROWSER_EXPOSE_ID = 'rstest:browser' as const;

/**
 * @internal
 * Provider helpers for host-side dispatch handlers.
 *
 * The contract is intentionally provider-agnostic. Consumers that depend on a
 * concrete provider should narrow these `unknown` values on their side.
 */
export type ProviderDispatchContext = {
  /** The provider-owned container object hosting runner iframes. */
  getContainerPage: () => unknown;
  /** Frame object for a given test file. */
  getFrameForTestFile: (testFile: string) => Promise<unknown>;
  /** Iframe handle for a given test file. */
  getIframeElementForTestFile: (testFile: string) => Promise<unknown>;
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
  /** Provider host helpers for extensions that need browser access. */
  provider: ProviderDispatchContext;
}
