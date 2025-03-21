import type { RstestContext } from './core';

export type EntryInfo = {
  filePath: string;
  originPath: string;
};

// biome-ignore lint/complexity/noBannedTypes: <explanation>
export type RunnerRPC = {};
// biome-ignore lint/complexity/noBannedTypes: <explanation>
export type RuntimeRPC = {};

export type RunWorkerOptions = {
  options: {
    entryInfo: EntryInfo;
    assetFiles: Record<string, string>;
    context: RstestContext;
  };
  rpcMethods: RuntimeRPC;
};

export type WorkerState = {
  environment: string;
  filePath: string;
};
