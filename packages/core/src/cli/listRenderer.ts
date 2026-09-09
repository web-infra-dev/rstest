import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { relative } from 'pathe';
import type { ListedTest } from '../api/types';
import type { ListCommandCollectOptions, Location } from '../types';
import { color, logger, prettyTestPath } from '../utils';

export type ListCommandOptions = ListCommandCollectOptions & {
  includeSuites?: boolean;
  json?: boolean | string;
  printLocation?: boolean;
  summary?: boolean;
};

type InternalListedTest = {
  file: string;
  name?: string;
  project?: string;
  location?: Location;
  type: 'file' | 'suite' | 'case';
};

const SummaryProjectLabel = color.gray('Projects'.padStart(11));
const SummaryTestFileLabel = color.gray('Test Files'.padStart(11));
const SummarySuiteLabel = color.gray('Suites'.padStart(11));
const SummaryTestLabel = color.gray('Tests'.padStart(11));

const getListSummaryCounts = (tests: InternalListedTest[]) => {
  const projects = new Set<string>();
  const files = new Set<string>();
  let suites = 0;
  let testCases = 0;

  for (const test of tests) {
    if (test.project) {
      projects.add(test.project);
    }

    files.add(`${test.project ?? ''}\0${test.file}`);

    if (test.type === 'suite') {
      suites += 1;
    }

    if (test.type === 'case') {
      testCases += 1;
    }
  }

  return {
    projects: projects.size,
    files: files.size,
    suites,
    testCases,
  };
};

const printListSummary = ({
  tests,
  filesOnly,
  includeSuites,
  showProject,
  write,
}: {
  tests: InternalListedTest[];
  filesOnly?: boolean;
  includeSuites?: boolean;
  showProject: boolean;
  write: (message: string) => void;
}) => {
  const counts = getListSummaryCounts(tests);

  write('');

  if (showProject) {
    write(`${SummaryProjectLabel} ${color.bold(`${counts.projects} matched`)}`);
  }

  write(`${SummaryTestFileLabel} ${color.bold(`${counts.files} matched`)}`);

  if (filesOnly) {
    return;
  }

  if (includeSuites) {
    write(`${SummarySuiteLabel} ${color.bold(`${counts.suites} matched`)}`);
  }

  write(`${SummaryTestLabel} ${color.bold(`${counts.testCases} matched`)}`);
};

const createListSummaryPayload = ({
  tests,
  filesOnly,
  includeSuites,
  showProject,
}: {
  tests: InternalListedTest[];
  filesOnly?: boolean;
  includeSuites?: boolean;
  showProject: boolean;
}) => {
  const counts = getListSummaryCounts(tests);
  const summary: {
    files: number;
    projects?: number;
    suites?: number;
    tests?: number;
  } = {
    files: counts.files,
  };

  if (showProject) {
    summary.projects = counts.projects;
  }

  if (!filesOnly) {
    if (includeSuites) {
      summary.suites = counts.suites;
    }
    summary.tests = counts.testCases;
  }

  return summary;
};

export async function renderListTests(
  list: ListedTest[],
  {
    rootPath,
    showProject,
    filesOnly,
    json,
    printLocation,
    includeSuites,
    summary,
  }: ListCommandOptions & { rootPath: string; showProject: boolean },
): Promise<void> {
  const tests: InternalListedTest[] = [];
  for (const test of list) {
    if (test.runMode === 'skip' || test.runMode === 'todo') {
      continue;
    }
    if (filesOnly) {
      tests.push({
        file: test.testPath,
        project: showProject ? test.project : undefined,
        type: 'file',
      });
    } else {
      tests.push({
        file: test.testPath,
        name: test.fullName,
        location: test.location,
        type: test.type,
        project: showProject ? test.project : undefined,
      });
    }
  }

  if (json && json !== 'false') {
    const content = JSON.stringify(
      summary
        ? {
            items: tests,
            summary: createListSummaryPayload({
              tests,
              filesOnly,
              includeSuites,
              showProject,
            }),
          }
        : tests,
      null,
      2,
    );
    if (json !== true && json !== 'true') {
      const jsonPath = isAbsolute(json) ? json : join(rootPath, json);
      mkdirSync(dirname(jsonPath), { recursive: true });
      writeFileSync(jsonPath, content);
    } else {
      logger.log(content);
    }
  } else {
    for (const test of tests) {
      let shortPath = relative(rootPath, test.file);
      if (test.location && printLocation) {
        shortPath = `${shortPath}:${test.location.line}:${test.location.column}`;
      }
      logger.log(
        test.name
          ? `${color.dim(`${shortPath} > `)}${test.name}`
          : prettyTestPath(shortPath),
      );
    }

    if (summary) {
      printListSummary({
        tests,
        filesOnly,
        includeSuites,
        showProject,
        write: logger.log,
      });
    }
  }
}
