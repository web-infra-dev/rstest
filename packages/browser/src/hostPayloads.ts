import type { Reporter, TestFileResult } from '@rstest/core/internal/browser';
import type { BrowserLogPayload } from './protocol';

/** Payload for test file start event */
export type TestFileStartPayload = {
  testPath: string;
  projectName: string;
};

/** Payload for log event — single-sourced from the wire protocol. */
export type LogPayload = BrowserLogPayload;

/** Payload for fatal error event */
export type FatalPayload = {
  message: string;
  stack?: string;
};

export type ReporterHookArg<THook extends keyof Reporter> =
  NonNullable<Reporter[THook]> extends (...args: infer TArgs) => unknown
    ? TArgs[0]
    : never;

export type TestFileReadyPayload = ReporterHookArg<'onTestFileReady'>;
export type TestSuiteStartPayload = ReporterHookArg<'onTestSuiteStart'>;
export type TestSuiteResultPayload = ReporterHookArg<'onTestSuiteResult'>;
export type TestCaseStartPayload = ReporterHookArg<'onTestCaseStart'>;
export type ReloadTestFileAck = {
  runId: string;
};
export type HeadedTestFileCompletePayload = TestFileResult & {
  runId?: string;
};
export type DeferredPromise<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

export const getFileTaskId = (testPath: string): string => {
  return `file:${testPath}`;
};

export const toError = (error: unknown): Error => {
  return error instanceof Error ? error : new Error(String(error));
};

export const createDeferredPromise = <T>(): DeferredPromise<T> => {
  let resolve!: DeferredPromise<T>['resolve'];
  let reject!: DeferredPromise<T>['reject'];
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve,
    reject,
  };
};
