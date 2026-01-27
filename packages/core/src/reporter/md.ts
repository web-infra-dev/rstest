import fs from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve as nodeResolve } from 'node:path';
import {
  originalPositionFor,
  type SourceMapInput,
  TraceMap,
} from '@jridgewell/trace-mapping';
import type { Agent } from 'package-manager-detector';
import { resolveCommand } from 'package-manager-detector/commands';
import { detect as detectPackageManager } from 'package-manager-detector/detect';
import { relative, resolve } from 'pathe';
import { parse as parseStackTrace } from 'stacktrace-parser';
import stripAnsi from 'strip-ansi';
import type {
  Duration,
  GetSourcemap,
  MdReporterOptions,
  NormalizedConfig,
  Reporter,
  RstestTestState,
  SnapshotSummary,
  TestFileResult,
  TestResult,
  UserConsoleLog,
} from '../types';

type HeaderOptions = {
  env: boolean;
};

type FailuresOptions = {
  max: number;
  includeTruncatedList: boolean;
};

type CodeFrameResolved = {
  enabled: boolean;
  linesAbove: number;
  linesBelow: number;
};

type StackMode = Required<MdReporterOptions>['stack'];

type CandidateFilesResolved = {
  enabled: boolean;
  max: number;
};

type ConsoleResolved = {
  enabled: boolean;
  maxLogsPerTestPath: number;
  maxCharsPerEntry: number;
};

type ErrorsResolved = {
  unhandled: boolean;
};

type ResolvedOptions = {
  preset: NonNullable<MdReporterOptions['preset']>;
  header: HeaderOptions;
  reproduction: false | 'file' | 'file+name';
  failures: FailuresOptions;
  codeFrame: CodeFrameResolved;
  stack: StackMode;
  candidateFiles: CandidateFilesResolved;
  console: ConsoleResolved;
  errors: ErrorsResolved;
};

type StackFrame = {
  file?: string;
  methodName?: string;
  lineNumber?: number;
  column?: number;
};

type CodeFrameOptions = {
  linesAbove: number;
  linesBelow: number;
  line?: number;
  column?: number;
};

type FailureItem = {
  test: TestResult;
  errors: FormattedError[];
};

type FormattedStackFrame = {
  file?: string;
  line?: number;
  column?: number;
  method?: string;
};

type FormattedError = NonNullable<TestResult['errors']>[number];

const require = createRequire(import.meta.url);

const defaultOptions: ResolvedOptions = {
  preset: 'normal',
  header: {
    env: true,
  },
  reproduction: 'file+name',
  failures: {
    max: 50,
    includeTruncatedList: true,
  },
  codeFrame: {
    enabled: true,
    linesAbove: 2,
    linesBelow: 2,
  },
  stack: 'full',
  candidateFiles: {
    enabled: true,
    max: 5,
  },
  console: {
    enabled: true,
    maxLogsPerTestPath: 50,
    maxCharsPerEntry: 2000,
  },
  errors: {
    unhandled: true,
  },
};

const presetOptions: Record<
  NonNullable<MdReporterOptions['preset']>,
  Partial<ResolvedOptions>
> = {
  normal: {},
  compact: {
    console: {
      enabled: false,
      maxLogsPerTestPath: defaultOptions.console.maxLogsPerTestPath,
      maxCharsPerEntry: defaultOptions.console.maxCharsPerEntry,
    },
    stack: 'top',
    codeFrame: {
      enabled: false,
      linesAbove: defaultOptions.codeFrame.linesAbove,
      linesBelow: defaultOptions.codeFrame.linesBelow,
    },
    failures: {
      max: 20,
      includeTruncatedList: defaultOptions.failures.includeTruncatedList,
    },
  },
  full: {
    stack: 'full',
    console: {
      enabled: defaultOptions.console.enabled,
      maxLogsPerTestPath: 200,
      maxCharsPerEntry: 5000,
    },
    failures: {
      max: 200,
      includeTruncatedList: defaultOptions.failures.includeTruncatedList,
    },
    codeFrame: {
      enabled: defaultOptions.codeFrame.enabled,
      linesAbove: 3,
      linesBelow: 3,
    },
  },
};

const resolveHeader = (input: MdReporterOptions['header']): HeaderOptions => {
  if (input === false) {
    return { env: false };
  }
  if (input === true || input === undefined) {
    return { ...defaultOptions.header };
  }
  return {
    env: input.env ?? defaultOptions.header.env,
  };
};

const resolveReproduction = (
  input: MdReporterOptions['reproduction'],
): ResolvedOptions['reproduction'] => {
  if (input === false) return false;
  if (input === true || input === undefined) return defaultOptions.reproduction;
  return input;
};

const resolveFailures = (
  input: MdReporterOptions['failures'],
  preset: Partial<ResolvedOptions> | undefined,
): FailuresOptions => {
  const presetFailures = preset?.failures;
  return {
    max: input?.max ?? presetFailures?.max ?? defaultOptions.failures.max,
    includeTruncatedList:
      input?.includeTruncatedList ??
      presetFailures?.includeTruncatedList ??
      defaultOptions.failures.includeTruncatedList,
  };
};

const resolveCodeFrame = (
  input: MdReporterOptions['codeFrame'],
  preset: Partial<ResolvedOptions> | undefined,
): CodeFrameResolved => {
  const presetFrame = preset?.codeFrame;
  if (input === false) {
    return {
      enabled: false,
      linesAbove:
        presetFrame?.linesAbove ?? defaultOptions.codeFrame.linesAbove,
      linesBelow:
        presetFrame?.linesBelow ?? defaultOptions.codeFrame.linesBelow,
    };
  }
  if (input === true || input === undefined) {
    return {
      enabled: presetFrame?.enabled ?? defaultOptions.codeFrame.enabled,
      linesAbove:
        presetFrame?.linesAbove ?? defaultOptions.codeFrame.linesAbove,
      linesBelow:
        presetFrame?.linesBelow ?? defaultOptions.codeFrame.linesBelow,
    };
  }
  return {
    enabled: true,
    linesAbove:
      input.linesAbove ??
      presetFrame?.linesAbove ??
      defaultOptions.codeFrame.linesAbove,
    linesBelow:
      input.linesBelow ??
      presetFrame?.linesBelow ??
      defaultOptions.codeFrame.linesBelow,
  };
};

const resolveCandidateFiles = (
  input: MdReporterOptions['candidateFiles'],
): CandidateFilesResolved => {
  if (input === false) {
    return { enabled: false, max: defaultOptions.candidateFiles.max };
  }
  if (input === true || input === undefined) {
    return { ...defaultOptions.candidateFiles };
  }
  return {
    enabled: true,
    max: input.max ?? defaultOptions.candidateFiles.max,
  };
};

const resolveConsole = (
  input: MdReporterOptions['console'],
  preset: Partial<ResolvedOptions> | undefined,
): ConsoleResolved => {
  const presetConsole = preset?.console;
  if (input === false) {
    return {
      enabled: false,
      maxLogsPerTestPath:
        presetConsole?.maxLogsPerTestPath ??
        defaultOptions.console.maxLogsPerTestPath,
      maxCharsPerEntry:
        presetConsole?.maxCharsPerEntry ??
        defaultOptions.console.maxCharsPerEntry,
    };
  }
  if (input === true || input === undefined) {
    return {
      enabled: presetConsole?.enabled ?? defaultOptions.console.enabled,
      maxLogsPerTestPath:
        presetConsole?.maxLogsPerTestPath ??
        defaultOptions.console.maxLogsPerTestPath,
      maxCharsPerEntry:
        presetConsole?.maxCharsPerEntry ??
        defaultOptions.console.maxCharsPerEntry,
    };
  }
  return {
    enabled: true,
    maxLogsPerTestPath:
      input.maxLogsPerTestPath ??
      presetConsole?.maxLogsPerTestPath ??
      defaultOptions.console.maxLogsPerTestPath,
    maxCharsPerEntry:
      input.maxCharsPerEntry ??
      presetConsole?.maxCharsPerEntry ??
      defaultOptions.console.maxCharsPerEntry,
  };
};

const resolveErrors = (input: MdReporterOptions['errors']): ErrorsResolved => {
  if (input === false) return { unhandled: false };
  if (input === true || input === undefined)
    return { ...defaultOptions.errors };
  return {
    unhandled: input.unhandled ?? defaultOptions.errors.unhandled,
  };
};

const resolveStack = (
  input: MdReporterOptions['stack'],
  preset: Partial<ResolvedOptions> | undefined,
): StackMode => {
  if (input !== undefined) return input;
  return preset?.stack ?? defaultOptions.stack;
};

const resolveOptions = (
  userOptions: MdReporterOptions = {},
): ResolvedOptions => {
  const presetName = userOptions.preset ?? defaultOptions.preset;
  const preset = presetOptions[presetName];

  return {
    preset: presetName,
    header: resolveHeader(userOptions.header),
    reproduction: resolveReproduction(userOptions.reproduction),
    failures: resolveFailures(userOptions.failures, preset),
    codeFrame: resolveCodeFrame(userOptions.codeFrame, preset),
    stack: resolveStack(userOptions.stack, preset),
    candidateFiles: resolveCandidateFiles(userOptions.candidateFiles),
    console: resolveConsole(userOptions.console, preset),
    errors: resolveErrors(userOptions.errors),
  };
};

const formatFullTestName = (test: Pick<TestResult, 'name' | 'parentNames'>) => {
  const names = (test.parentNames || []).concat(test.name).filter(Boolean);
  return names.join(' > ');
};

const cleanString = (value: string): string => stripAnsi(value);

const TRUNCATION_SUFFIX = '... [truncated]';

const truncateString = (value: string, maxChars: number): string => {
  if (maxChars <= 0) return '';
  if (value.length <= maxChars) return value;
  if (maxChars <= TRUNCATION_SUFFIX.length) {
    return TRUNCATION_SUFFIX.slice(0, maxChars);
  }
  return `${value.slice(0, maxChars - TRUNCATION_SUFFIX.length)}${TRUNCATION_SUFFIX}`;
};

const getErrorType = (
  error: Pick<FormattedError, 'name' | 'message'>,
): string => {
  const rawName = error.name || 'Error';

  if (/AssertionError/.test(rawName)) {
    return 'AssertionError';
  }

  // @vitest/snapshot mismatch errors are often plain `Error` with a message like:
  // - "Snapshot `...` mismatched"
  // - "Snapshot mismatched"
  // - "Snapshot properties mismatched"
  if (/\bSnapshot\b.*\bmismatched\b/i.test(error.message)) {
    return 'SnapshotMismatchError';
  }

  return rawName;
};

const formatPath = (
  rootPath: string,
  filePath?: string,
): string | undefined => {
  if (!filePath) return undefined;
  if (filePath.includes('://') || filePath.startsWith('node:')) {
    return filePath;
  }
  const normalizedRoot = resolve(rootPath);
  const normalizedFile = resolve(filePath);
  if (normalizedFile.startsWith(normalizedRoot)) {
    return relative(rootPath, normalizedFile);
  }
  return filePath;
};

const pickSnapshotSummary = (summary?: SnapshotSummary) => {
  return {
    added: summary?.added ?? 0,
    updated: summary?.updated ?? 0,
    unmatched: summary?.unmatched ?? 0,
    removed: summary?.filesRemoved ?? 0,
    unchecked: summary?.unchecked ?? 0,
  };
};

const resolveStackFrames = (
  frames: StackFrame[],
  options: ResolvedOptions,
): StackFrame[] => {
  const mode = options.stack;
  if (mode === false || mode === 'top') return [];
  if (mode === 'full') {
    return frames.slice(0, 50);
  }
  if (typeof mode === 'number') {
    return frames.slice(0, Math.max(0, mode));
  }
  return [];
};

const resolveStackPayload = ({
  rootPath,
  topFrame,
  stackFrames,
  mode,
}: {
  rootPath: string;
  topFrame?: StackFrame;
  stackFrames: FormattedStackFrame[];
  mode: StackMode;
}): {
  topFrame?: {
    file: string | undefined;
    line: number | null;
    column: number | null;
    method: string | null;
  } | null;
  stackFrames: typeof stackFrames;
} => {
  if (mode === false) {
    return {
      stackFrames: [],
    };
  }

  if (mode === 'top') {
    return {
      topFrame: topFrame
        ? {
            file: formatPath(rootPath, topFrame.file),
            line: topFrame.lineNumber ?? null,
            column: topFrame.column ?? null,
            method: topFrame.methodName ?? null,
          }
        : null,
      stackFrames: [],
    };
  }

  return {
    stackFrames,
  };
};

const collectFailures = ({
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

const formatConsoleLog = (
  log: UserConsoleLog,
  options: Pick<ResolvedOptions, 'console'>,
): string => {
  const content = truncateString(
    cleanString(log.content),
    options.console.maxCharsPerEntry,
  );
  return `[${log.type}] ${log.name}: ${content}`;
};

const buildCandidateFiles = (
  frames: { file?: string; lineNumber?: number }[],
  rootPath: string,
  maxCandidateFiles: number,
): { path: string; line?: number }[] => {
  const scores = new Map<string, { score: number; line?: number }>();

  frames.forEach((frame, index) => {
    if (!frame.file) return;
    const formattedPath = formatPath(rootPath, frame.file) || frame.file;
    if (stackIgnores.some((entry) => formattedPath.match(entry))) {
      return;
    }
    const entry = scores.get(formattedPath) || { score: 0, line: undefined };
    const weight = Math.max(1, 10 - index);
    entry.score += weight;
    entry.line = entry.line ?? frame.lineNumber;
    scores.set(formattedPath, entry);
  });

  return Array.from(scores.entries())
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, maxCandidateFiles)
    .map(([path, meta]) => ({ path, line: meta.line }));
};

const stringifyJson = (value: unknown): string =>
  JSON.stringify(value, null, 2);

const ensureSingleBlankLine = (lines: string[]): void => {
  if (lines.length === 0) return;
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  lines.push('');
};

const pushHeading = (lines: string[], level: 1 | 2 | 3, text: string): void => {
  ensureSingleBlankLine(lines);
  lines.push(`${'#'.repeat(level)} ${text}`);
  lines.push('');
};

const pushFencedBlock = (
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

const stringifyYamlValue = (value: unknown): string => {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
};

const quoteShellValue = (value: string): string => {
  if (value.length === 0) {
    return "''";
  }
  if (/[^A-Za-z0-9_\-./]/.test(value)) {
    return `'${value.replace(/'/g, "'\\''")}'`;
  }
  return value;
};

const quoteShellPath = (value: string): string => {
  return `'${value.replace(/'/g, "'\\''")}'`;
};

const buildReproCommand = (
  relativePath: string,
  fullName: string,
  reproMode: ResolvedOptions['reproduction'],
  agent: Agent,
): string => {
  const args = ['rstest', relativePath];
  if (reproMode === 'file+name' && fullName) {
    args.push('--testNamePattern', fullName);
  }

  const resolved = resolveCommand(agent, 'execute', args);
  if (!resolved) {
    const formattedArgs = args
      .map((arg) =>
        arg === relativePath ? quoteShellPath(arg) : quoteShellValue(arg),
      )
      .join(' ');
    return `npx ${formattedArgs}`;
  }

  const formattedArgs = resolved.args
    .map((arg) =>
      arg === relativePath ? quoteShellPath(arg) : quoteShellValue(arg),
    )
    .join(' ');

  return formattedArgs.length
    ? `${resolved.command} ${formattedArgs}`
    : resolved.command;
};

const detectPackageManagerAgent = async (cwd: string): Promise<Agent> => {
  const result = await detectPackageManager({ cwd });
  return result?.agent ?? 'npm';
};

const normalizeFilePath = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  if (value.startsWith('file://')) {
    try {
      return new URL(value).pathname;
    } catch {
      return value;
    }
  }
  return value;
};

const isRelativePath = (value: string): boolean => /^\.\.\/?/.test(value);

const stackIgnores: (RegExp | string)[] = [
  /\/node_modules\//,
  /\/rstest\/packages\/core\/dist/,
  /\/@rstest\/core/,
  /\/tinypool/,
  /\/chai/,
  /\/node:\w+/,
  /webpack\/runtime/,
  /webpack\\runtime/,
  '<anonymous>',
];

const trimLeadingNodeFrames = (frames: StackFrame[]): StackFrame[] => {
  let startIndex = 0;
  while (startIndex < frames.length) {
    const file = frames[startIndex]?.file;
    if (file?.startsWith('node:')) {
      startIndex += 1;
      continue;
    }
    break;
  }
  return frames.slice(startIndex);
};

const dropNodeFrames = (frames: StackFrame[]): StackFrame[] =>
  frames.filter((frame) => !frame.file?.startsWith('node:'));

const resolveModuleRoot = (spec: string): string | null => {
  try {
    if (typeof import.meta.resolve === 'function') {
      const resolved = import.meta.resolve(`${spec}/package.json`);
      const filePath = resolved.startsWith('file://')
        ? new URL(resolved).pathname
        : resolved;
      return dirname(filePath);
    }
  } catch {
    // fallback below
  }

  try {
    return dirname(require.resolve(`${spec}/package.json`));
  } catch {
    return null;
  }
};

const excludedRoots: string[] = (() => {
  const resolvedRoots: string[] = [];
  const candidates = ['@rstest/core'];
  for (const spec of candidates) {
    const root = resolveModuleRoot(spec);
    if (root) {
      resolvedRoots.push(root);
    }
  }
  return resolvedRoots;
})();

const parseErrorStacktrace = async ({
  stack,
  getSourcemap,
  fullStack = false,
}: {
  stack: string;
  getSourcemap?: GetSourcemap;
  fullStack?: boolean;
}): Promise<StackFrame[]> => {
  const frames = parseStackTrace(stack)
    .filter((frame) => {
      if (fullStack) return true;
      if (!frame.file) return false;
      const filePath = normalizeFilePath(frame.file) || '';
      if (excludedRoots.some((root) => filePath.startsWith(root))) {
        return false;
      }
      return !stackIgnores.some((entry) => filePath.match(entry));
    })
    .map(async (frame) => {
      const file = normalizeFilePath(frame.file);
      if (!file || !getSourcemap) {
        return {
          ...frame,
          file,
        };
      }

      const sourcemap = (await getSourcemap(
        file,
      )) as unknown as SourceMapInput | null;
      if (!sourcemap) {
        return {
          ...frame,
          file,
        };
      }

      const traceMap = new TraceMap(sourcemap);
      const { line, column, source, name } = originalPositionFor(traceMap, {
        line: frame.lineNumber || 1,
        column: frame.column || 1,
      });

      if (!source) {
        return null;
      }

      const mappedFile = isRelativePath(source)
        ? nodeResolve(file || '', '../', source)
        : (() => {
            try {
              return new URL(source).pathname;
            } catch {
              return source;
            }
          })();

      return {
        ...frame,
        file: mappedFile,
        lineNumber: line || frame.lineNumber,
        column: column || frame.column,
        methodName: name || frame.methodName,
      };
    });

  const resolvedFrames = await Promise.all(frames);
  const filteredFrames = resolvedFrames.filter(
    (frame) => frame !== null,
  ) as StackFrame[];
  return dropNodeFrames(trimLeadingNodeFrames(filteredFrames));
};

const createCodeFrame = (
  filePath: string,
  { linesAbove, linesBelow, line, column }: CodeFrameOptions,
): string | null => {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  const source = fs.readFileSync(filePath, 'utf-8');
  const sourceLines = source.split(/\r?\n/);
  const lineNumber = Math.max(1, line || 1);
  const columnNumber = Math.max(1, column || 1);
  const start = Math.max(1, lineNumber - linesAbove);
  const end = Math.min(sourceLines.length, lineNumber + linesBelow);
  const lineWidth = String(end).length;
  const frameLines: string[] = [];

  for (let i = start; i <= end; i += 1) {
    const linePrefix = String(i).padStart(lineWidth, ' ');
    const lineContent = sourceLines[i - 1] ?? '';
    frameLines.push(`${linePrefix} | ${lineContent}`);
    if (i === lineNumber) {
      const marker = ' '.repeat(Math.max(0, columnNumber - 1));
      frameLines.push(`${' '.repeat(lineWidth)} | ${marker}^`);
    }
  }

  return frameLines.join('\n');
};

export class MdReporter implements Reporter {
  protected rootPath: string;
  protected config: NormalizedConfig;
  private options: ResolvedOptions;
  private logsByTestPath = new Map<string, string[]>();

  constructor({
    rootPath,
    config,
    options,
    testState,
  }: {
    rootPath: string;
    config: NormalizedConfig;
    options: MdReporterOptions;
    testState: RstestTestState;
  }) {
    this.rootPath = rootPath;
    this.config = config;
    void testState;
    this.options = resolveOptions(options);
  }

  onUserConsoleLog(log: UserConsoleLog): void {
    if (!this.options.console.enabled) return;

    const logs = this.logsByTestPath.get(log.testPath) || [];
    logs.push(formatConsoleLog(log, this.options));
    this.logsByTestPath.set(log.testPath, logs);
  }

  async onTestRunEnd({
    results,
    testResults,
    duration,
    getSourcemap,
    snapshotSummary,
    unhandledErrors,
    filterRerunTestPaths,
  }: {
    results: TestFileResult[];
    testResults: TestResult[];
    duration: Duration;
    getSourcemap: GetSourcemap;
    snapshotSummary: SnapshotSummary;
    unhandledErrors?: Error[];
    filterRerunTestPaths?: string[];
  }): Promise<void> {
    const rootPath = this.rootPath || process.cwd();
    const failures = collectFailures({
      results,
      testResults,
      filterRerunTestPaths,
    });

    const packageManagerAgent = this.options.reproduction
      ? await detectPackageManagerAgent(rootPath)
      : 'npm';

    const failedTests = testResults.filter(
      (result) => result.status === 'fail',
    );
    const failedFiles = results.filter((result) => result.status === 'fail');
    const status =
      failedTests.length || failedFiles.length || unhandledErrors?.length
        ? 'fail'
        : 'pass';

    const summaryPayload: Record<string, unknown> = {
      status,
      counts: {
        testFiles: results.length,
        failedFiles: failedFiles.length,
        tests: testResults.length,
        failedTests: failedTests.length,
      },
      durationMs: {
        total: duration.totalTime,
        build: duration.buildTime,
        tests: duration.testTime,
      },
    };

    summaryPayload.snapshot = pickSnapshotSummary(snapshotSummary);

    const frontMatter: Record<string, unknown> = {
      tool: `@rstest/core@${RSTEST_VERSION}`,
      timestamp: new Date().toISOString(),
    };

    if (this.options.header.env) {
      frontMatter.runtime = {
        node: process.version,
        platform: process.platform,
        cwd: process.cwd(),
      };
    }

    const lines: string[] = [];
    lines.push('---');
    for (const [key, value] of Object.entries(frontMatter)) {
      lines.push(`${key}: ${stringifyYamlValue(value)}`);
    }
    lines.push('---');
    lines.push('');
    pushHeading(lines, 1, 'Rstest Test Execution Report');
    pushHeading(lines, 2, 'Summary');
    pushFencedBlock(lines, 'json', stringifyJson(summaryPayload));
    pushHeading(lines, 2, 'Failures');

    if (!failures.length) {
      lines.push('No test failures reported.');
    } else {
      const failureTitles = failures.map((failure, index) => {
        const relativePath = relative(rootPath, failure.test.testPath);
        const fullName = formatFullTestName(failure.test);
        const title = fullName
          ? `${relativePath} :: ${fullName}`
          : relativePath;
        return `[F${String(index + 1).padStart(2, '0')}] ${title}`;
      });

      const maxFailures = Math.max(0, this.options.failures.max);
      const shouldTruncate = failureTitles.length > maxFailures;
      const displayedFailures = shouldTruncate
        ? failures.slice(0, maxFailures)
        : failures;

      if (shouldTruncate && this.options.failures.includeTruncatedList) {
        pushHeading(lines, 3, 'Failure List (truncated)');
        for (const title of failureTitles) {
          lines.push(`- ${title}`);
        }
        pushHeading(lines, 3, `Failure Details (first ${maxFailures})`);
      }

      for (let index = 0; index < displayedFailures.length; index += 1) {
        const failure = displayedFailures[index];
        if (!failure) continue;

        const relativePath = relative(rootPath, failure.test.testPath);
        const fullName = formatFullTestName(failure.test);
        const title = fullName
          ? `${relativePath} :: ${fullName}`
          : relativePath;
        const failureId = shouldTruncate
          ? index + 1
          : failures.indexOf(failure) + 1;
        const formattedId = String(failureId).padStart(2, '0');
        pushHeading(lines, 3, `[F${formattedId}] ${title}`);

        if (this.options.reproduction) {
          lines.push('repro:');
          pushFencedBlock(
            lines,
            'bash',
            buildReproCommand(
              relativePath,
              fullName,
              this.options.reproduction,
              packageManagerAgent,
            ),
          );
        }

        const errorEntries = await Promise.all(
          (failure.errors.length
            ? failure.errors
            : [{ message: 'Unknown error' }]
          ).map(async (error) => {
            const candidateFrames = error.stack
              ? await parseErrorStacktrace({
                  stack: error.stack,
                  getSourcemap,
                  fullStack: false,
                })
              : [];

            const fullFrames = error.stack
              ? await parseErrorStacktrace({
                  stack: error.stack,
                  getSourcemap,
                  fullStack: error.fullStack,
                })
              : candidateFrames;

            const trimmedFrames = resolveStackFrames(fullFrames, this.options);
            const topFrame = fullFrames[0] ?? candidateFrames[0];
            return {
              error,
              topFrame,
              candidateFrames,
              stackFrames: trimmedFrames,
            };
          }),
        );

        const candidateFiles = this.options.candidateFiles.enabled
          ? buildCandidateFiles(
              errorEntries.flatMap((entry) => entry.candidateFrames),
              rootPath,
              this.options.candidateFiles.max,
            )
          : [];

        const failurePayload = {
          testPath: relativePath,
          project: failure.test.project,
          fullName,
          status: failure.test.status,
          duration: failure.test.duration,
          retryCount: failure.test.retryCount ?? 0,
          errors: errorEntries.map(({ error, topFrame, stackFrames }) => {
            const mappedStackFrames = stackFrames.map((frame) => ({
              file: formatPath(rootPath, frame.file),
              line: frame.lineNumber,
              column: frame.column,
              method: frame.methodName,
            }));

            return {
              type: getErrorType(error),
              message: cleanString(error.message),
              diff:
                error.expected !== undefined && error.actual !== undefined
                  ? undefined
                  : error.diff
                    ? cleanString(error.diff)
                    : undefined,
              expected: error.expected,
              actual: error.actual,
              ...resolveStackPayload({
                rootPath,
                topFrame,
                stackFrames: mappedStackFrames,
                mode: this.options.stack,
              }),
            };
          }),
          candidateFiles: candidateFiles.length ? candidateFiles : undefined,
        };

        lines.push('details:');
        pushFencedBlock(lines, 'json', stringifyJson(failurePayload));

        if (this.options.codeFrame.enabled) {
          for (
            let errorIndex = 0;
            errorIndex < errorEntries.length;
            errorIndex += 1
          ) {
            const entry = errorEntries[errorIndex];
            if (!entry?.topFrame?.file || !entry.topFrame.lineNumber) {
              continue;
            }
            const codeFrame = createCodeFrame(entry.topFrame.file, {
              linesAbove: this.options.codeFrame.linesAbove,
              linesBelow: this.options.codeFrame.linesBelow,
              line: entry.topFrame.lineNumber,
              column: entry.topFrame.column || 1,
            });
            if (codeFrame) {
              lines.push(`codeFrame (error ${errorIndex + 1}):`);
              pushFencedBlock(lines, 'text', codeFrame);
            }
          }
        }

        if (this.options.console.enabled) {
          const consoleLogs =
            this.logsByTestPath.get(failure.test.testPath) || [];
          const limitedLogs = consoleLogs.slice(
            Math.max(
              0,
              consoleLogs.length - this.options.console.maxLogsPerTestPath,
            ),
          );

          if (limitedLogs.length) {
            lines.push('console:');
            pushFencedBlock(lines, 'text', limitedLogs.join('\n'));
          }
        }
      }
    }

    if (this.options.errors.unhandled && unhandledErrors?.length) {
      pushHeading(lines, 2, 'Unhandled Errors');
      for (let index = 0; index < unhandledErrors.length; index += 1) {
        const error = unhandledErrors[index];
        if (!error) continue;

        pushHeading(lines, 3, `Unhandled Error ${index + 1}`);
        pushFencedBlock(
          lines,
          'json',
          stringifyJson({
            name: error.name || 'Error',
            message: cleanString(error.message),
            stack: error.stack ? cleanString(error.stack) : undefined,
          }),
        );
      }
    }

    const output = lines.join('\n');
    process.stdout.write(`${output}\n`);
  }
}
