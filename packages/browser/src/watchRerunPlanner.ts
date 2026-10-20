import { normalize } from 'pathe';
import type { TestFileInfo } from './protocol';
import { getTestPathKey } from './pathUtils';

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
  requestedTestPaths?: string[] | 'all';
};

type WatchFileSetUpdate = {
  currentTestFiles: TestFileInfo[];
  deletedTestFiles: TestFileInfo[];
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
  deferredTestPaths?: string[];
  decision: WatchRerunDecision;
};

const serializeTestFiles = (files: TestFileInfo[]): string => {
  return JSON.stringify(
    files.map((f) => `${f.projectName}:${getTestPathKey(f.testPath)}`).sort(),
  );
};

const normalizeTestFiles = (files: TestFileInfo[]): TestFileInfo[] => {
  return files.map((file) => ({
    ...file,
    testPath: normalize(file.testPath),
  }));
};

const collectTestPaths = (files: TestFileInfo[]): string[] => {
  return [
    ...new Map(
      files.map((file) => [getTestPathKey(file.testPath), file.testPath]),
    ).values(),
  ];
};

const collectDeletedTestFiles = (
  previous: TestFileInfo[],
  current: TestFileInfo[],
): TestFileInfo[] => {
  const currentPathSet = new Set(
    current.map(
      (file) => `${file.projectName}:${getTestPathKey(file.testPath)}`,
    ),
  );
  return previous.filter(
    (file) =>
      !currentPathSet.has(
        `${file.projectName}:${getTestPathKey(file.testPath)}`,
      ),
  );
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
  requestedTestPaths,
}: WatchRerunPlannerInput): WatchRerunPlan => {
  const currentTestFiles = collectWatchTestFiles(projectEntries);
  const normalizedPrevious = normalizeTestFiles(previousTestFiles);
  const fileSetChanged =
    serializeTestFiles(currentTestFiles) !==
    serializeTestFiles(normalizedPrevious);

  if (fileSetChanged) {
    const previousFileSet = new Set(
      normalizedPrevious.map(
        (file) => `${file.projectName}:${getTestPathKey(file.testPath)}`,
      ),
    );
    const addedTestFiles = currentTestFiles.filter(
      (file) =>
        !previousFileSet.has(
          `${file.projectName}:${getTestPathKey(file.testPath)}`,
        ),
    );
    const deletedTestFiles = collectDeletedTestFiles(
      normalizedPrevious,
      currentTestFiles,
    );
    const currentTestPathSet = new Set(
      currentTestFiles.map((file) => getTestPathKey(file.testPath)),
    );
    const fileSetUpdate = {
      currentTestFiles,
      deletedTestFiles,
      deletedTestPaths: [
        ...new Set(
          normalizedPrevious
            .map((file) => file.testPath)
            .filter(
              (testPath) => !currentTestPathSet.has(getTestPathKey(testPath)),
            ),
        ),
      ],
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

    const requestedPathSet =
      requestedTestPaths === undefined || requestedTestPaths === 'all'
        ? undefined
        : new Set(
            requestedTestPaths.map((testPath) => getTestPathKey(testPath)),
          );
    const testPaths =
      requestedPathSet === undefined
        ? collectTestPaths(currentTestFiles)
        : collectTestPaths(
            currentTestFiles.filter(({ testPath }) =>
              requestedPathSet.has(getTestPathKey(testPath)),
            ),
          );
    const deferredTestPaths =
      requestedPathSet === undefined
        ? []
        : collectTestPaths(
            addedTestFiles.filter(
              ({ testPath }) => !requestedPathSet.has(getTestPathKey(testPath)),
            ),
          );

    if (testPaths.length === 0) {
      return {
        fileSetUpdate,
        decision: {
          kind: 'idle',
          message: 'No requested browser test files remain after update.\n',
        },
      };
    }

    return {
      fileSetUpdate,
      ...(deferredTestPaths.length > 0 ? { deferredTestPaths } : {}),
      decision: {
        kind: 'rerun',
        testPaths,
        message: `Test file set changed, re-running ${testPaths.length} file(s)...\n`,
      },
    };
  }

  const requestedPathSet =
    requestedTestPaths === undefined || requestedTestPaths === 'all'
      ? undefined
      : new Set(requestedTestPaths.map((testPath) => getTestPathKey(testPath)));
  const affectedPathSet = new Set([
    ...affectedTestFiles.map((testFile) => getTestPathKey(testFile)),
    ...(requestedTestPaths === 'all'
      ? collectTestPaths(currentTestFiles).map((testPath) =>
          getTestPathKey(testPath),
        )
      : (requestedPathSet ?? [])),
  ]);
  const matchedAffectedFiles = currentTestFiles.filter(({ testPath }) =>
    affectedPathSet.has(getTestPathKey(testPath)),
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
  watchState: {
    lastTestFiles: TestFileInfo[];
    pendingDeletedTestFiles: TestFileInfo[];
  },
): void => {
  if (!update) {
    return;
  }
  watchState.pendingDeletedTestFiles.push(...update.deletedTestFiles);
  watchState.lastTestFiles = update.currentTestFiles;
};
