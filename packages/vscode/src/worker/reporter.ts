import { Writable } from 'node:stream';
import type { Reporter } from '@rstest/core';
import { masterApi } from '.';

export class ProgressReporter implements Reporter {
  constructor(private runId: string) {}
  onTestFileStart: Reporter['onTestFileStart'] = (param) => {
    masterApi.onTestProgress(this.runId, 'onTestFileStart', param);
  };
  onTestFileResult: Reporter['onTestFileResult'] = (param) => {
    masterApi.onTestProgress(this.runId, 'onTestFileResult', param);
  };
  onTestSuiteStart: Reporter['onTestSuiteStart'] = (param) => {
    masterApi.onTestProgress(this.runId, 'onTestSuiteStart', param);
  };
  onTestSuiteResult: Reporter['onTestSuiteResult'] = (param) => {
    masterApi.onTestProgress(this.runId, 'onTestSuiteResult', param);
  };
  onTestCaseStart: Reporter['onTestCaseStart'] = (param) => {
    masterApi.onTestProgress(this.runId, 'onTestCaseStart', param);
  };
  onTestCaseResult: Reporter['onTestCaseResult'] = (param) => {
    masterApi.onTestProgress(this.runId, 'onTestCaseResult', param);
  };
}

export class ProgressLogger {
  constructor(private runId: string) {}
  outputStream = new Writable({
    decodeStrings: false,
    write: (chunk, _encoding, cb) => {
      masterApi.onTestProgress(this.runId, 'onOutput', chunk);
      cb(null);
    },
  });
  errorStream = new Writable({
    write: (_chunk, _encoding, cb) => cb(null),
  });
  getColumns = () => Number.POSITIVE_INFINITY;
}
