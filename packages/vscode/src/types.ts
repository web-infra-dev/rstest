import type { RstestConfig } from '@rstest/core';

//#region master -> worker
export type WorkerInitOptions = RstestConfig & {
  configFilePath: string;
  fileFilters?: string[];
  rstestPath: string;
  command?: 'run' | 'list' | 'watch';
};
