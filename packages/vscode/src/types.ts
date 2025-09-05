import type { TestFileResult, TestResult } from '@rstest/core';

//#region master -> worker
export type WorkerInitData = {
  type: 'init';
  rstestPath: string;
  cwd: string;
};

export type WorkerRunTestData = {
  id: string;
  type: 'runTest';
  fileFilters: string[];
  testNamePattern: string;
};
// #endregion

//#region worker -> master
export type WorkerEvent = WorkerEventFinish;

export type WorkerEventFinish = {
  type: 'finish';
  id: string;
  testResults: TestResult[];
  testFileResults?: TestFileResult[];
};
//#endregion
