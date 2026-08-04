import { normalize } from 'pathe';
import type { TestFileInfo } from './protocol';

/**
 * Paths the previous cycle ran that the current file set no longer contains.
 * Core prunes its own state from this, so a file deleted mid-session stops
 * being reported instead of lingering as a passing result.
 */
export const collectDeletedTestPaths = (
  previous: TestFileInfo[],
  current: TestFileInfo[],
): string[] => {
  const currentPathSet = new Set(current.map((file) => file.testPath));
  return previous
    .map((file) => file.testPath)
    .filter((testPath) => !currentPathSet.has(testPath));
};

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

type WatchRerunPlan = {
  currentTestFiles: TestFileInfo[];
  filesChanged: boolean;
  normalizedAffectedTestFiles: string[];
  affectedTestFiles: TestFileInfo[];
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
  const filesChanged =
    serializeTestFiles(currentTestFiles) !==
    serializeTestFiles(normalizedPrevious);

  const normalizedAffectedTestFiles = affectedTestFiles.map((testFile) =>
    normalize(testFile),
  );
  const affectedPathSet = new Set(normalizedAffectedTestFiles);
  const matchedAffectedFiles = currentTestFiles.filter((file) =>
    affectedPathSet.has(file.testPath),
  );

  return {
    currentTestFiles,
    filesChanged,
    normalizedAffectedTestFiles,
    affectedTestFiles: matchedAffectedFiles,
  };
};
