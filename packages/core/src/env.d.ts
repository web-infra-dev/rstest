/// <reference lib="dom" />

declare const RSTEST_VERSION: string;
declare const RSTEST_SELF_CI: boolean;
declare const PLAYWRIGHT_VERSION: string;
// `true` only in the `browser_runtime` build; lets the shared runtime
// dead-code-eliminate the Node-only native-mock bridge out of the browser
// bundle (its `import.meta.resolve`/`pathToFileURL` use crashes in the browser).
declare const RSTEST_TARGET_BROWSER: boolean;

declare module '@rstest/browser/package.json' {
  const content: {
    name: string;
    version: string;
  };
  export default content;
}
