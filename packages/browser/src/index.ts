import type {
  BrowserHostModule,
  BrowserTestRunOptions,
  BrowserTestRunResult,
  RstestContext,
  TestExecutorFactory,
} from '@rstest/core/internal/browser';
import { createBrowserExecutorFactory } from './browserExecutor';
import { validateBrowserConfig } from './configValidation';
import {
  type ListBrowserTestsResult,
  listBrowserTests as listBrowserTestsImpl,
  runBrowserController,
} from './hostController';

export { validateBrowserConfig };

/**
 * Construct the browser {@link TestExecutorFactory} consumed by core's run path
 * (RFC phase 3). The core-side version gate in `loadBrowserModule` runs before
 * this is reachable, so the factory can assume a version-matched host.
 */
export function createExecutorFactory(): TestExecutorFactory {
  return createBrowserExecutorFactory();
}

export async function runBrowserTests(
  context: RstestContext,
  options?: BrowserTestRunOptions,
): Promise<BrowserTestRunResult | void> {
  return runBrowserController(context, options);
}

export async function listBrowserTests(
  context: RstestContext,
  options?: Pick<BrowserTestRunOptions, 'shardedEntries'>,
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
  createExecutorFactory,
  runBrowserTests,
  listBrowserTests,
} satisfies BrowserHostModule);

export type {
  BrowserTestRunOptions,
  BrowserTestRunResult,
  ListBrowserTestsResult,
};
