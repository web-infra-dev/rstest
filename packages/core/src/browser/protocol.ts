import type { SnapshotUpdateState } from '@vitest/snapshot';
import type { RuntimeConfig, TestFileResult, TestResult } from '../types';

export type SerializedRuntimeConfig = RuntimeConfig;

export type BrowserProjectRuntime = {
  name: string;
  environmentName: string;
  projectRoot: string;
  runtimeConfig: SerializedRuntimeConfig;
};

/**
 * Test file info with associated project name.
 * Used to track which project a test file belongs to.
 */
export type TestFileInfo = {
  testPath: string;
  projectName: string;
};

export type BrowserHostConfig = {
  rootPath: string;
  projects: BrowserProjectRuntime[];
  snapshot: {
    updateSnapshot: SnapshotUpdateState;
  };
  testFile?: string; // Optional: if provided, only run this specific test file
  /**
   * Base URL for runner (iframe) pages.
   */
  runnerUrl?: string;
  /**
   * WebSocket port for container RPC.
   */
  wsPort?: number;
};

export type BrowserClientMessage =
  | { type: 'ready' }
  | {
      type: 'file-start';
      payload: { testPath: string; projectName: string };
    }
  | { type: 'case-result'; payload: TestResult }
  | { type: 'file-complete'; payload: TestFileResult }
  | {
      type: 'log';
      payload: {
        level: 'log' | 'warn' | 'error' | 'info' | 'debug';
        content: string;
        testPath: string;
        type: 'stdout' | 'stderr';
        trace?: string;
      };
    }
  | {
      type: 'fatal';
      payload: { message: string; stack?: string };
    }
  | { type: 'complete' };
