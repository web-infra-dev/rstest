import fs from 'node:fs/promises';
import path from 'node:path';
import { normalize, relative } from 'pathe';
import stripAnsi from 'strip-ansi';
import type {
  Duration,
  GetSourcemap,
  SnapshotSummary,
  TestFileResult,
  TestResult,
} from '../types';
import {
  getTaskNameWithPrefix,
  logger,
  prettyTime,
  TEST_DELIMITER,
} from '../utils';
import { formatStack } from '../utils/error';
import { getPlainSummaryStatusString } from './summary';
import {
  buildPackageManagerReproCommand,
  collectFailures,
  detectPackageManagerAgent,
  escapeMarkdownTableCell,
  type FailureItem,
  formatFullTestName,
  getErrorType,
  pushFencedBlock,
  pushHeading,
} from './utils';

export class GithubActionsReporter {
  private readonly onWritePath: (path: string) => string;
  private readonly rootPath: string;
  private readonly stepSummaryPath?: string;
  private readonly enableAnnotations: boolean;
  private readonly enableSummary: boolean;
  private readonly reportName?: string;

  constructor({
    options,
    rootPath,
    config,
  }: {
    rootPath: string;
    config?: {
      name?: string;
    };
    options: {
      onWritePath: (path: string) => string;
      annotations?: boolean;
      summary?: boolean;
    };
  }) {
    this.onWritePath = options.onWritePath;
    this.rootPath = rootPath;
    this.stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;
    this.enableAnnotations = options.annotations !== false;
    this.enableSummary = options.summary !== false;
    this.reportName = config?.name;
  }

  private log(message: string): void {
    logger.log(`${message}\n`);
  }

  private async appendStepSummary(content: string): Promise<void> {
    if (!this.stepSummaryPath) {
      return;
    }

    try {
      await fs.mkdir(path.dirname(this.stepSummaryPath), { recursive: true });
      await fs.appendFile(this.stepSummaryPath, content, 'utf-8');
    } catch (error) {
      logger.stderr(
        `Failed to write GitHub step summary to ${this.stepSummaryPath}:`,
        error,
      );
    }
  }

  async onTestRunEnd({
    results,
    testResults,
    duration,
    getSourcemap,
    unhandledErrors,
  }: {
    results: TestFileResult[];
    testResults: TestResult[];
    duration: Duration;
    snapshotSummary: SnapshotSummary;
    getSourcemap: GetSourcemap;
    unhandledErrors?: Error[];
    filterRerunTestPaths?: string[];
  }): Promise<void> {
    const failures = collectFailures({
      results,
      testResults,
    });

    if (failures.length > 0 && this.enableAnnotations) {
      const { parseErrorStacktrace } = await import('../utils/error');

      const logs: string[] = [];

      for (const { test, errors } of failures) {
        const { testPath } = test;
        const nameStr = getTaskNameWithPrefix(test);
        const shortPath = relative(this.rootPath, testPath);
        const title = `${shortPath} ${TEST_DELIMITER} ${nameStr}`;

        for (const error of errors) {
          let file = testPath;
          let line = 1;
          let column = 1;

          const message = `${error.message}${error.diff ? `\n${error.diff}` : ''}`;
          const type = 'error';

          if (error.stack) {
            const stackFrames = await parseErrorStacktrace({
              stack: error.stack,
              fullStack: error.fullStack,
              getSourcemap,
            });
            if (stackFrames[0]) {
              file = stackFrames[0].file || test.testPath;
              line = stackFrames[0].lineNumber || 1;
              column = stackFrames[0].column || 1;
            }
          }

          logs.push(
            `::${type} file=${this.onWritePath?.(file) || file},line=${line},col=${column},title=${escapeData(title)}::${escapeData(message)}`,
          );
        }
      }

      this.log('::group::Error for GitHub Actions');

      for (const log of logs) {
        this.log(log);
      }

      this.log('::endgroup::');
    }

    if (this.enableSummary && this.stepSummaryPath) {
      await this.appendStepSummary(
        await renderStepSummary({
          results,
          testResults,
          duration,
          rootPath: this.rootPath,
          reportName: this.reportName,
          failures,
          getSourcemap,
          unhandledErrors,
        }),
      );
    }
  }
}

function escapeData(s: string): string {
  return s
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
    .replace(/:/g, '%3A')
    .replace(/,/g, '%2C');
}

const STEP_SUMMARY_MAX_FAILURES = 20;
const STEP_SUMMARY_MAX_FLAKY_TESTS = 20;
const STEP_SUMMARY_MAX_MESSAGE_LENGTH = 400;
const STEP_SUMMARY_MAX_FLAKY_MESSAGE_LENGTH = 160;
const ROOT_PATH_PLACEHOLDER = '<ROOT>';
const DEFAULT_PROJECT_NAME = 'rstest';

export function getStepSummaryDisplayPath(
  rootPath: string,
  githubWorkspace: string | undefined = process.env.GITHUB_WORKSPACE,
): string {
  const normalizedRootPath = normalize(rootPath);
  if (!githubWorkspace) {
    return normalizedRootPath;
  }

  const normalizedWorkspacePath = normalize(githubWorkspace);
  const comparableRootPath =
    normalizeForWorkspaceComparison(normalizedRootPath);
  const comparableWorkspacePath = normalizeForWorkspaceComparison(
    normalizedWorkspacePath,
  );

  if (comparableRootPath === comparableWorkspacePath) {
    return ROOT_PATH_PLACEHOLDER;
  }

  const comparableWorkspacePrefix = comparableWorkspacePath.endsWith('/')
    ? comparableWorkspacePath
    : `${comparableWorkspacePath}/`;

  if (comparableRootPath.startsWith(comparableWorkspacePrefix)) {
    const workspacePrefixLength = normalizedWorkspacePath.endsWith('/')
      ? normalizedWorkspacePath.length
      : normalizedWorkspacePath.length + 1;
    return `${ROOT_PATH_PLACEHOLDER}/${normalizedRootPath.slice(workspacePrefixLength)}`;
  }

  return normalizedRootPath;
}

function normalizeForWorkspaceComparison(value: string): string {
  return /^[A-Za-z]:\//.test(value) ? value.toLowerCase() : value;
}

function getStepSummaryProjectLabel({
  reportName,
  results,
  testResults,
  failures,
}: {
  reportName?: string;
  results: TestFileResult[];
  testResults: TestResult[];
  failures: FailureItem[];
}): string | undefined {
  if (reportName && reportName !== DEFAULT_PROJECT_NAME) {
    return reportName;
  }

  const projectNames = new Set<string>();

  const collectProjectName = (project?: string) => {
    if (!project || project === DEFAULT_PROJECT_NAME) {
      return;
    }
    projectNames.add(project);
  };

  for (const result of results) {
    collectProjectName(result.project);
  }

  for (const testResult of testResults) {
    collectProjectName(testResult.project);
  }

  for (const failure of failures) {
    collectProjectName(failure.test.project);
  }

  if (projectNames.size === 1) {
    return projectNames.values().next().value;
  }

  return undefined;
}

async function renderStepSummary({
  results,
  testResults,
  duration,
  rootPath,
  reportName,
  failures,
  getSourcemap,
  unhandledErrors,
}: {
  results: TestFileResult[];
  testResults: TestResult[];
  duration: Duration;
  rootPath: string;
  reportName?: string;
  failures: FailureItem[];
  getSourcemap: GetSourcemap;
  unhandledErrors?: Error[];
}): Promise<string> {
  const { parseErrorStacktrace } = await import('../utils/error');
  const packageManagerAgent = await detectPackageManagerAgent(rootPath);
  const displayPath = getStepSummaryDisplayPath(rootPath);
  const hasUnhandledErrors = (unhandledErrors?.length ?? 0) > 0;
  const flakyTests = collectFlakyTests(testResults);
  const isSuccess = failures.length === 0 && !hasUnhandledErrors;
  const reportIcon = isSuccess ? '✅' : '❌';
  const projectLabel = getStepSummaryProjectLabel({
    reportName,
    results,
    testResults,
    failures,
  });
  const reportTitle = projectLabel
    ? `Rstest Test Reporter (${projectLabel}) ${reportIcon}`
    : `Rstest Test Reporter ${reportIcon}`;

  const lines: string[] = [];
  lines.push(isSuccess ? '<details>' : '<details open>');
  lines.push(`<summary>${reportTitle}</summary>`);
  lines.push('');
  lines.push(`# ${reportTitle}`);
  lines.push(`> Under path: \`${displayPath || ROOT_PATH_PLACEHOLDER}\``);
  lines.push('');
  pushHeading(lines, 2, 'Summary');

  lines.push('| | Result |');
  lines.push('| :-- | :-- |');
  lines.push(
    `| **Test Files** | ${escapeMarkdownTableCell(getPlainSummaryStatusString(results))} |`,
  );
  lines.push(
    `| **Tests** | ${escapeMarkdownTableCell(getPlainSummaryStatusString(testResults))} |`,
  );
  lines.push(
    `| **Duration** | ${prettyTime(duration.totalTime)} (build ${prettyTime(duration.buildTime)}, tests ${prettyTime(duration.testTime)}) |`,
  );
  if (flakyTests.length > 0) {
    lines.push(
      `| **Flaky Tests** | ${formatFlakyTestCount(flakyTests.length)} |`,
    );
  }
  lines.push('');

  if (flakyTests.length > 0) {
    pushHeading(lines, 2, 'Flaky Tests');

    if (flakyTests.length > STEP_SUMMARY_MAX_FLAKY_TESTS) {
      lines.push(
        `Showing first ${STEP_SUMMARY_MAX_FLAKY_TESTS} of ${flakyTests.length} flaky tests.`,
      );
      lines.push('');
    }

    for (const flakyTest of flakyTests.slice(0, STEP_SUMMARY_MAX_FLAKY_TESTS)) {
      const relativePath = relative(rootPath, flakyTest.testPath);
      const fullName = formatFullTestName(flakyTest);
      const title = fullName ? `${relativePath} > ${fullName}` : relativePath;
      lines.push(
        `- \`${title}\` (passed after retry x${flakyTest.retryCount})`,
      );

      const previousFailureSummary = getPreviousFailureSummary(flakyTest);
      if (previousFailureSummary) {
        lines.push(`  Previous failure: ${previousFailureSummary}`);
      }
    }

    lines.push('');
  }

  if (!isSuccess) {
    pushHeading(lines, 2, 'Failures');

    for (let index = 0; index < (unhandledErrors?.length ?? 0); index += 1) {
      const error = unhandledErrors?.[index];
      if (!error) continue;

      pushHeading(lines, 3, `❌ FAIL Unhandled Error ${index + 1}`);
      lines.push(
        `**${error.name || 'Error'}**: ${trimForSummary(error.message)}`,
      );
      lines.push('');

      if (error.stack) {
        pushFencedBlock(lines, '', stripAnsi(trimForSummary(error.stack)));
      }
    }

    const displayedFailures = failures.slice(0, STEP_SUMMARY_MAX_FAILURES);

    if (failures.length > STEP_SUMMARY_MAX_FAILURES) {
      lines.push(
        `Showing first ${STEP_SUMMARY_MAX_FAILURES} of ${failures.length} failures.`,
      );
      lines.push('');
    }

    for (let index = 0; index < displayedFailures.length; index += 1) {
      const failure = displayedFailures[index];
      if (!failure) continue;

      const { test, errors } = failure;
      const relativePath = relative(rootPath, test.testPath);
      const fullName = formatFullTestName(test);
      const title = fullName ? `${relativePath} > ${fullName}` : relativePath;
      pushHeading(lines, 3, `❌ FAIL ${title}`);

      for (const error of errors.length
        ? errors
        : [{ message: 'Unknown error' }]) {
        const errorType = getErrorType(error);
        const message = trimForSummary(error.message);
        lines.push(`**${errorType}**: ${message}`);
        lines.push('');

        if (error.diff) {
          pushFencedBlock(lines, 'diff', stripAnsi(trimForSummary(error.diff)));
        }

        if (error.stack) {
          const stackFrames = await parseErrorStacktrace({
            stack: error.stack,
            fullStack: error.fullStack,
            getSourcemap,
          });
          if (stackFrames.length > 0) {
            const stackLines = stackFrames.map((frame) =>
              stripAnsi(formatStack(frame, rootPath)),
            );
            pushFencedBlock(lines, '', stackLines.join('\n'));
          }
        }
      }

      lines.push('<details>');
      lines.push(
        '<summary>Repro command (or via your package manager)</summary>',
      );
      lines.push('');
      pushFencedBlock(
        lines,
        'bash',
        buildPackageManagerReproCommand(
          relativePath,
          fullName,
          packageManagerAgent,
        ),
      );
      lines.push('</details>');
      lines.push('');
    }
  }

  lines.push('</details>');
  lines.push('');

  return `${lines.join('\n')}\n`;
}

function trimForSummary(input: string): string {
  if (input.length <= STEP_SUMMARY_MAX_MESSAGE_LENGTH) {
    return input;
  }

  return `${input.slice(0, STEP_SUMMARY_MAX_MESSAGE_LENGTH - 1)}…`;
}

function collectFlakyTests(testResults: TestResult[]): TestResult[] {
  return testResults.filter(
    (result) => result.status === 'pass' && (result.retryCount ?? 0) > 0,
  );
}

function getPreviousFailureSummary(testResult: TestResult): string | undefined {
  const parts = (testResult.retryErrors || testResult.errors || [])
    .map((error) => {
      const message = stripAnsi(error.message).replace(/\s+/g, ' ').trim();
      if (!message) {
        return undefined;
      }

      return `${getErrorType(error)}: ${message}`;
    })
    .filter((part, index, items): part is string => {
      return Boolean(part) && items.indexOf(part) === index;
    });

  if (parts.length === 0) {
    return undefined;
  }

  const summary = parts.join('; ');
  if (summary.length <= STEP_SUMMARY_MAX_FLAKY_MESSAGE_LENGTH) {
    return summary;
  }

  return `${summary.slice(0, STEP_SUMMARY_MAX_FLAKY_MESSAGE_LENGTH - 1)}…`;
}

function formatFlakyTestCount(count: number): string {
  return count === 1 ? '1 passed after retry' : `${count} passed after retry`;
}
