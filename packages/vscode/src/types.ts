import type { TestFileResult, TestResult } from '@rstest/core';

//#region master -> worker
export type WorkerInitData = {
  rstestPath: string;
  root: string;
  configFilePath: string;
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
