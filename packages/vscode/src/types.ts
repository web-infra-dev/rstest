import type { RstestConfig } from '@rstest/core';

//#region master -> worker
export type WorkerInitOptions = RstestConfig & {
  apiPath: string;
  configFilePath: string;
  coreVersion?: string;
  fileFilters?: string[];
  rstestPath: string;
  command?: 'run' | 'list' | 'watch';
};
