import type { TestFileResult, TestResult } from '@rstest/core';

//#region master -> worker
export type WorkerInitData = {
  rstestPath: string;
  cwd: string;
};

export type WorkerRunTestData = {
  id: string;
  fileFilters: string[];
  testNamePattern: string;
};
// #endregion

//#region worker -> master
export type WorkerEventFinish = {
  testResults: TestResult[];
  testFileResults?: TestFileResult[];
};
//#endregion
