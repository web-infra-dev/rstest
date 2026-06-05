/// <reference lib="dom" />

declare const RSTEST_VERSION: string;
declare const RSTEST_SELF_CI: boolean;
declare const PLAYWRIGHT_VERSION: string;

declare module '@rstest/browser/package.json' {
  const content: {
    name: string;
    version: string;
  };
  export default content;
}
