import type { TestInfo } from '@rstest/core/browser-runtime';
import type { CaseInfo } from '../utils/constants';

export const buildCollectedCaseMap = ({
  filePath,
  tests,
  previousCases,
}: {
  filePath: string;
  tests: TestInfo[];
  previousCases: Record<string, CaseInfo>;
}): Record<string, CaseInfo> => {
  const nextFile: Record<string, CaseInfo> = {};

  const visit = (test: TestInfo) => {
    if (test.type === 'suite') {
      for (const child of test.tests) {
        visit(child);
      }
      return;
    }

    const parentNames = (test.parentNames ?? []).filter(Boolean);
    const fullName = [...parentNames, test.name].join('  ') || test.name;
    const previous = previousCases[test.testId];

    nextFile[test.testId] = {
      id: test.testId,
      name: test.name,
      parentNames,
      fullName,
      status: previous?.status ?? 'idle',
      filePath: test.testPath || filePath,
      location: test.location,
    };
  };

  for (const test of tests) {
    visit(test);
  }

  return nextFile;
};
