import type {
  BrowserTestRunOptions,
  BrowserTestRunResult,
  Rstest,
} from '@rstest/core/browser';
import {
  type ListBrowserTestsResult,
  listBrowserTests as listBrowserTestsImpl,
  runBrowserController,
} from './hostController';

export { validateBrowserConfig } from './configValidation';

export {
  BROWSER_VIEWPORT_PRESET_DIMENSIONS,
  BROWSER_VIEWPORT_PRESET_IDS,
  resolveBrowserViewportPreset,
} from './viewportPresets';

export async function runBrowserTests(
  context: Rstest,
  options: BrowserTestRunOptions,
): Promise<BrowserTestRunResult | void> {
  return runBrowserController(context, options);
}

export async function listBrowserTests(
  context: Rstest,
  options: BrowserTestRunOptions,
): Promise<ListBrowserTestsResult> {
  return listBrowserTestsImpl(context, options);
}

export type {
  BrowserTestRunOptions,
  BrowserTestRunResult,
  ListBrowserTestsResult,
};
