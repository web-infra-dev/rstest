/// <reference lib="dom" />

declare const RSTEST_VERSION: string;
declare const RSTEST_SELF_CI: boolean;
declare const PLAYWRIGHT_VERSION: string;
/** Injected only by the `worker` lib build; read it behind a `typeof` guard. */
declare const __RSTEST_WORKER_BUILD__: boolean;

declare module 'tinyrainbow' {
  export function disableDefaultColors(): void;
  export function enabledDefaultColors(): void;
}

declare module '@rstest/browser/package.json' {
  const content: {
    name: string;
    version: string;
  };
  export default content;
}
