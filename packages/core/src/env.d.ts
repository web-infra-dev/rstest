import type {
  BrowserClientMessage,
  BrowserHostConfig,
} from './browser/protocol';

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

declare global {
  const RSTEST_VERSION: string;
  const RSTEST_SELF_CI: boolean;

  interface Window {
    __RSTEST_BROWSER_OPTIONS__?: BrowserHostConfig;
    __rstest_dispatch__?: (message: BrowserClientMessage) => void;
    __rstest_container_dispatch__?: (data: unknown) => void;
    __rstest_container_on__?: (data: unknown) => void;
    __RSTEST_DONE__?: boolean;
    __RSTEST_TEST_FILES__?: string[];
  }
}
