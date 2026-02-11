import { normalize } from 'pathe';
import type { TestFileInfo } from './protocol';

export type WatchPlannerProjectEntry = {
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

export type WatchRerunPlan = {
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

  const currentFileMap = new Map(
    currentTestFiles.map((file) => [file.testPath, file] as const),
  );

  const matchedAffectedFiles = normalizedAffectedTestFiles
    .map((testFile) => currentFileMap.get(testFile))
    .filter((file): file is TestFileInfo => Boolean(file));

  return {
    currentTestFiles,
    filesChanged,
    normalizedAffectedTestFiles,
    affectedTestFiles: matchedAffectedFiles,
  };
};
