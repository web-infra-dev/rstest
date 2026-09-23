import type { RstestConfig } from '@rstest/core';

//#region master -> worker
// The IPC channel is JSON, so a `RegExp` pattern would arrive as `{}`.
export type WorkerInitOptions = Omit<RstestConfig, 'testNamePattern'> & {
  testNamePattern?: string;
  apiPath: string;
  configFilePath: string;
  coreVersion?: string;
  fileFilters?: string[];
  rstestPath: string;
  command?: 'run' | 'list' | 'watch';
};
