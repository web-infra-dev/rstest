/**
 * Markdown reporter contract (behavior spec)
 *
 * This reporter is designed to be both human-readable and agent/LLM-friendly.
 * The output is intentionally structured and stable; behavior changes should be
 * reflected in the e2e snapshots under `e2e/reporter/md.test.ts`.
 *
 * Output sections (top to bottom)
 *
 * - Front Matter (YAML)
 *   - Always printed.
 *   - Fields: `tool`, `timestamp`, `runtime` (conditional).
 *   - `runtime` is printed only when `options.header.env === true`.
 *
 * - Title
 *   - Always printed.
 *   - `# Rstest Test Execution Report`
 *
 * - Summary
 *   - Always printed.
 *   - `## Summary` followed by a fenced `json` block.
 *   - Contains: status, counts (testFiles, failedFiles, tests, failedTests,
 *     passedTests, skippedTests, todoTests), durationMs, snapshot.
 *
 * - Tests
 *   - Printed only when `status === 'pass' && focusedRun === true`.
 *   - Contains `### Passed` and `### Skipped` lists; `### Todo` is printed only
 *     when `todoTests.length > 0`.
 *   - Lists are truncated to `DEFAULT_TEST_LIST_MAX_ITEMS` and may include a
 *     truncation note.
 *
 * - Failures
 *   - Always printed (`## Failures` heading).
 *   - When there are no failures (`failures.length === 0`):
 *     - Prints `No test failures reported.`
 *     - Additionally prints `Note: all tests passed. Lists omitted for brevity.`
 *       only when `status === 'pass' && focusedRun === false`.
 *   - When failures exist:
 *     - If truncated (`failures.length > options.failures.max`):
 *       - Prints truncation note with counts.
 *       - Prints `### Failure List` with all failures in minimal format:
 *         `- [FXX] <title>` followed by nested `type`, `message`, `expected`,
 *         `actual`, `repro` fields.
 *       - Prints `### Failure Details (first N)` heading before detailed blocks.
 *     - For each displayed failure (up to `options.failures.max`):
 *       - `### [FXX] <testPath> :: <fullName>` heading.
 *       - `repro:` bash block (when `options.reproduction !== false`).
 *       - `details:` JSON block containing testPath, project, fullName, status,
 *         duration, retryCount, errors array (each with type, message,
 *         expected/actual when no diff, topFrame or stackFrames based on
 *         `options.stack`), and candidateFiles (when enabled and available).
 *       - `diff:` diff block per error (only when error has diff; expected/actual
 *         omitted from JSON in this case).
 *       - `codeFrame (error N):` text block per error (when
 *         `options.codeFrame.enabled === true` and topFrame has file/line).
 *       - `console:` text block (when `options.console.enabled === true` and
 *         logs exist for this test path).
 *
 * - Unhandled Errors
 *   - Printed only when `options.errors.unhandled === true` and
 *     `unhandledErrors?.length > 0`.
 *   - `## Unhandled Errors` heading followed by `### Unhandled Error N` for each,
 *     with a JSON block containing name, message, stack.
 *
 * Focused run detection
 *
 * `focusedRun` is used only to decide whether to print the `## Tests` section on
 * passing runs.
 *
 * A run is considered focused when any of the following is true:
 * - The user provided CLI file filters (`fileFilters.length > 0`).
 * - The user provided a name filter (`config.testNamePattern`).
 * - Heuristic: small result set (`testResults.length > 0 && testResults.length <= FOCUSED_RUN_MAX_TESTS`).
 */
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

const DEFAULT_TEST_LIST_MAX_ITEMS = 50;
const FOCUSED_RUN_MAX_TESTS = 10;

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
  },
  codeFrame: {
    enabled: true,
    linesAbove: 2,
    linesBelow: 2,
  },
  stack: 'top',
  candidateFiles: {
    enabled: true,
    max: 5,
  },
  console: {
    enabled: true,
    maxLogsPerTestPath: 10,
    maxCharsPerEntry: 500,
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
    },
    codeFrame: {
      enabled: defaultOptions.codeFrame.enabled,
      linesAbove: 3,
      linesBelow: 3,
    },
  },
};

/**
 * Resolves a boolean-or-object option with preset support.
 * - `false` → disabled config
 * - `true` / `undefined` → defaults merged with preset
 * - object → user values merged over preset and defaults
 */
const resolveToggleOption = <T extends Record<string, unknown>>(
  input: boolean | Partial<T> | undefined,
  defaults: T,
  disabled: T,
  preset?: Partial<T>,
): T => {
  if (input === false) return { ...disabled };
  const base = preset ? { ...defaults, ...preset } : defaults;
  if (input === true || input === undefined) return { ...base };
  return { ...base, ...input };
};

const resolveHeader = (input: MdReporterOptions['header']): HeaderOptions =>
  resolveToggleOption(input, defaultOptions.header, { env: false });

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
): FailuresOptions => ({
  max: input?.max ?? preset?.failures?.max ?? defaultOptions.failures.max,
});

const resolveCodeFrame = (
  input: MdReporterOptions['codeFrame'],
  preset: Partial<ResolvedOptions> | undefined,
): CodeFrameResolved =>
  resolveToggleOption(
    input,
    defaultOptions.codeFrame,
    { ...defaultOptions.codeFrame, enabled: false },
    preset?.codeFrame,
  );

const resolveCandidateFiles = (
  input: MdReporterOptions['candidateFiles'],
): CandidateFilesResolved =>
  resolveToggleOption(input, defaultOptions.candidateFiles, {
    ...defaultOptions.candidateFiles,
    enabled: false,
  });

const resolveConsole = (
  input: MdReporterOptions['console'],
  preset: Partial<ResolvedOptions> | undefined,
): ConsoleResolved =>
  resolveToggleOption(
    input,
    defaultOptions.console,
    { ...defaultOptions.console, enabled: false },
    preset?.console,
  );

const resolveErrors = (input: MdReporterOptions['errors']): ErrorsResolved =>
  resolveToggleOption(input, defaultOptions.errors, { unhandled: false });

const resolveStack = (
  input: MdReporterOptions['stack'],
  preset: Partial<ResolvedOptions> | undefined,
): StackMode => input ?? preset?.stack ?? defaultOptions.stack;

/** @internal Exported for testing only. */
export const resolveOptions = (
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

const formatFailureTitle = (
  failure: FailureItem,
  index: number,
  rootPath: string,
): {
  relativePath: string;
  fullName: string;
  title: string;
  formattedId: string;
} => {
  const relativePath = relative(rootPath, failure.test.testPath);
  const fullName = formatFullTestName(failure.test);
  return {
    relativePath,
    fullName,
    title: fullName ? `${relativePath} :: ${fullName}` : relativePath,
    formattedId: String(index + 1).padStart(2, '0'),
  };
};

const cleanString = (value: string): string => stripAnsi(value);

const TRUNCATION_SUFFIX = '... [truncated]';

const FAILURE_LIST_VALUE_MAX_CHARS = 200;

const truncateString = (value: string, maxChars: number): string => {
  if (maxChars <= 0) return '';
  if (value.length <= maxChars) return value;
  if (maxChars <= TRUNCATION_SUFFIX.length) {
    return TRUNCATION_SUFFIX.slice(0, maxChars);
  }
  return `${value.slice(0, maxChars - TRUNCATION_SUFFIX.length)}${TRUNCATION_SUFFIX}`;
};

const toSingleLine = (value: string): string => {
  return value.replace(/\r?\n/g, '\\n').replace(/\s+/g, ' ').trim();
};

const formatFailureListValue = (value: unknown): string => {
  if (value === undefined) return '';
  if (value === null) return 'null';

  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return truncateString(
    toSingleLine(cleanString(raw)),
    FAILURE_LIST_VALUE_MAX_CHARS,
  );
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

/**
 * Quotes a shell argument. When `alwaysQuote` is true, the value is always
 * wrapped in single quotes (useful for file paths that may contain spaces).
 */
const quoteShellArg = (value: string, alwaysQuote = false): string => {
  if (value.length === 0) return "''";
  if (alwaysQuote || /[^A-Za-z0-9_\-./]/.test(value)) {
    return `'${value.replace(/'/g, "'\\''")}'`;
  }
  return value;
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
  private readonly fileFilters: string[];
  private readonly options: ResolvedOptions;
  private readonly logsByTestPath = new Map<string, string[]>();

  constructor({
    rootPath,
    config,
    options,
    testState,
    fileFilters,
  }: {
    rootPath: string;
    config: NormalizedConfig;
    options: MdReporterOptions;
    testState: RstestTestState;
    fileFilters?: string[];
  }) {
    this.rootPath = rootPath;
    this.config = config;
    void testState;
    this.fileFilters = fileFilters ?? [];
    this.options = resolveOptions(options);
  }

  private isFocusedRun({
    testResults,
  }: {
    testResults: TestResult[];
  }): boolean {
    if (this.fileFilters.length > 0) return true;
    if (this.config.testNamePattern) return true;
    if (testResults.length > 0 && testResults.length <= FOCUSED_RUN_MAX_TESTS) {
      return true;
    }
    return false;
  }

  private pushTestList({
    lines,
    heading,
    tests,
    maxItems,
  }: {
    lines: string[];
    heading: string;
    tests: TestResult[];
    maxItems: number;
  }): void {
    pushHeading(lines, 3, heading);

    if (!tests.length) {
      lines.push('None.');
      return;
    }

    const limit = Math.max(0, maxItems);
    const truncated = limit > 0 && tests.length > limit;
    const displayed = truncated ? tests.slice(0, limit) : tests;

    for (const test of displayed) {
      const relativePath = relative(this.rootPath, test.testPath);
      const fullName = formatFullTestName(test);
      const title = fullName ? `${relativePath} :: ${fullName}` : relativePath;
      lines.push(`- ${title}`);
    }

    if (truncated) {
      ensureSingleBlankLine(lines);
      lines.push(`Note: list truncated (showing ${limit} of ${tests.length}).`);
    }
  }

  onUserConsoleLog(log: UserConsoleLog): void {
    if (!this.options.console.enabled) return;

    const logs = this.logsByTestPath.get(log.testPath) || [];
    logs.push(formatConsoleLog(log, this.options));
    this.logsByTestPath.set(log.testPath, logs);
  }

  private renderFrontMatter(lines: string[]): void {
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

    lines.push('---');
    for (const [key, value] of Object.entries(frontMatter)) {
      lines.push(`${key}: ${stringifyYamlValue(value)}`);
    }
    lines.push('---');
    lines.push('');
  }

  private renderTestsSection(
    lines: string[],
    tests: { passed: TestResult[]; skipped: TestResult[]; todo: TestResult[] },
  ): void {
    pushHeading(lines, 2, 'Tests');
    this.pushTestList({
      lines,
      heading: 'Passed',
      tests: tests.passed,
      maxItems: DEFAULT_TEST_LIST_MAX_ITEMS,
    });
    this.pushTestList({
      lines,
      heading: 'Skipped',
      tests: tests.skipped,
      maxItems: DEFAULT_TEST_LIST_MAX_ITEMS,
    });
    if (tests.todo.length) {
      this.pushTestList({
        lines,
        heading: 'Todo',
        tests: tests.todo,
        maxItems: DEFAULT_TEST_LIST_MAX_ITEMS,
      });
    }
  }

  private renderUnhandledErrors(lines: string[], errors?: Error[]): void {
    if (!this.options.errors.unhandled || !errors?.length) return;

    pushHeading(lines, 2, 'Unhandled Errors');
    for (let index = 0; index < errors.length; index += 1) {
      const error = errors[index];
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
    const passedTests = testResults.filter(
      (result) => result.status === 'pass',
    );
    const skippedTests = testResults.filter(
      (result) => result.status === 'skip',
    );
    const todoTests = testResults.filter((result) => result.status === 'todo');
    const failedFiles = results.filter((result) => result.status === 'fail');
    const status =
      failedTests.length || failedFiles.length || unhandledErrors?.length
        ? 'fail'
        : 'pass';

    const focusedRun = this.isFocusedRun({ testResults });

    const summaryPayload: Record<string, unknown> = {
      status,
      counts: {
        testFiles: results.length,
        failedFiles: failedFiles.length,
        tests: testResults.length,
        failedTests: failedTests.length,
        passedTests: passedTests.length,
        skippedTests: skippedTests.length,
        todoTests: todoTests.length,
      },
      durationMs: {
        total: duration.totalTime,
        build: duration.buildTime,
        tests: duration.testTime,
      },
    };

    summaryPayload.snapshot = pickSnapshotSummary(snapshotSummary);

    const lines: string[] = [];
    this.renderFrontMatter(lines);
    pushHeading(lines, 1, 'Rstest Test Execution Report');
    pushHeading(lines, 2, 'Summary');
    pushFencedBlock(lines, 'json', stringifyJson(summaryPayload));

    if (status === 'pass' && focusedRun) {
      this.renderTestsSection(lines, {
        passed: passedTests,
        skipped: skippedTests,
        todo: todoTests,
      });
    }

    pushHeading(lines, 2, 'Failures');

    if (!failures.length) {
      lines.push('No test failures reported.');
      if (status === 'pass' && !focusedRun) {
        ensureSingleBlankLine(lines);
        lines.push('Note: all tests passed. Lists omitted for brevity.');
      }
    } else {
      const maxFailures = Math.max(0, this.options.failures.max);
      const shouldTruncate = failures.length > maxFailures;
      const displayedFailures = shouldTruncate
        ? failures.slice(0, maxFailures)
        : failures;

      if (shouldTruncate) {
        ensureSingleBlankLine(lines);
        lines.push(
          `Truncated failures: showing full details for first ${maxFailures} of ${failures.length} failures.`,
        );
        lines.push(
          `For failures beyond ${maxFailures}, only minimal fields are shown in the failure list. Use the repro command to rerun a specific failure for full details.`,
        );
        lines.push('');

        pushHeading(lines, 3, 'Failure List');
        for (let index = 0; index < failures.length; index += 1) {
          const failure = failures[index];
          if (!failure) continue;

          const { relativePath, fullName, title, formattedId } =
            formatFailureTitle(failure, index, rootPath);

          lines.push(`- [F${formattedId}] ${title}`);

          const primaryError = failure.errors[0] || {
            message: 'Unknown error',
          };

          const type = getErrorType({
            name: primaryError.name,
            message: primaryError.message || '',
          });

          lines.push(`  - type: ${type}`);
          if (primaryError.message) {
            lines.push(
              `  - message: ${formatFailureListValue(primaryError.message)}`,
            );
          }
          if (primaryError.expected !== undefined) {
            lines.push(
              `  - expected: ${formatFailureListValue(primaryError.expected)}`,
            );
          }
          if (primaryError.actual !== undefined) {
            lines.push(
              `  - actual: ${formatFailureListValue(primaryError.actual)}`,
            );
          }

          if (this.options.reproduction) {
            lines.push(
              `  - repro: ${buildReproCommand(
                relativePath,
                fullName,
                this.options.reproduction,
                packageManagerAgent,
              )}`,
            );
          }
        }

        pushHeading(lines, 3, `Failure Details (first ${maxFailures})`);
      }

      for (let index = 0; index < displayedFailures.length; index += 1) {
        const failure = displayedFailures[index];
        if (!failure) continue;

        const { relativePath, fullName, title, formattedId } =
          formatFailureTitle(failure, index, rootPath);
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

            // Prefer diff over full expected/actual to reduce output size
            // (especially for large snapshot mismatches).
            // Diff is output separately as a fenced block to avoid JSON escaping.
            const hasDiff = Boolean(error.diff);

            return {
              type: getErrorType(error),
              message: cleanString(error.message),
              expected: hasDiff ? undefined : error.expected,
              actual: hasDiff ? undefined : error.actual,
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

        // Output diff in separate fenced block (avoids JSON escaping)
        for (
          let errorIndex = 0;
          errorIndex < errorEntries.length;
          errorIndex += 1
        ) {
          const entry = errorEntries[errorIndex];
          if (entry?.error.diff) {
            const label =
              errorEntries.length > 1
                ? `diff (error ${errorIndex + 1}):`
                : 'diff:';
            lines.push(label);
            pushFencedBlock(lines, 'diff', cleanString(entry.error.diff));
          }
        }

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

    this.renderUnhandledErrors(lines, unhandledErrors);

    const output = lines.join('\n');
    process.stdout.write(`${output}\n`);
  }
}
