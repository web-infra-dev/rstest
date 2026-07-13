import type {
  BrowserHostModule,
  BrowserTestRunOptions,
  BrowserTestRunResult,
  RstestContext,
} from '@rstest/core/internal/browser';
import { validateBrowserConfig } from './configValidation';
import {
  type ListBrowserTestsResult,
  listBrowserTests as listBrowserTestsImpl,
  runBrowserController,
} from './hostController';

export { validateBrowserConfig };

export async function runBrowserTests(
  context: RstestContext,
  options?: BrowserTestRunOptions,
): Promise<BrowserTestRunResult | void> {
  return runBrowserController(context, options);
}

export async function listBrowserTests(
  context: RstestContext,
  options?: Pick<
    BrowserTestRunOptions,
    'shardedEntries' | 'freezeShardedEntries' | 'filesOnly'
  >,
): Promise<ListBrowserTestsResult> {
  // Forward `options` (e.g. `shardedEntries`) so `rstest list --shard` lists
  // only the current shard's browser test files, matching the run path.
  return listBrowserTestsImpl(context, options);
}

/**
 * Compile-time guard: ensure the public host exports satisfy the core-owned
 * {@link BrowserHostModule} contract. This catches drift such as a dropped
 * `options` argument at the load boundary. No runtime side effect.
 */
void ({
  validateBrowserConfig,
  runBrowserTests,
  listBrowserTests,
} satisfies BrowserHostModule);

export type {
  BrowserTestRunOptions,
  BrowserTestRunResult,
  ListBrowserTestsResult,
};
