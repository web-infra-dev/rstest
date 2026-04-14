import type { Agent } from 'package-manager-detector';
import { resolveCommand } from 'package-manager-detector/commands';
import { detect as detectPackageManager } from 'package-manager-detector/detect';
import { relative } from 'pathe';
import { parse as stackTraceParse } from 'stacktrace-parser';
import type {
  FormattedError,
  TestFileResult,
  TestResult,
  UserConsoleLog,
} from '../types';
import {
  color,
  getTaskNameWithPrefix,
  logger,
  prettyTestPath,
  prettyTime,
} from '../utils';

const statusStr = {
  fail: '✗',
  pass: '✓',
  todo: '-',
  skip: '-',
};

export type FailureItem = {
  test: TestResult;
  errors: NonNullable<TestResult['errors']>;
};

const statusColor: Record<keyof typeof statusStr, (str: string) => string> = {
  fail: color.red,
  pass: color.green,
  todo: color.gray,
  skip: color.gray,
};

const statusColorfulStr: {
  fail: string;
  pass: string;
  todo: string;
  skip: string;
} = {
  fail: statusColor.fail(statusStr.fail),
  pass: statusColor.pass(statusStr.pass),
  todo: statusColor.todo(statusStr.todo),
  skip: statusColor.skip(statusStr.skip),
};

export const logCase = (
  result: TestResult,
  options: {
    slowTestThreshold: number;
    hideSkippedTests: boolean;
  },
): void => {
  const isSlowCase = (result.duration || 0) > options.slowTestThreshold;

  if (options.hideSkippedTests && result.status === 'skip') {
    return;
  }

  const icon =
    isSlowCase && result.status === 'pass'
      ? color.yellow(statusStr[result.status])
      : statusColorfulStr[result.status];
  const nameStr = getTaskNameWithPrefix(result);
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

  if (result.errors) {
    for (const error of result.errors) {
      logger.log(color.red(`    ${error.message}`));
    }
  }
};

export const formatFullTestName = (
  test: Pick<TestResult, 'name' | 'parentNames'>,
): string => {
  const names = (test.parentNames || []).concat(test.name).filter(Boolean);
  return names.join(' > ');
};

export const getErrorType = (
  error: Pick<FormattedError, 'name' | 'message'>,
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

export const collectFailures = ({
  results,
  testResults,
  filterRerunTestPaths,
}: {
  results: TestFileResult[];
  testResults: TestResult[];
  filterRerunTestPaths?: string[];
}): FailureItem[] => {
  const shouldIncludePath = (testPath: string) =>
    filterRerunTestPaths ? filterRerunTestPaths.includes(testPath) : true;

  const failures: FailureItem[] = [];

  for (const result of results) {
    if (
      result.status === 'fail' &&
      result.errors?.length &&
      shouldIncludePath(result.testPath)
    ) {
      failures.push({
        test: result,
        errors: result.errors,
      });
    }
  }

  for (const result of testResults) {
    if (result.status === 'fail' && shouldIncludePath(result.testPath)) {
      failures.push({
        test: result,
        errors: result.errors || [],
      });
    }
  }

  return failures;
};

export const quoteShellArg = (value: string, alwaysQuote = false): string => {
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
  const testPath = relative(rootPath, log.testPath);

  if (log.trace) {
    const [frame] = stackTraceParse(log.trace);
    const filePath = relative(rootPath, frame!.file || '');

    if (filePath !== testPath) {
      titles.push(testPath);
    }
    titles.push(`${filePath}:${frame!.lineNumber}:${frame!.column}`);
  } else {
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
