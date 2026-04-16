import type {
  BrowserClientMessage,
  BrowserDispatchRequest,
  BrowserHostConfig,
} from './protocol';

declare module '@rstest/browser-manifest' {
  export type ManifestProjectConfig = {
    name: string;
    environmentName: string;
    projectRoot: string;
  };

  export type ManifestTestContext = {
    getTestKeys: () => string[];
    loadTest: (key: string) => Promise<unknown>;
    projectRoot: string;
  };

  export const projects: ManifestProjectConfig[];

  export const projectSetupLoaders: Record<
    string,
    Array<() => Promise<unknown>>
  >;

  export const projectTestContexts: Record<string, ManifestTestContext>;

  // Backward compatibility exports
  export const projectConfig: ManifestProjectConfig | undefined;
  export const setupLoaders: Array<() => Promise<unknown>>;
  export const getTestKeys: () => string[];
  export const loadTest: (key: string) => Promise<unknown>;
}

declare global {
  const RSTEST_VERSION: string;

  interface Window {
    __RSTEST_BROWSER_OPTIONS__?: BrowserHostConfig;
    __rstest_dispatch__?: (message: BrowserClientMessage) => void;
    __rstest_dispatch_rpc__?: (
      request: BrowserDispatchRequest,
    ) => Promise<unknown>;
    __rstest_container_dispatch__?: (data: unknown) => void;
    __rstest_container_on__?: (data: unknown) => void;
    __RSTEST_DONE__?: boolean;
    __RSTEST_TEST_FILES__?: string[];
  }
}
