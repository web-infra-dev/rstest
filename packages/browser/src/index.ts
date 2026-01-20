import type { Rstest } from '@rstest/core/browser';
import {
  type BrowserTestRunOptions,
  type BrowserTestRunResult,
  type ListBrowserTestsResult,
  listBrowserTests as listBrowserTestsImpl,
  runBrowserController,
} from './hostController';

export async function runBrowserTests(
  context: Rstest,
  options?: BrowserTestRunOptions,
): Promise<BrowserTestRunResult | void> {
  return runBrowserController(context, options);
}

export async function listBrowserTests(
  context: Rstest,
): Promise<ListBrowserTestsResult> {
  return listBrowserTestsImpl(context);
}

export type {
  BrowserTestRunOptions,
  BrowserTestRunResult,
  ListBrowserTestsResult,
};
