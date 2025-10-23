declare const RSTEST_VERSION: string;
declare const RSTEST_SELF_CI: boolean;

declare module '@rstest/browser-manifest' {
  export const manifest: Array<{
    id: string;
    type: 'setup' | 'test';
    projectName: string;
    projectRoot: string;
    filePath: string;
    testPath?: string;
    relativePath: string;
    load: () => Promise<unknown>;
  }>;
}

declare module 'playwright-core' {
  export const chromium: {
    launch: (options?: any) => Promise<any>;
  };
  export type Browser = any;
  export type Page = any;
}
