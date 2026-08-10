import type { TestFileResult } from '../../types';

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
