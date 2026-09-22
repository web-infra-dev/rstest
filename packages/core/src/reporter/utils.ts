import type { Agent } from 'package-manager-detector';
import { resolveCommand } from 'package-manager-detector/commands';
import { detect as detectPackageManager } from 'package-manager-detector/detect';
import { relative } from 'pathe';
import { parse as stackTraceParse } from 'stacktrace-parser';
import type {
  Duration,
  SerializedError,
  TestFileResult,
  TestResult,
  TestRunSummary,
  UserConsoleLog,
} from '../types';
import { color, logger, prettyTestPath, prettyTime } from '../utils';
import { getFileSummary } from '../utils/testSummary';

export const computeSummary = (
  results: readonly TestFileResult[],
): TestRunSummary => {
  const summary: TestRunSummary = {
    tests: {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      todo: 0,
      flaky: 0,
    },
    files: { total: results.length, failed: 0 },
  };

  for (const file of results) {
    if (file.status === 'failed') {
      summary.files.failed++;
    }
    summary.tests.total += file.summary.total;
    summary.tests.passed += file.summary.passed;
    summary.tests.failed += file.summary.failed;
    summary.tests.skipped += file.summary.skipped;
    summary.tests.todo += file.summary.todo;
    summary.tests.flaky += file.summary.flaky;
  }
  return summary;
};

type ReportCounts = {
  testFiles: number;
  failedFiles: number;
  tests: number;
  failedTests: number;
  passedTests: number;
  skippedTests: number;
  todoTests: number;
};

export const toReportCounts = (summary: TestRunSummary): ReportCounts => ({
  testFiles: summary.files.total,
  failedFiles: summary.files.failed,
  tests: summary.tests.total,
  failedTests: summary.tests.failed,
  passedTests: summary.tests.passed,
  skippedTests: summary.tests.skipped,
  todoTests: summary.tests.todo,
});

type ReportDuration = {
  total: number;
  build: number;
  tests: number;
};

export const toReportDuration = (duration: Duration): ReportDuration => ({
  total: duration.totalTime,
  build: duration.buildTime,
  tests: duration.testTime,
});

/**
 * Keys reporter-internal per-file state (buffered console logs). A test path
 * alone is ambiguous once several projects run the same file, and the emitter
 * is only recoverable from the payload's `project`. Deliberately not
 * `blobFileKey`: that one is a persisted wire format whose encoding cannot
 * change without a blob version bump, while this key is process-local and free
 * to stay cheap.
 */
export const reporterFileKey = (project: string, testPath: string): string =>
  `${project}\u0000${testPath}`;

type FileIdentity = { project: string; testPath: string };

export class PerFileEventBuffer<T> {
  private files = new Map<
    string,
    { file: FileIdentity; events: { seq: number; event: T }[] }
  >();
  private sequence = 0;

  reset(file: FileIdentity): void {
    this.files.delete(reporterFileKey(file.project, file.testPath));
  }

  push(event: T, file: FileIdentity): void {
    const key = reporterFileKey(file.project, file.testPath);
    let entry = this.files.get(key);
    if (!entry) {
      entry = { file, events: [] };
      this.files.set(key, entry);
    }
    entry.events.push({ seq: this.sequence++, event });
  }

  get(file?: FileIdentity): T[] {
    const events = file
      ? (this.files.get(reporterFileKey(file.project, file.testPath))?.events ??
        [])
      : Array.from(this.files.values())
          .flatMap(({ events }) => events)
          .sort((a, b) => a.seq - b.seq);
    return events.map(({ event }) => event);
  }

  entries(): Array<[FileIdentity, T[]]> {
    return Array.from(this.files.values(), ({ file, events }) => [
      file,
      events.map(({ event }) => event),
    ]);
  }

  prune(files: FileIdentity[]): void {
    const keys = new Set(
      files.map((file) => reporterFileKey(file.project, file.testPath)),
    );
    for (const key of this.files.keys()) {
      if (!keys.has(key)) this.files.delete(key);
    }
  }
}

export type StatusCounts = TestFileResult['summary'];
export { getFileSummary };

export const truncateString = (
  value: string,
  maxChars: number,
  suffix: string,
): string => {
  if (maxChars <= 0) return '';
  if (value.length <= maxChars) return value;
  if (maxChars <= suffix.length) return suffix.slice(0, maxChars);
  return `${value.slice(0, maxChars - suffix.length)}${suffix}`;
};

const statusStr = {
  failed: '✗',
  passed: '✓',
  todo: '-',
  skipped: '-',
};

export type FailureItem = {
  test: TestResult;
  errors: NonNullable<TestResult['errors']>;
};

export const createUnknownFailure = (): SerializedError => ({
  message: 'Unknown error',
});

const statusColor: Record<keyof typeof statusStr, (str: string) => string> = {
  failed: color.red,
  passed: color.green,
  todo: color.gray,
  skipped: color.gray,
};

const statusColorfulStr: {
  failed: string;
  passed: string;
  todo: string;
  skipped: string;
} = {
  failed: statusColor.failed(statusStr.failed),
  passed: statusColor.passed(statusStr.passed),
  todo: statusColor.todo(statusStr.todo),
  skipped: statusColor.skipped(statusStr.skipped),
};

export const logCase = (
  result: TestResult,
  options: {
    slowTestThreshold: number;
    hideSkippedTests: boolean;
  },
): void => {
  const isSlowCase = (result.duration || 0) > options.slowTestThreshold;

  if (options.hideSkippedTests && result.status === 'skipped') {
    return;
  }

  const icon =
    isSlowCase && result.status === 'passed'
      ? color.yellow(statusStr[result.status])
      : statusColorfulStr[result.status];
  const nameStr = result.fullName;
  const duration =
    typeof result.duration !== 'undefined'
      ? ` (${prettyTime(result.duration)})`
      : '';
  const retry = result.retryCount
    ? color.yellow(` (retry x${result.retryCount})`)
    : '';
  const heap = result.heap
    ? ` ${color.magenta(formatHeapUsed(result.heap))}`
    : '';

  logger.log(`  ${icon} ${nameStr}${color.gray(duration)}${retry}${heap}`);

  const errors =
    result.status === 'passed' ? result.retryErrors : result.errors;
  if (errors) {
    for (const error of errors) {
      const message =
        result.status === 'passed'
          ? `Previous failure: ${error.message}`
          : error.message;
      logger.log(color.red(`    ${message}`));
    }
  }
};

export const getErrorType = (
  error: Pick<SerializedError, 'name' | 'message'>,
): string => {
  const rawName = error.name || 'Error';

  if (rawName.includes('AssertionError')) {
    return 'AssertionError';
  }

  if (/\bSnapshot\b.*\bmismatched\b/i.test(error.message)) {
    return 'SnapshotMismatchError';
  }

  return rawName;
};

export const getRetryErrorLabel = (
  error: Pick<SerializedError, 'retryCount'>,
): string | undefined => {
  if (!error.retryCount) {
    return undefined;
  }

  return `Retry x${error.retryCount}`;
};

export const collectFailures = ({
  results,
  testResults,
}: {
  results: TestFileResult[];
  testResults: TestResult[];
}): FailureItem[] => {
  const failures: FailureItem[] = [];

  for (const result of results) {
    if (result.status === 'failed' && result.errors?.length) {
      failures.push({
        test: result,
        errors: result.errors,
      });
    }
  }

  for (const result of testResults) {
    if (result.status === 'failed') {
      failures.push({
        test: result,
        errors: result.errors || [],
      });
    }
  }

  return failures;
};

const quoteShellArg = (value: string, alwaysQuote = false): string => {
  if (value.length === 0) return "''";
  if (alwaysQuote || /[^A-Za-z0-9_\-./]/.test(value)) {
    return `'${value.replace(/'/g, "'\\''")}'`;
  }
  return value;
};

export const detectPackageManagerAgent = async (
  cwd: string,
): Promise<Agent> => {
  const result = await detectPackageManager({ cwd });
  return result?.agent ?? 'npm';
};

export const buildPackageManagerReproCommand = (
  relativePath: string,
  fullName: string,
  agent: Agent,
  includeTestName = true,
): string => {
  const args = ['rstest', relativePath];

  if (includeTestName && fullName) {
    args.push('--testNamePattern', fullName);
  }

  const resolved = resolveCommand(agent, 'execute-local', args);
  if (!resolved) {
    const formattedArgs = args
      .map((arg) => quoteShellArg(arg, arg === relativePath))
      .join(' ');
    return `npx ${formattedArgs}`;
  }

  const formattedArgs = resolved.args
    .map((arg) => quoteShellArg(arg, arg === relativePath))
    .join(' ');

  return formattedArgs.length
    ? `${resolved.command} ${formattedArgs}`
    : resolved.command;
};

export const escapeMarkdownTableCell = (value: string): string => {
  return value.replaceAll('|', '\\|');
};

const formatHeapUsed = (heap: number) => {
  return `${Math.floor(heap / 1024 / 1024)} MB heap used`;
};

export const logFileTitle = (
  test: TestFileResult,
  relativePath: string,
  alwaysShowTime = false,
  showProjectName = false,
): void => {
  let title = ` ${color.bold(statusColorfulStr[test.status])}`;

  if (showProjectName && test.project) {
    title += ` ${statusColor[test.status](`[${test.project}]`)}`;
  }

  title += ` ${prettyTestPath(relativePath)}`;

  const formatDuration = (duration: number) => {
    return color.green(prettyTime(duration));
  };

  title += ` ${color.gray(`(${test.results.length})`)}`;

  if (alwaysShowTime) {
    title += ` ${formatDuration(test.duration!)}`;
  }

  if (test.heap) {
    title += ` ${color.magenta(formatHeapUsed(test.heap))}`;
  }

  logger.log(title);
};

export const logUserConsoleLog = (
  rootPath: string,
  log: UserConsoleLog,
): void => {
  const titles = [];
  const testPath = log.relativeTestPath;
  const taskName = [
    ...(log.taskParentNames || []),
    ...(log.taskName ? [log.taskName] : []),
  ]
    .filter(Boolean)
    .join(' > ');

  if (taskName) {
    titles.push(testPath ? `${testPath} > ${taskName}` : taskName);
  }

  if (log.trace) {
    const [frame] = stackTraceParse(log.trace);
    const filePath = relative(rootPath, frame?.file || '');

    if (filePath && filePath !== testPath) {
      titles.push(testPath);
    }
    if (filePath && frame?.lineNumber != null && frame.column != null) {
      titles.push(`${filePath}:${frame.lineNumber}:${frame.column}`);
    }
  }

  if (titles.length === 0) {
    titles.push(testPath);
  }

  const logOutput = log.type === 'stdout' ? logger.log : logger.stderr;

  logOutput('');
  logOutput(
    `${log.name}${color.gray(color.dim(` | ${titles.join(color.gray(color.dim(' | ')))}`))}`,
  );
  logOutput(log.content);
  logOutput('');
};

export const ensureSingleBlankLine = (lines: string[]): void => {
  if (lines.length === 0) return;
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  lines.push('');
};

export const pushHeading = (
  lines: string[],
  level: 1 | 2 | 3,
  text: string,
): void => {
  ensureSingleBlankLine(lines);
  lines.push(`${'#'.repeat(level)} ${text}`);
  lines.push('');
};

export const pushFencedBlock = (
  lines: string[],
  lang: string,
  content: string,
): void => {
  ensureSingleBlankLine(lines);
  lines.push(`\`\`\`${lang}`);
  lines.push(content);
  lines.push('```');
  lines.push('');
};

export const stringifyJson = (value: unknown): string => {
  return JSON.stringify(value, null, 2);
};
