import type { TestFileInfo } from '../protocol';
import type { BrowserRuntime } from '../runtime/types';

export type WatchContext = {
  runtime: BrowserRuntime | null;
  lastTestFiles: TestFileInfo[];
  hooksEnabled: boolean;
  cleanupRegistered: boolean;
  chunkHashes: Map<string, string>;
  affectedTestFiles: string[];
};

export const watchContext: WatchContext = {
  runtime: null,
  lastTestFiles: [],
  hooksEnabled: false,
  cleanupRegistered: false,
  chunkHashes: new Map(),
  affectedTestFiles: [],
};
