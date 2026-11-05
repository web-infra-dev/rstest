import type {
  RawTestCaseInfo,
  RawTestFileInfo,
  RawTestResult,
  RawTestSuiteInfo,
} from '@rstest/core/internal/browser';
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

export type TestFileReadyPayload = RawTestFileInfo;
export type TestSuiteStartPayload = RawTestSuiteInfo;
export type TestSuiteResultPayload = RawTestResult;
export type TestCaseStartPayload = RawTestCaseInfo;

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
