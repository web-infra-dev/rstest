import type { RawTestFileResult } from '../../types';
import {
  type CleanupCallback,
  createCleanupRegistry,
  type RegisterCleanup,
} from './cleanupRegistry';

export type FileCleanup = CleanupCallback;

const fileCleanups = createCleanupRegistry('file');

export const registerFileCleanup: RegisterCleanup = fileCleanups.register;
export const installFileCleanupBridge: (
  runtimeGlobal: Record<PropertyKey, unknown>,
) => void = fileCleanups.installBridge;
export const takeFileCleanups: () => FileCleanup[] = fileCleanups.take;

export const createFileCleanupTimeoutResult = ({
  message,
  projectName,
  result,
  testPath,
}: {
  message: string;
  projectName: string;
  result?: RawTestFileResult;
  testPath: string;
}): RawTestFileResult => {
  const error = new Error(message);
  return {
    ...(result ?? {
      name: '',
      project: projectName,
      results: [],
      testId: `file:${testPath}`,
      testPath,
    }),
    status: 'failed',
    errors: [
      ...(result?.errors ?? []),
      {
        fullStack: true,
        message: error.message,
        name: error.name,
        stack: error.stack,
      },
    ],
  };
};
