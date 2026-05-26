/**
 * Programmatic Node API for running Rstest in-process.
 *
 * Stability: Public surface; field-frozen at 1.0.0. Adding optional fields is
 * a minor change; removing or repurposing fields requires a major bump.
 *
 * @see RFC-programmatic-node-api.md
 */
import { loadConfig, mergeRstestConfig, resolveExtends } from '../config';
import { resolveProjects } from '../cli/init';
import { createRstest } from '../core';
import type {
  CoverageMapData,
  FormattedError,
  Reporter,
  RstestConfig,
  SnapshotSummary,
  TestFileResult,
} from '../types';
import { getAbsolutePath } from '../utils';

export type { Reporter, TestFileResult } from '../types';
/** Inline configuration shape; same type the `rstest.config.ts` exports. */
export type { RstestConfig as RstestUserConfig } from '../types';

/**
 * Cross-IPC-safe error shape. Returned in `TestRunResult.unhandledErrors`.
 * Assertion-specific fields (`diff`, `actual`, `expected`) are only set for
 * `@vitest/expect`-style errors.
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

export interface TestRunResult {
  /** `stats.tests.failed === 0 && unhandledErrors.length === 0`. */
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

const toSerializedError = (err: unknown): SerializedError => {
  if (!err || typeof err !== 'object') {
    return { name: 'Error', message: String(err) };
  }
  const e = err as Partial<FormattedError> & { cause?: unknown };
  return {
    name: e.name || 'Error',
    message: e.message ?? String(err),
    stack: e.stack,
    diff: e.diff,
    actual: e.actual,
    expected: e.expected,
    cause: e.cause !== undefined ? toSerializedError(e.cause) : undefined,
  };
};

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

  let merged = mergeRstestConfig(diskContent, inlineConfig ?? {});

  // `loadConfig` already resolved `extends` on disk content. If the inline
  // config introduced its own `extends`, resolve them here so the final
  // merged config is fully expanded.
  if (inlineConfig?.extends) {
    merged = await resolveExtends(merged);
  }

  return { content: merged, filePath };
};

/**
 * Run Rstest in-process and return structured results.
 *
 * Resolves on every termination path — including config errors and worker
 * crashes — with `ok` reflecting overall success. The returned promise only
 * rejects for programmer errors (e.g. invalid argument types).
 */
export async function runRstest(
  options: RunRstestOptions = {},
): Promise<TestRunResult> {
  const cwd = options.cwd
    ? getAbsolutePath(process.cwd(), options.cwd)
    : process.cwd();

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
      captured.unhandledErrors = (unhandledErrors ?? []).map(toSerializedError);
      captured.duration = { total: duration.totalTime };
      captured.coverage = coverage;
      captured.snapshot = snapshotSummary;
    },
  };

  let files: TestFileResult[] = [];
  let initError: SerializedError | undefined;

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

    const fileFilters = options.files ?? [];
    const fileFilterMode = options.files?.length ? 'exact' : 'fuzzy';

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

    files = rstest.context.reporterResults.results;
  } catch (err) {
    initError = toSerializedError(err);
  }

  const allErrors = initError
    ? [initError, ...captured.unhandledErrors]
    : captured.unhandledErrors;

  const stats = computeStats(files);
  const ok = stats.tests.failed === 0 && allErrors.length === 0;

  return {
    ok,
    files,
    stats,
    unhandledErrors: allErrors,
    duration: captured.duration,
    snapshot: captured.snapshot,
    coverage: captured.coverage,
  };
}
