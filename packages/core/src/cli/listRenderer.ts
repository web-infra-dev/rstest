import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { relative } from 'pathe';
import type {
  ListCommandCollectOptions,
  ListCommandCollectionResult,
  Location,
  TestInfo,
} from '../types';
import {
  bgColor,
  color,
  getTaskNameWithPrefix,
  logger,
  prettyTestPath,
  ROOT_SUITE_NAME,
} from '../utils';

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
  result: ListCommandCollectionResult,
  {
    rootPath,
    filesOnly,
    json,
    printLocation,
    includeSuites,
    summary,
  }: ListCommandOptions & { rootPath: string },
): Promise<void> {
  const { list, errors, showProject, getSourceMap } = result;
  const hasError = list.some((file) => file.errors?.length) || errors.length;
  if (hasError) {
    const { printError } = await import('../utils/error');
    for (const file of list) {
      const relativePath = relative(rootPath, file.testPath);

      if (file.errors?.length) {
        //  FAIL  tests/index.test.ts
        logger.log(`${bgColor('bgRed', ' FAIL ')} ${relativePath}`);

        for (const error of file.errors) {
          await printError(
            error,
            async (name) => {
              const sourceMap = await getSourceMap(name);
              return sourceMap ? JSON.parse(sourceMap) : null;
            },
            rootPath,
          );
        }
      }
    }

    if (errors.length) {
      const { printError } = await import('../utils/error');
      for (const error of errors || []) {
        logger.stderr(bgColor('bgRed', ' Unhandled Error '));
        await printError(
          error,
          async (name) => {
            const sourceMap = await getSourceMap(name);
            return sourceMap ? JSON.parse(sourceMap) : null;
          },
          rootPath,
        );
      }
    }
    return;
  }

  const tests: InternalListedTest[] = [];

  const traverseTests = (test: TestInfo) => {
    if (['skip', 'todo'].includes(test.runMode)) {
      return;
    }

    if (
      test.type === 'case' ||
      (includeSuites && test.type === 'suite' && test.name !== ROOT_SUITE_NAME)
    )
      tests.push({
        file: test.testPath,
        name: getTaskNameWithPrefix(test),
        location: test.location,
        type: test.type,
        project: showProject ? test.project : undefined,
      });

    if (test.type === 'suite') {
      for (const child of test.tests) {
        traverseTests(child);
      }
    }
  };

  for (const file of list) {
    if (filesOnly) {
      if (showProject) {
        tests.push({
          file: file.testPath,
          project: file.project,
          type: 'file',
        });
      } else {
        tests.push({
          file: file.testPath,
          type: 'file',
        });
      }
      continue;
    }
    for (const test of file.tests) {
      traverseTests(test);
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
