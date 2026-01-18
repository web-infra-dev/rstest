import type { rsbuild } from '@rstest/core/browser';
import type { BrowserContext, Page } from 'playwright';
import type { WebSocketServer } from 'ws';
import type { BrowserHostConfig } from '../protocol';
import type { ContainerRpcManager } from '../rpc/containerRpcManager';

export type RsbuildDevServer = rsbuild.RsbuildDevServer;
export type RsbuildInstance = rsbuild.RsbuildInstance;

export type PlaywrightModule = typeof import('playwright');
export type BrowserType = PlaywrightModule['chromium'];
export type BrowserInstance = Awaited<ReturnType<BrowserType['launch']>>;

export type VirtualModulesPluginInstance = InstanceType<
  (typeof rsbuild.rspack.experiments)['VirtualModulesPlugin']
>;

export type BrowserProjectEntries = {
  project: import('@rstest/core/browser').ProjectContext;
  setupFiles: string[];
  testFiles: string[];
};

export type BrowserRuntime = {
  rsbuildInstance: RsbuildInstance;
  devServer: RsbuildDevServer;
  browser: BrowserInstance;
  port: number;
  wsPort: number;
  manifestPath: string;
  tempDir: string;
  manifestPlugin: VirtualModulesPluginInstance;
  containerPage?: Page;
  containerContext?: BrowserContext;
  setContainerOptions: (options: BrowserHostConfig) => void;
  wss: WebSocketServer;
  rpcManager?: ContainerRpcManager;
};
