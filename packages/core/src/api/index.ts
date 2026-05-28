/**
 * @module @rstest/core/api
 *
 * Programmatic Node API for running Rstest in-process.
 *
 * @experimental
 * All exports from this entrypoint are **experimental** and subject to change
 * in any release until Rstest reaches 1.0.0, at which point this surface will
 * be stabilized. Field additions are non-breaking; field removals, renames, or
 * semantic changes may land in any minor release in the 0.x line. Pin the
 * exact patch version of `@rstest/core` if you depend on these APIs today.
 */
import { resolveProjects } from '../cli/init';
import { loadConfig, mergeRstestConfig, resolveExtends } from '../config';
import { createRstest } from '../core';
import type {
  CoverageMapData,
  FormattedError,
  Reporter,
  RstestConfig,
  SnapshotSummary,
  TestFileResult as InternalTestFileResult,
  TestResult as InternalTestResult,
  TestResultStatus,
} from '../types';
import { getAbsolutePath } from '../utils';

/**
 * @experimental Subject to change until 1.0.0.
 */
export type { Reporter } from '../types';

/**
 * Inline configuration shape; same type the `rstest.config.ts` exports.
 *
 * @experimental Subject to change until 1.0.0.
 */
export type { RstestConfig as RstestUserConfig } from '../types';

/**
 * Per-test result status.
 *
 * @experimental Subject to change until 1.0.0.
 */
export type { TestResultStatus } from '../types';

/**
 * Cross-IPC-safe error shape. Returned in `TestRunResult.unhandledErrors` and
 * in per-test `errors`/`retryErrors`. Assertion-specific fields (`diff`,
 * `actual`, `expected`) are only set for `@vitest/expect`-style errors.
 *
 * @experimental Subject to change until 1.0.0.
 */
export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  diff?: string;
  actual?: string;
  expected?: string;
  cause?: SerializedError;
}

/**
 * Public per-test result. Intentionally a curated subset of the internal
 * reporter type so refactors of internal reporter state do not break this
 * surface.
 *
 * @experimental Subject to change until 1.0.0.
 */
export interface TestResult {
  /** Final state of the test case. */
  status: TestResultStatus;
  /** Test case name (no parent suite names included). */
  name: string;
  /** Absolute path to the test file. */
  testPath: string;
  /** Names of parent `describe` blocks, outermost first. */
  parentNames?: string[];
  /** Wall-clock duration in ms; absent for skipped/todo tests. */
  duration?: number;
  /** Errors from the final attempt. */
  errors?: SerializedError[];
  /** Errors from previous failed attempts when `retry` is configured. */
  retryErrors?: SerializedError[];
  /** Number of retries performed (0 when the first attempt passed). */
  retryCount?: number;
  /** Project name from `projects` config; default project is `'default'`. */
  project: string;
}

/**
 * Public per-file result. Extends {@link TestResult} with the per-case
 * breakdown.
 *
 * @experimental Subject to change until 1.0.0.
 */
export interface TestFileResult extends TestResult {
  /** Flattened list of test cases discovered in this file. */
  results: TestResult[];
}

/**
 * Options for {@link runRstest}.
 *
 * @experimental Subject to change until 1.0.0.
 */
export interface RunRstestOptions {
  /** Working directory. Defaults to `process.cwd()`. */
  cwd?: string;

  /**
   * Path to a config file. Unlike the CLI, the programmatic API does NOT
   * auto-discover a config file from `cwd` — pass an explicit path or omit
   * to run with `inlineConfig` only.
   */
  config?: string;

  /**
   * Inline configuration. Shallow-merged with disk config (inline wins for
   * scalars; arrays follow `mergeRstestConfig` semantics — see `src/config.ts`).
   */
  inlineConfig?: RstestConfig;

  /**
   * Exact test file paths to run. When provided, only matching paths
   * execute; other discovered entries are ignored.
   */
  files?: string[];

  /**
   * Regex (or string-coerced regex) matched against test names. Equivalent
   * to the CLI's `-t, --testNamePattern` flag.
   */
  testNamePattern?: RegExp | string;
}

/**
 * Result of a {@link runRstest} call.
 *
 * @experimental Subject to change until 1.0.0.
 */
export interface TestRunResult {
  /** `stats.tests.failed === 0 && stats.files.failed === 0 && unhandledErrors.length === 0`. */
  ok: boolean;

  /** Per-file aggregate results. */
  files: TestFileResult[];

  /** Pre-computed counts. Add optional fields under `stats.*` in minor releases. */
  stats: {
    tests: {
      total: number;
      passed: number;
      failed: number;
      skipped: number;
      todo: number;
    };
    files: {
      total: number;
      failed: number;
    };
  };

  /** Errors not attributable to a single test (worker crash, config load). */
  unhandledErrors: SerializedError[];

  /** Wall-clock duration in ms. Sub-phase fields may be added under `duration.*`. */
  duration: { total: number };

  /** Snapshot summary. Absent only when the run aborted before any test executed (e.g. config load error). */
  snapshot?: SnapshotSummary;

  /** Coverage data. Only present when `coverage.enabled` in the resolved config. */
  coverage?: CoverageMapData;
}

const toSerializedError = (
  err: unknown,
  seen: WeakSet<object> = new WeakSet(),
): SerializedError => {
  if (!err || typeof err !== 'object') {
    return { name: 'Error', message: String(err) };
  }
  if (seen.has(err)) {
    return { name: 'Error', message: '[Circular]' };
  }
  seen.add(err);
  const e = err as Partial<FormattedError> & { cause?: unknown };
  return {
    name: e.name || 'Error',
    message: e.message ?? String(err),
    stack: e.stack,
    diff: e.diff,
    actual: e.actual,
    expected: e.expected,
    cause: e.cause !== undefined ? toSerializedError(e.cause, seen) : undefined,
  };
};

const toPublicTestResult = (r: InternalTestResult): TestResult => ({
  status: r.status,
  name: r.name,
  testPath: r.testPath,
  parentNames: r.parentNames,
  duration: r.duration,
  errors: r.errors?.map((err) => toSerializedError(err)),
  retryErrors: r.retryErrors?.map((err) => toSerializedError(err)),
  retryCount: r.retryCount,
  project: r.project,
});

const toPublicTestFileResult = (f: InternalTestFileResult): TestFileResult => ({
  ...toPublicTestResult(f),
  results: f.results.map(toPublicTestResult),
});

const computeStats = (
  files: readonly TestFileResult[],
): TestRunResult['stats'] => {
  const stats: TestRunResult['stats'] = {
    tests: { total: 0, passed: 0, failed: 0, skipped: 0, todo: 0 },
    files: { total: files.length, failed: 0 },
  };
  for (const file of files) {
    if (file.status === 'fail') {
      stats.files.failed++;
    }
    for (const t of file.results) {
      stats.tests.total++;
      switch (t.status) {
        case 'pass':
          stats.tests.passed++;
          break;
        case 'fail':
          stats.tests.failed++;
          break;
        case 'skip':
          stats.tests.skipped++;
          break;
        case 'todo':
          stats.tests.todo++;
          break;
      }
    }
  }
  return stats;
};

const loadConfigForApi = async ({
  cwd,
  configPath,
  inlineConfig,
}: {
  cwd: string;
  configPath?: string;
  inlineConfig?: RstestConfig;
}): Promise<{ content: RstestConfig; filePath?: string }> => {
  let diskContent: RstestConfig = {};
  let filePath: string | undefined;

  if (configPath) {
    const loaded = await loadConfig({ cwd, path: configPath });
    diskContent = loaded.content;
    filePath = loaded.filePath ?? undefined;
  }

  // `loadConfig` already resolved `extends` on disk content. Resolve inline
  // extends *before* merging so the merged result doesn't carry both copies
  // (which would double-apply disk extends if we re-ran resolveExtends here).
  let resolvedInline: RstestConfig = inlineConfig ?? {};
  if (resolvedInline.extends) {
    resolvedInline = await resolveExtends(resolvedInline);
  }

  const merged = mergeRstestConfig(diskContent, resolvedInline);

  return { content: merged, filePath };
};

/**
 * Run Rstest in-process and return structured results.
 *
 * Resolves on every termination path — including config errors and worker
 * crashes — with `ok` reflecting overall success. The returned promise only
 * rejects for programmer errors (e.g. invalid argument types).
 *
 * @experimental Subject to change until 1.0.0.
 */
export async function runRstest(
  options: RunRstestOptions = {},
): Promise<TestRunResult> {
  const cwd = options.cwd
    ? getAbsolutePath(process.cwd(), options.cwd)
    : process.cwd();

  // Snapshot `process.exitCode` and restore it in `finally`. Belt-and-suspenders
  // against unconditional `process.exitCode = 1` mutations in deeper layers
  // (globalSetup teardown, coverage threshold failures, etc.) that don't
  // consult `context.embedded`. The CLI path never goes through this function.
  const originalExitCode = process.exitCode;

  const captured: {
    unhandledErrors: SerializedError[];
    duration: { total: number };
    coverage?: CoverageMapData;
    snapshot?: SnapshotSummary;
  } = {
    unhandledErrors: [],
    duration: { total: 0 },
  };

  const captureReporter: Reporter = {
    onTestRunEnd: ({
      unhandledErrors,
      duration,
      coverage,
      snapshotSummary,
    }) => {
      captured.unhandledErrors = (unhandledErrors ?? []).map((err) =>
        toSerializedError(err),
      );
      captured.duration = { total: duration.totalTime };
      captured.coverage = coverage;
      captured.snapshot = snapshotSummary;
    },
  };

  let files: TestFileResult[] = [];

  try {
    try {
      const { content: userConfig, filePath: configFilePath } =
        await loadConfigForApi({
          cwd,
          configPath: options.config,
          inlineConfig: options.inlineConfig,
        });

      if (!userConfig.root) {
        userConfig.root = cwd;
      }

      if (options.testNamePattern !== undefined) {
        userConfig.testNamePattern = options.testNamePattern;
      }

      const projects = await resolveProjects({
        config: userConfig,
        root: userConfig.root,
        options: {},
      });

      // `options.files !== undefined` (not `?.length`) so an explicit empty
      // array runs zero files instead of falling back to fuzzy/no-filter mode.
      const fileFilters = options.files ?? [];
      const fileFilterMode = options.files !== undefined ? 'exact' : 'fuzzy';

      const rstest = createRstest(
        {
          config: userConfig,
          configFilePath,
          projects,
          cwd,
          embedded: true,
        },
        'run',
        fileFilters,
        fileFilterMode,
      );

      rstest.context.reporters.push(captureReporter);

      await rstest.runTests();

      files = rstest.context.reporterResults.results.map(
        toPublicTestFileResult,
      );
    } catch (err) {
      captured.unhandledErrors.unshift(toSerializedError(err));
    }

    const stats = computeStats(files);
    const ok =
      stats.tests.failed === 0 &&
      stats.files.failed === 0 &&
      captured.unhandledErrors.length === 0;

    return {
      ok,
      files,
      stats,
      unhandledErrors: captured.unhandledErrors,
      duration: captured.duration,
      snapshot: captured.snapshot,
      coverage: captured.coverage,
    };
  } finally {
    process.exitCode = originalExitCode;
  }
}
