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
