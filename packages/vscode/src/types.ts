import type { RstestConfig } from '@rstest/core';
import type { FileFilterMode } from '@rstest/core/api';

//#region master -> worker
export type WorkerInitOptions = RstestConfig & {
  apiPath: string;
  configFilePath: string;
  coreVersion?: string;
  fileFilterMode?: FileFilterMode;
  fileFilters?: string[];
  rstestPath: string;
  command?: 'run' | 'list' | 'watch';
};
