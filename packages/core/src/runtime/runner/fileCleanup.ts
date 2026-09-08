import type { TestFileResult } from '../../types';
import type { MaybePromise } from '../../types';

type FileCleanup = () => MaybePromise<void>;

const FILE_CLEANUP_REGISTRY = Symbol.for('rstest.file.cleanup.registry');

const getFileCleanupRegistry = (): Set<FileCleanup> => {
  const globalObject = globalThis as unknown as Record<PropertyKey, unknown>;
  let registry = globalObject[FILE_CLEANUP_REGISTRY] as
    Set<FileCleanup> | undefined;

  if (!registry) {
    registry = new Set<FileCleanup>();
    globalObject[FILE_CLEANUP_REGISTRY] = registry;
  }

  return registry;
};

export const registerFileCleanup = (cleanup: FileCleanup): (() => boolean) => {
  const registry = getFileCleanupRegistry();
  registry.add(cleanup);
  return () => registry.delete(cleanup);
};

export const takeFileCleanups = (): FileCleanup[] => {
  const registry = getFileCleanupRegistry();
  const cleanups = [...registry];
  registry.clear();
  return cleanups;
};

export const createFileCleanupTimeoutResult = ({
  message,
  projectName,
  result,
  testPath,
}: {
  message: string;
  projectName: string;
  result?: TestFileResult;
  testPath: string;
}): TestFileResult => {
  const error = new Error(message);
  return {
    ...(result ?? {
      name: '',
      project: projectName,
      results: [],
      testId: `file:${testPath}`,
      testPath,
    }),
    status: 'fail',
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
