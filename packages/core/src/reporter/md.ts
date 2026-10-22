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
 *   - Printed when `options.testLists === 'always'`, or when
 *     `status === 'passed' && focusedRun === true`.
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
 *       only when `status === 'passed' && focusedRun === false` and
 *       `options.testLists !== 'always'`.
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
import { relative, resolve } from 'pathe';
import stripAnsi from 'strip-ansi';
import type {
  MdReporterOptions,
  NormalizedConfig,
  Reporter,
  RstestTestState,
  SerializedError,
  SnapshotSummary,
  TestFileInfo,
  TestResult,
  TestRunEndPayload,
  UserConsoleLog,
} from '../types';
import { parseErrorStacktrace, stackIgnores } from '../utils/error';
import {
  buildPackageManagerReproCommand,
  collectFailures,
  createUnknownFailure,
  detectPackageManagerAgent,
  ensureSingleBlankLine,
  type FailureItem,
  getErrorType,
  PerFileEventBuffer,
  pushFencedBlock,
  pushHeading,
  stringifyJson,
  toReportCounts,
  toReportDuration,
  truncateString,
} from './utils';

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

type TestListsMode = NonNullable<MdReporterOptions['testLists']>;

type ResolvedOptions = {
  preset: NonNullable<MdReporterOptions['preset']>;
  header: HeaderOptions;
  reproduction: false | 'file' | 'file+name';
  testLists: TestListsMode;
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
  file?: string | null;
  methodName?: string | null;
  lineNumber?: number | null;
  column?: number | null;
};

type FormattedStackFrame = {
  file?: string;
  line?: number;
  column?: number;
  method?: string;
};

const defaultOptions: ResolvedOptions = {
  preset: 'normal',
  header: {
    env: true,
  },
  reproduction: 'file+name',
  testLists: 'auto',
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

/** @internal Exported for testing only. */
export const resolveOptions = (
  userOptions: MdReporterOptions = {},
): ResolvedOptions => {
  const presetName = userOptions.preset ?? defaultOptions.preset;
  const preset = presetOptions[presetName];

  return {
    preset: presetName,
    header: resolveToggleOption(userOptions.header, defaultOptions.header, {
      env: false,
    }),
    reproduction:
      userOptions.reproduction === true ||
      userOptions.reproduction === undefined
        ? defaultOptions.reproduction
        : userOptions.reproduction,
    testLists: userOptions.testLists ?? defaultOptions.testLists,
    failures: {
      max:
        userOptions.failures?.max ??
        preset.failures?.max ??
        defaultOptions.failures.max,
    },
    codeFrame: resolveToggleOption(
      userOptions.codeFrame,
      defaultOptions.codeFrame,
      { ...defaultOptions.codeFrame, enabled: false },
      preset.codeFrame,
    ),
    stack: userOptions.stack ?? preset.stack ?? defaultOptions.stack,
    candidateFiles: resolveToggleOption(
      userOptions.candidateFiles,
      defaultOptions.candidateFiles,
      { ...defaultOptions.candidateFiles, enabled: false },
    ),
    console: resolveToggleOption(
      userOptions.console,
      defaultOptions.console,
      { ...defaultOptions.console, enabled: false },
      preset.console,
    ),
    errors: resolveToggleOption(userOptions.errors, defaultOptions.errors, {
      unhandled: false,
    }),
  };
};

const formatFailureTitle = (
  failure: FailureItem,
  index: number,
): {
  relativePath: string;
  fullName: string;
  title: string;
  formattedId: string;
} => {
  const relativePath = failure.test.relativeTestPath;
  const fullName = failure.test.fullName;
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
    TRUNCATION_SUFFIX,
  );
};

const formatPath = (
  rootPath: string,
  filePath?: string | null,
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
            file: formatPath(rootPath, topFrame.file) ?? undefined,
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

const formatConsoleLog = (
  log: UserConsoleLog,
  options: Pick<ResolvedOptions, 'console'>,
): string => {
  const content = truncateString(
    cleanString(log.content),
    options.console.maxCharsPerEntry,
    TRUNCATION_SUFFIX,
  );
  return `[${log.type}] ${log.name}: ${content}`;
};

const buildCandidateFiles = (
  frames: { file?: string | null; lineNumber?: number | null }[],
  rootPath: string,
  maxCandidateFiles: number,
): { path: string; line?: number }[] => {
  const scores = new Map<string, { score: number; line?: number }>();

  frames.forEach((frame, index) => {
    if (!frame.file) return;
    const formattedPath = formatPath(rootPath, frame.file) || frame.file;
    const entry = scores.get(formattedPath) || { score: 0, line: undefined };
    const weight = Math.max(1, 10 - index);
    entry.score += weight;
    entry.line = entry.line ?? frame.lineNumber ?? undefined;
    scores.set(formattedPath, entry);
  });

  return Array.from(scores.entries())
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, maxCandidateFiles)
    .map(([path, meta]) => ({ path, line: meta.line }));
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

const buildReproCommand = (
  relativePath: string,
  fullName: string,
  reproMode: ResolvedOptions['reproduction'],
  agent: Parameters<typeof buildPackageManagerReproCommand>[2],
): string =>
  buildPackageManagerReproCommand(
    relativePath,
    fullName,
    agent,
    reproMode === 'file+name',
  );

export class MdReporter implements Reporter {
  protected rootPath: string;
  protected config: NormalizedConfig;
  private readonly fileFilters: string[];
  private readonly options: ResolvedOptions;
  private readonly logs = new PerFileEventBuffer<string>();

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
      const relativePath = test.relativeTestPath;
      const fullName = test.fullName;
      const title = fullName ? `${relativePath} :: ${fullName}` : relativePath;
      lines.push(`- ${title}`);
    }

    if (truncated) {
      ensureSingleBlankLine(lines);
      lines.push(`Note: list truncated (showing ${limit} of ${tests.length}).`);
    }
  }

  // A watch rerun replays the whole file, so its previous logs are stale.
  onTestFileStart(test: TestFileInfo): void {
    this.logs.reset(test);
  }

  onUserConsoleLog(log: UserConsoleLog): void {
    if (!this.options.console.enabled) return;

    this.logs.push(formatConsoleLog(log, this.options), log);
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

  private renderUnhandledErrors(
    lines: string[],
    errors: SerializedError[],
  ): void {
    if (!this.options.errors.unhandled || !errors.length) return;

    pushHeading(lines, 2, 'Unhandled Errors');
    for (let index = 0; index < errors.length; index += 1) {
      const error = errors[index];
      if (!error) continue;

      pushHeading(lines, 3, `Unhandled Error ${index + 1}`);
      pushFencedBlock(
        lines,
        'json',
        stringifyJson({
          name: error.name,
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
    summary,
    status,
  }: TestRunEndPayload): Promise<void> {
    const rootPath = this.rootPath || process.cwd();
    // A watch session drops deleted files from the result snapshot; the buffered
    // logs have no such signal of their own, so the reported file set prunes
    // them and the buffer stays bounded across a long session.
    this.logs.prune(results);
    const failures = collectFailures({ results, testResults });

    const focusedRun = this.isFocusedRun({ testResults });

    const summaryPayload: Record<string, unknown> = {
      status,
      counts: toReportCounts(summary),
      durationMs: toReportDuration(duration),
    };

    summaryPayload.snapshot = pickSnapshotSummary(snapshotSummary);

    const lines: string[] = [];
    this.renderFrontMatter(lines);
    pushHeading(lines, 1, 'Rstest Test Execution Report');
    pushHeading(lines, 2, 'Summary');
    pushFencedBlock(lines, 'json', stringifyJson(summaryPayload));

    if (
      this.options.testLists === 'always' ||
      (status === 'passed' && focusedRun)
    ) {
      this.renderTestsSection(lines, {
        passed: testResults.filter((result) => result.status === 'passed'),
        skipped: testResults.filter((result) => result.status === 'skipped'),
        todo: testResults.filter((result) => result.status === 'todo'),
      });
    }

    pushHeading(lines, 2, 'Failures');

    if (!failures.length) {
      lines.push('No test failures reported.');
      if (
        status === 'passed' &&
        !focusedRun &&
        this.options.testLists !== 'always'
      ) {
        ensureSingleBlankLine(lines);
        lines.push('Note: all tests passed. Lists omitted for brevity.');
      }
    } else {
      const packageManagerAgent = this.options.reproduction
        ? await detectPackageManagerAgent(rootPath)
        : 'npm';
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
            formatFailureTitle(failure, index);

          lines.push(`- [F${formattedId}] ${title}`);

          const primaryError: SerializedError =
            failure.errors[0] ?? createUnknownFailure();

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
          formatFailureTitle(failure, index);
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

        const reportedErrors: SerializedError[] = failure.errors.length
          ? failure.errors
          : [createUnknownFailure()];
        const errorEntries = await Promise.all(
          reportedErrors.map(async (error) => {
            const candidateFrames = error.stack
              ? await parseErrorStacktrace({
                  stack: error.stack,
                  getSourcemap,
                  fullStack: false,
                  ignore: [...stackIgnores, /\/node_modules\//, /\/chai/],
                })
              : [];

            const fullFrames =
              error.fullStack && error.stack
                ? (
                    await parseErrorStacktrace({
                      stack: error.stack,
                      getSourcemap,
                      fullStack: true,
                    })
                  ).filter((frame) => !frame.file?.startsWith('node:'))
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
              line: frame.lineNumber ?? undefined,
              column: frame.column ?? undefined,
              method: frame.methodName ?? undefined,
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
            const { renderCodeFrame } = await import('../utils/codeFrame');
            const codeFrame = await renderCodeFrame(entry.topFrame, {
              ansi: false,
              linesAbove: this.options.codeFrame.linesAbove,
              linesBelow: this.options.codeFrame.linesBelow,
            });
            if (codeFrame) {
              lines.push(`codeFrame (error ${errorIndex + 1}):`);
              pushFencedBlock(lines, 'text', codeFrame);
            }
          }
        }

        if (this.options.console.enabled) {
          const consoleLogs = this.logs.get(failure.test);
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
