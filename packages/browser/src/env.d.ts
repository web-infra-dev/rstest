import { DISPATCH_MESSAGE_TYPE, DISPATCH_RPC_BRIDGE_NAME } from './protocol';
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
    // Keyed by the sentinel constants so the declared global name and the
    // constant are the same source — renaming a constant moves this key with it,
    // and every `window[CONST]` access site stays in lockstep automatically.
    [DISPATCH_MESSAGE_TYPE]?: (message: BrowserClientMessage) => void;
    [DISPATCH_RPC_BRIDGE_NAME]?: (
      request: BrowserDispatchRequest,
    ) => Promise<unknown>;
    __rstest_container_dispatch__?: (data: unknown) => void;
    __rstest_container_on__?: (data: unknown) => void;
    __RSTEST_DONE__?: boolean;
    __RSTEST_TEST_FILES__?: string[];
  }
}
