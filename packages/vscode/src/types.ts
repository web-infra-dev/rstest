import type { TestFileResult, TestResult } from '@rstest/core';

//#region master -> worker
export type WorkerInitData = {
  rstestPath: string;
  root: string;
  configFilePath: string;
};

export type WorkerRunTestData = {
  runId: string;
  fileFilters: string[];
  testNamePattern?: string | RegExp;
  updateSnapshot?: boolean;
};
// #endregion

//#region worker -> master
export type WorkerEventFinish = {
  testResults: TestResult[];
  testFileResults?: TestFileResult[];
};
//#endregion
