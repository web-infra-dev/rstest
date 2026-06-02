/// <reference lib="dom" />

declare const RSTEST_VERSION: string;
declare const RSTEST_SELF_CI: boolean;
declare const PLAYWRIGHT_VERSION: string;

/**
 * Module declaration for @rstest/browser/internal (optional peer dependency).
 * These host-side entries live on the `./internal` subpath, not the public `.`
 * entry; core loads them via `@rstest/browser/internal` (see browserLoader.ts).
 * The actual types come from the package when installed.
 */
declare module '@rstest/browser/internal' {
  import type { ListCommandResult, RstestContext } from './types';

  export function validateBrowserConfig(context: RstestContext): void;
  export function runBrowserTests(context: RstestContext): Promise<void>;
  export function listBrowserTests(context: RstestContext): Promise<{
    list: ListCommandResult[];
    close: () => Promise<void>;
  }>;
}

declare module '@rstest/browser/package.json' {
  const content: {
    name: string;
    version: string;
  };
  export default content;
}
