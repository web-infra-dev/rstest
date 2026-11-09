import type { SelectedTestFile } from '../types';

/**
 * Projects a test path and its owning project name into the selection entry
 * shared by the executor `onSelected` callback and `TestRunStartPayload.files`,
 * so the node and browser transports build the shape the same way. Browser
 * runs use the browser-aware projection below: a (project, testPath) pair
 * alone is ambiguous once several browsers run the same file.
 */
export const toSelectedTestFile = (
  testPath: string,
  project: string,
): SelectedTestFile => ({ testPath, project });

export const toSelectedBrowserTestFile = (
  testPath: string,
  project: string,
  browserName: NonNullable<SelectedTestFile['browserName']>,
): SelectedTestFile => ({ testPath, project, browserName });
