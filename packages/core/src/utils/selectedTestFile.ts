import type { SelectedTestFile } from '../types';

/**
 * Projects a test path and its owning project name into the selection entry
 * shared by the executor `onSelected` callback and `TestRunStartPayload.files`,
 * so the node and browser transports build the shape the same way.
 */
export const toSelectedTestFile = (
  testPath: string,
  project: string,
): SelectedTestFile => ({ testPath, project });
