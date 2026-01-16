/**
 * @internal
 * Internal-only entry for rstest browser mode extensions.
 * Public consumers should import from the package root only.
 * APIs exported from this module are intentionally not part of the public contract.
 */

/** @internal */
export type {
  BrowserDispatchCapability,
  ProviderDispatchContext,
  RstestBrowserExposedApi,
} from './extensionContract';
/** @internal */
export { RSTEST_BROWSER_EXPOSE_ID } from './extensionContract';
export type {
  BrowserTestRunOptions,
  BrowserTestRunResult,
  ListBrowserTestsResult,
} from './index';
export {
  BROWSER_VIEWPORT_PRESET_DIMENSIONS,
  BROWSER_VIEWPORT_PRESET_IDS,
  listBrowserTests,
  resolveBrowserViewportPreset,
  runBrowserTests,
  validateBrowserConfig,
} from './index';
