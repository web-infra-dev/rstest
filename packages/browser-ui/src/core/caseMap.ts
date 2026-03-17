import type { TestInfo } from '@rstest/core/browser-runtime';
import type { CaseInfo } from '../utils/constants';

type CollectedCaseInfo = Extract<TestInfo, { type: 'case' }>;

const createCaseInfo = ({
  filePath,
  test,
  status,
  previousCase,
}: {
  filePath: string;
  test: {
    testId: string;
    name: string;
    parentNames?: string[];
    testPath?: string;
    location?: CaseInfo['location'];
  };
  status: CaseInfo['status'];
  previousCase?: CaseInfo;
}): CaseInfo => {
  const parentNames = (test.parentNames ?? []).filter(Boolean);
  const fullName = [...parentNames, test.name].join('  ') || test.name;

  return {
    id: test.testId,
    name: test.name,
    parentNames,
    fullName,
    status,
    filePath: test.testPath || previousCase?.filePath || filePath,
    location: test.location ?? previousCase?.location,
  };
};

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

    const previous = previousCases[test.testId];

    nextFile[test.testId] = createCaseInfo({
      filePath,
      test,
      status: previous?.status ?? 'idle',
      previousCase: previous,
    });
  };

  for (const test of tests) {
    visit(test);
  }

  return nextFile;
};

export const upsertRunningCase = ({
  filePath,
  test,
  previousCases,
}: {
  filePath: string;
  test: CollectedCaseInfo;
  previousCases: Record<string, CaseInfo>;
}): Record<string, CaseInfo> => {
  const previous = previousCases[test.testId];

  return {
    ...previousCases,
    [test.testId]: createCaseInfo({
      filePath,
      test,
      status: 'running',
      previousCase: previous,
    }),
  };
};
