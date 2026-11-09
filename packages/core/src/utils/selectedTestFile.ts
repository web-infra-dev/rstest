import type { SelectedTestFile } from '../types';

/**
 * Projects a test path and its owning project name — and, in browser mode, the
 * browser row — into the selection entry shared by the executor `onSelected`
 * callback and `TestRunStartPayload.files`, so the node and browser transports
 * build the shape the same way. The browser name is required there: a
 * (project, testPath) pair alone is ambiguous once several browsers run the
 * same file.
 */
export const toSelectedTestFile = (
  testPath: string,
  project: string,
  browserName?: SelectedTestFile['browserName'],
): SelectedTestFile =>
  browserName === undefined
    ? { testPath, project }
    : { testPath, project, browserName };
