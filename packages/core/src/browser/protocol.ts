import type { SnapshotUpdateState } from '@vitest/snapshot';
import type { RuntimeConfig, TestFileResult, TestResult } from '../types';

export type BrowserManifestEntry = {
  id: string;
  type: 'setup' | 'test';
  projectName: string;
  projectRoot: string;
  filePath: string;
  relativePath: string;
  testPath?: string;
};

export type SerializedRuntimeConfig = RuntimeConfig;

export type BrowserProjectRuntime = {
  name: string;
  environmentName: string;
  projectRoot: string;
  runtimeConfig: SerializedRuntimeConfig;
};

export type BrowserHostConfig = {
  rootPath: string;
  projects: BrowserProjectRuntime[];
  snapshot: {
    updateSnapshot: SnapshotUpdateState;
  };
  testFile?: string; // Optional: if provided, only run this specific test file
  testFiles?: string[];
  /**
   * Base URL for runner (iframe) pages.
   */
  runnerUrl?: string;
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
      payload: { level: 'log' | 'warn' | 'error'; message: string };
    }
  | {
      type: 'fatal';
      payload: { message: string; stack?: string };
    }
  | { type: 'complete' };
