import { normalize } from 'pathe';
import type { TestFileInfo } from './protocol';

type WatchPlannerProjectEntry = {
  project: {
    name: string;
  };
  testFiles: string[];
};

type WatchRerunPlannerInput = {
  projectEntries: WatchPlannerProjectEntry[];
  previousTestFiles: TestFileInfo[];
  affectedTestFiles: string[];
};

type WatchFileSetUpdate = {
  currentTestFiles: TestFileInfo[];
  deletedTestPaths: string[];
};

type WatchRerunDecision =
  | {
      kind: 'rerun';
      testPaths: string[];
      message: string;
    }
  | {
      kind: 'empty';
      message: string;
    }
  | {
      kind: 'idle';
      message: string;
    };

type WatchRerunPlan = {
  fileSetUpdate?: WatchFileSetUpdate;
  decision: WatchRerunDecision;
};

const serializeTestFiles = (files: TestFileInfo[]): string => {
  return JSON.stringify(
    files.map((f) => `${f.projectName}:${f.testPath}`).sort(),
  );
};

const normalizeTestFiles = (files: TestFileInfo[]): TestFileInfo[] => {
  return files.map((file) => ({
    ...file,
    testPath: normalize(file.testPath),
  }));
};

const collectTestPaths = (files: TestFileInfo[]): string[] => {
  return [...new Set(files.map((file) => file.testPath))];
};

const collectDeletedTestPaths = (
  previous: TestFileInfo[],
  current: TestFileInfo[],
): string[] => {
  const currentPathSet = new Set(current.map((file) => file.testPath));
  return previous
    .map((file) => file.testPath)
    .filter((testPath) => !currentPathSet.has(testPath));
};

export const collectWatchTestFiles = (
  projectEntries: WatchPlannerProjectEntry[],
): TestFileInfo[] => {
  return projectEntries.flatMap((entry) =>
    entry.testFiles.map((testPath) => ({
      testPath: normalize(testPath),
      projectName: entry.project.name,
    })),
  );
};

export const planWatchRerun = ({
  projectEntries,
  previousTestFiles,
  affectedTestFiles,
}: WatchRerunPlannerInput): WatchRerunPlan => {
  const currentTestFiles = collectWatchTestFiles(projectEntries);
  const normalizedPrevious = normalizeTestFiles(previousTestFiles);
  const fileSetChanged =
    serializeTestFiles(currentTestFiles) !==
    serializeTestFiles(normalizedPrevious);

  if (fileSetChanged) {
    const fileSetUpdate = {
      currentTestFiles,
      deletedTestPaths: collectDeletedTestPaths(
        normalizedPrevious,
        currentTestFiles,
      ),
    };
    if (currentTestFiles.length === 0) {
      return {
        fileSetUpdate,
        decision: {
          kind: 'empty',
          message: 'No browser test files remain after update.\n',
        },
      };
    }

    return {
      fileSetUpdate,
      decision: {
        kind: 'rerun',
        testPaths: collectTestPaths(currentTestFiles),
        message: `Test file set changed, re-running ${currentTestFiles.length} file(s)...\n`,
      },
    };
  }

  const affectedPathSet = new Set(
    affectedTestFiles.map((testFile) => normalize(testFile)),
  );
  const matchedAffectedFiles = currentTestFiles.filter(({ testPath }) =>
    affectedPathSet.has(testPath),
  );
  if (matchedAffectedFiles.length === 0) {
    return {
      decision: {
        kind: 'idle',
        message: 'No affected browser test files detected, skipping re-run.\n',
      },
    };
  }

  return {
    decision: {
      kind: 'rerun',
      testPaths: collectTestPaths(matchedAffectedFiles),
      message: `Re-running ${matchedAffectedFiles.length} affected test file(s)...\n`,
    },
  };
};

export const commitWatchFileSetUpdate = (
  update: WatchFileSetUpdate | undefined,
  watchState: { lastTestFiles: TestFileInfo[] },
  pruneDeletedTestPaths: (testPaths: string[]) => void,
): void => {
  if (!update) {
    return;
  }
  if (update.deletedTestPaths.length > 0) {
    pruneDeletedTestPaths(update.deletedTestPaths);
  }
  watchState.lastTestFiles = update.currentTestFiles;
};
