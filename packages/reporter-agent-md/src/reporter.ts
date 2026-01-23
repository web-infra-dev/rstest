import { createRequire } from 'node:module';
import { determineAgent } from '@vercel/detect-agent';
import type { Agent } from 'package-manager-detector';
import { resolveCommand } from 'package-manager-detector/commands';
import { detect as detectPackageManager } from 'package-manager-detector/detect';
import { relative, resolve } from 'pathe';
import stripAnsi from 'strip-ansi';
import { createCodeFrame } from './codeFrame';
import { parseErrorStacktrace } from './stack';
import type {
  AgentMdReporterOptions,
  FormattedError,
  Reporter,
  SnapshotSummary,
  TestFileResult,
  TestResult,
  UserConsoleLog,
} from './types';

type ResolvedOptions = Required<AgentMdReporterOptions>;

type FailureItem = {
  test: TestResult;
  errors: FormattedError[];
};

const require = createRequire(import.meta.url);

const getRstestCoreVersion = (): string => {
  try {
    const pkg = require('@rstest/core/package.json') as { version?: string };
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
};

const defaultOptions: ResolvedOptions = {
  preset: 'normal',
  includeEnv: true,
  includeSnapshotSummary: true,
  includeRepro: true,
  reproMode: 'file+name',
  includeUnhandledErrors: true,
  maxFailures: 50,
  includeFailureListWhenTruncated: true,
  includeCodeFrame: true,
  codeFrameLinesAbove: 2,
  codeFrameLinesBelow: 2,
  includeFullStackFrames: true,
  maxStackFrames: 20,
  includeCandidateFiles: true,
  maxCandidateFiles: 5,
  includeConsole: true,
  maxConsoleLogsPerTestPath: 50,
  maxConsoleCharsPerEntry: 2000,
  stripAnsi: true,
};

const presetOptions: Record<
  NonNullable<AgentMdReporterOptions['preset']>,
  Partial<ResolvedOptions>
> = {
  normal: {},
  compact: {
    includeConsole: false,
    includeFullStackFrames: false,
    includeCodeFrame: false,
    maxStackFrames: 5,
    maxFailures: 20,
  },
  full: {
    maxStackFrames: 50,
    maxConsoleLogsPerTestPath: 200,
    maxConsoleCharsPerEntry: 5000,
    maxFailures: 200,
    codeFrameLinesAbove: 3,
    codeFrameLinesBelow: 3,
  },
};

const resolveOptions = (
  userOptions: AgentMdReporterOptions = {},
): ResolvedOptions => {
  const preset = userOptions.preset ?? defaultOptions.preset;
  return {
    ...defaultOptions,
    ...presetOptions[preset],
    ...userOptions,
    preset,
  };
};

const formatFullTestName = (test: Pick<TestResult, 'name' | 'parentNames'>) => {
  const names = (test.parentNames || []).concat(test.name).filter(Boolean);
  return names.join(' > ');
};

const cleanString = (value: string, options: ResolvedOptions): string => {
  return options.stripAnsi ? stripAnsi(value) : value;
};

const truncateString = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 12))}... [truncated]`;
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
  options: ResolvedOptions,
): string => {
  const content = truncateString(
    cleanString(log.content, options),
    options.maxConsoleCharsPerEntry,
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

const detectPackageManagerAgent = async (cwd: string): Promise<Agent> => {
  const result = await detectPackageManager({ cwd });
  return result?.agent ?? 'npm';
};

export const detectAgent = async (): Promise<{
  isAgent: boolean;
  agent?: string;
  rawAgent?: string;
}> => {
  if (process.env.OPENCODE === '1') {
    return {
      isAgent: true,
      agent: 'opencode',
      rawAgent: 'OPENCODE',
    };
  }

  return (await determineAgent()) as unknown as {
    isAgent: boolean;
    agent?: string;
    rawAgent?: string;
  };
};

export const createMdReporter = (
  userOptions: AgentMdReporterOptions = {},
): Reporter => {
  const options = resolveOptions(userOptions);
  const logsByTestPath = new Map<string, string[]>();

  const recordLog = (log: UserConsoleLog) => {
    if (!options.includeConsole) return;
    const logs = logsByTestPath.get(log.testPath) || [];
    logs.push(formatConsoleLog(log, options));
    logsByTestPath.set(log.testPath, logs);
  };

  return {
    onUserConsoleLog(log) {
      recordLog(log);
    },
    async onTestRunEnd({
      results,
      testResults,
      duration,
      getSourcemap,
      snapshotSummary,
      unhandledErrors,
      filterRerunTestPaths,
    }) {
      const rootPath = process.cwd();
      const failures = collectFailures({
        results,
        testResults,
        filterRerunTestPaths,
      });
      const packageManagerAgent = options.includeRepro
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

      if (options.includeSnapshotSummary) {
        summaryPayload.snapshot = pickSnapshotSummary(snapshotSummary);
      }

      const frontMatter: Record<string, unknown> = {
        tool: 'rstest',
        toolVersion: getRstestCoreVersion(),
        timestamp: new Date().toISOString(),
      };

      if (options.includeEnv) {
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
      lines.push('# Rstest Agent Report');
      lines.push('');
      lines.push('## Summary');
      lines.push('```json');
      lines.push(stringifyJson(summaryPayload));
      lines.push('```');
      lines.push('');
      lines.push('## Failures');

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

        const maxFailures = Math.max(0, options.maxFailures);
        const shouldTruncate = failureTitles.length > maxFailures;
        const displayedFailures = shouldTruncate
          ? failures.slice(0, maxFailures)
          : failures;

        if (shouldTruncate && options.includeFailureListWhenTruncated) {
          lines.push('');
          lines.push('### Failure List (truncated)');
          for (const title of failureTitles) {
            lines.push(`- ${title}`);
          }
          lines.push('');
          lines.push(`### Failure Details (first ${maxFailures})`);
        }

        for (let index = 0; index < displayedFailures.length; index += 1) {
          const failure = displayedFailures[index];
          if (!failure) {
            continue;
          }
          const relativePath = relative(rootPath, failure.test.testPath);
          const fullName = formatFullTestName(failure.test);
          const title = fullName
            ? `${relativePath} :: ${fullName}`
            : relativePath;
          const failureId = shouldTruncate
            ? index + 1
            : failures.indexOf(failure) + 1;
          const formattedId = String(failureId).padStart(2, '0');
          lines.push('');
          lines.push(`### [F${formattedId}] ${title}`);

          if (options.includeRepro) {
            lines.push('');
            lines.push('repro:');
            lines.push('```bash');
            const reproCommand = buildReproCommand(
              relativePath,
              fullName,
              options.reproMode,
              packageManagerAgent,
            );
            lines.push(reproCommand);
            lines.push('```');
          }

          const errorEntries = await Promise.all(
            (failure.errors.length
              ? failure.errors
              : [{ message: 'Unknown error' }]
            ).map(async (error) => {
              const stackFrames = error.stack
                ? await parseErrorStacktrace({
                    stack: error.stack,
                    getSourcemap,
                    fullStack: error.fullStack,
                  })
                : [];
              const trimmedFrames = options.includeFullStackFrames
                ? stackFrames.slice(0, options.maxStackFrames)
                : [];
              const topFrame = stackFrames[0];
              return {
                error,
                topFrame,
                stackFrames: trimmedFrames,
              };
            }),
          );

          const allFrames = errorEntries.flatMap((entry) => entry.stackFrames);
          const candidateFiles = options.includeCandidateFiles
            ? buildCandidateFiles(
                allFrames,
                rootPath,
                options.maxCandidateFiles,
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
              const mappedStackFrames = options.includeFullStackFrames
                ? stackFrames.map((frame) => ({
                    file: formatPath(rootPath, frame.file),
                    line: frame.lineNumber,
                    column: frame.column,
                    method: frame.methodName,
                  }))
                : [];

              return {
                type: getErrorType(error),
                message: cleanString(error.message, options),
                diff:
                  error.expected !== undefined && error.actual !== undefined
                    ? undefined
                    : error.diff
                      ? cleanString(error.diff, options)
                      : undefined,
                expected: error.expected,
                actual: error.actual,
                ...(mappedStackFrames.length
                  ? {}
                  : {
                      topFrame: topFrame
                        ? {
                            file: formatPath(rootPath, topFrame.file),
                            line: topFrame.lineNumber ?? null,
                            column: topFrame.column ?? null,
                            method: topFrame.methodName ?? null,
                          }
                        : null,
                    }),
                stackFrames: mappedStackFrames,
              };
            }),
            candidateFiles: candidateFiles.length ? candidateFiles : undefined,
          };

          lines.push('');
          lines.push('details:');
          lines.push('```json');
          lines.push(stringifyJson(failurePayload));
          lines.push('```');

          if (options.includeCodeFrame) {
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
                linesAbove: options.codeFrameLinesAbove,
                linesBelow: options.codeFrameLinesBelow,
                line: entry.topFrame.lineNumber,
                column: entry.topFrame.column || 1,
              });
              if (codeFrame) {
                lines.push('');
                lines.push(`codeFrame (error ${errorIndex + 1}):`);
                lines.push('```text');
                lines.push(codeFrame);
                lines.push('```');
              }
            }
          }

          if (options.includeConsole) {
            const consoleLogs = logsByTestPath.get(failure.test.testPath) || [];
            const limitedLogs = consoleLogs.slice(
              Math.max(
                0,
                consoleLogs.length - options.maxConsoleLogsPerTestPath,
              ),
            );
            if (limitedLogs.length) {
              lines.push('');
              lines.push('console:');
              lines.push('```text');
              lines.push(limitedLogs.join('\n'));
              lines.push('```');
            }
          }
        }
      }

      if (options.includeUnhandledErrors && unhandledErrors?.length) {
        lines.push('');
        lines.push('## Unhandled Errors');
        for (let index = 0; index < unhandledErrors.length; index += 1) {
          const error = unhandledErrors[index];
          if (!error) {
            continue;
          }
          lines.push('');
          lines.push(`### Unhandled Error ${index + 1}`);
          lines.push('```json');
          lines.push(
            stringifyJson({
              name: error.name || 'Error',
              message: cleanString(error.message, options),
              stack: error.stack
                ? cleanString(error.stack, options)
                : undefined,
            }),
          );
          lines.push('```');
        }
      }

      const output = lines.join('\n');
      process.stdout.write(`${output}\n`);
    },
  };
};

export const createReporters = async (
  options: AgentMdReporterOptions = {},
): Promise<(Reporter | string)[]> => {
  const { isAgent } = await detectAgent();
  return isAgent ? [createMdReporter(options)] : ['default'];
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
  reproMode: ResolvedOptions['reproMode'],
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
