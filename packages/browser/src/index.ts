import type { Rstest } from '@rstest/core/browser';
import {
  type ListBrowserTestsResult,
  listBrowserTests as listBrowserTestsImpl,
  runBrowserController,
} from './hostController';

export async function runBrowserTests(context: Rstest): Promise<void> {
  await runBrowserController(context);
}

export async function listBrowserTests(
  context: Rstest,
): Promise<ListBrowserTestsResult> {
  return listBrowserTestsImpl(context);
}

export type { ListBrowserTestsResult };

// Export plugin-related types for decoupled plugin architecture
export type {
  PluginMessageContext,
  PluginMessageHandler,
  RstestBrowserExposedApi,
} from './hostController';

export type {
  BrowserPluginRequest,
  BrowserPluginRequestMessage,
  BrowserPluginResponse,
  BrowserPluginResponseEnvelope,
} from './protocol';
