/// <reference lib="dom" />

declare const RSTEST_VERSION: string;
declare const RSTEST_SELF_CI: boolean;

/**
 * Module declaration for @rstest/browser (optional peer dependency).
 * The actual types come from the package when installed.
 */
declare module '@rstest/browser' {
  import type { ListCommandResult, RstestContext } from './types';

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
