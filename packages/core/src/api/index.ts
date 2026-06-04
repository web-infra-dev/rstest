/**
 * Programmatic Node API for running Rstest in-process.
 *
 * @experimental
 * All exports from this entrypoint are **experimental** and subject to change
 * in any release until Rstest reaches 1.0.0, at which point this surface will
 * be stabilized. Field additions are non-breaking; field removals, renames, or
 * semantic changes may land in any minor release in the 0.x line. Pin the
 * exact patch version of `@rstest/core` if you depend on these APIs today.
 */
import {
  applyResolvedFilters,
  isRelatedRun,
  resolveEffectiveCliFilters,
} from '../cli/commands';
import {
  type CommonOptions,
  mergeWithCLIOptions,
  resolveProjects,
} from '../cli/init';
import { initRstestEnv } from '../cli/prepare';
import { loadConfig, mergeRstestConfig, resolveExtends } from '../config';
import { createRstestContext } from '../core';
import type {
  FileFilterMode,
  ListCommandOptions,
  ListCommandResult,
  Reporter,
  RstestCommand,
  RstestConfig,
  RstestContext,
  RstestRunner,
} from '../types';
import { getAbsolutePath } from '../utils';
import {
  assembleTestRunResult,
  createCaptureReporter,
  createCapturedRunState,
  type TestFileResult,
  type TestRunResult,
  toPublicTestFileResult,
  toSerializedError,
} from './result';

/**
 * The single CLI entry — jest-compatible, used by the `rstest` bin. Parses one
 * argv and resolves to a {@link TestRunResult} for test-running commands.
 *
 * @experimental Subject to change until 1.0.0.
 */
export { runCli } from '../cli';

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

export type {
  SerializedError,
  TestFileResult,
  TestResult,
  TestRunResult,
} from './result';

/**
 * Options for {@link createRstest}. Construction carries only the static
 * config + host wiring; per-invocation selection/control lives in
 * {@link RunOptions}.
 *
 * @experimental Subject to change until 1.0.0.
 */
export interface CreateRstestOptions {
  /** Working directory. Defaults to `process.cwd()`. Base for absolutizing `root`. */
  cwd?: string;

  /**
   * Path to a config file. Unlike the CLI, the programmatic API does NOT
   * auto-discover a config file from `cwd` — pass an explicit path or omit to
   * run with `inlineConfig` only.
   */
  config?: string;

  /**
   * Inline configuration. Shallow-merged with disk config (inline wins for
   * scalars; arrays follow `mergeRstestConfig` semantics). The single override
   * channel for all config content — including `projects` and `reporters`.
   */
  inlineConfig?: RstestConfig;

  /**
   * When `false`, install host `process.on('exit' | 'SIG*')` handlers and call
   * `process.exit()` on config errors (CLI behavior). Defaults to `true` for
   * the programmatic API so a run can't kill the embedding host.
   */
  embedded?: boolean;

  /**
   * CLI-only `--trace`; dumps a Perfetto-compatible performance trace. Not
   * exposed via user config.
   *
   * @internal
   */
  trace?: boolean;
}

/**
 * Per-invocation options for {@link RstestInstance.run} / `listTests`. These
 * map to the CLI's positional args + per-run flags. `related` / `changed` and
 * positional `filters` are mutually exclusive (validated at run time).
 *
 * @experimental Subject to change until 1.0.0.
 */
export interface RunOptions {
  /** Positional test-file filters; matched per `filterMode`. */
  filters?: string[];

  /**
   * Matching strategy for `filters`: `'fuzzy'` (default; case-insensitive
   * substring) or `'exact'` (normalized path equality). Ignored for
   * `related`/`changed`, which always match exactly.
   */
  filterMode?: FileFilterMode;

  /** Run only tests whose full name matches (string coerced via `new RegExp`). */
  testNamePattern?: RegExp | string;

  /** Treat positional `filters` as source files and run only their related tests. */
  related?: boolean;

  /** Derive the run set from git: `true` = working-tree + staged; a string = a `since` ref. */
  changed?: boolean | string;

  /** Update outdated snapshots. */
  update?: boolean;

  /** Stop the run after N failing tests (`0`/`false` = run all). */
  bail?: number | boolean;

  /** Run only a slice of files, as `<index>/<count>` (1-based) or `{ index, count }`. */
  shard?: string | { index: number; count: number };

  /** Run only the named projects (`*` wildcards, `!` negation). */
  project?: string[];

  /** Treat a run that matched no files as pass instead of failure. */
  passWithNoTests?: boolean;
}

/**
 * A programmatic Rstest instance. Created by {@link createRstest}; holds the
 * resolved config identity and runs tests against it per invocation.
 *
 * @experimental Subject to change until 1.0.0.
 */
export interface RstestInstance {
  /** Resolved host context for the most recent build (config, projects, command). */
  readonly context: RstestContext;

  /** Run tests once with `options`; resolves a structured {@link TestRunResult}. */
  run(options?: RunOptions): Promise<TestRunResult>;

  /** Collect matching test files / cases without executing. */
  listTests(
    options?: ListCommandOptions & RunOptions,
  ): Promise<ListCommandResult[]>;

  /** Merge on-disk blob reports into a single aggregate report. */
  mergeReports(options?: { path?: string; cleanup?: boolean }): Promise<void>;

  /** Register an extra reporter applied to subsequent runs. */
  addReporter(reporter: Reporter): void;

  /** Release instance resources. No-op on the 1.0 happy path (each run self-cleans). */
  close(): Promise<void>;
}

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
 * Snapshot the process-global state an embedded run mutates and return a
 * `restore()` that puts it back. A programmatic run lives inside a long-lived
 * host, so — unlike the CLI, which exits — it must contain every global the
 * engine touches in one place: add future globals here rather than as another
 * inline save/restore pair at the call site.
 *
 * - `process.exitCode`: deep layers (globalSetup teardown, coverage thresholds,
 *   no-test-files) set this unconditionally without consulting `embedded`.
 * - `process.env`: `initRstestEnv` sets NODE_ENV/RSTEST and `globalSetup` may
 *   mutate arbitrary vars before workers inherit them.
 */
const snapshotProcessGuards = (): (() => void) => {
  const exitCode = process.exitCode;
  const env = { ...process.env };

  return () => {
    process.exitCode = exitCode;
    // Drop keys added during the run (e.g. by globalSetup) and reset mutated
    // ones. Workers already inherited the run-time env when they spawned, so
    // this only affects the host process.
    for (const key of Object.keys(process.env)) {
      if (!(key in env)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, env);
  };
};

/** Map per-invocation {@link RunOptions} onto the internal CLI option bag. */
const toCommonOptions = (options: RunOptions): CommonOptions => ({
  testNamePattern: options.testNamePattern,
  related: options.related,
  changed: options.changed,
  update: options.update,
  bail: options.bail,
  passWithNoTests: options.passWithNoTests,
  project: options.project,
  shard:
    options.shard === undefined
      ? undefined
      : typeof options.shard === 'string'
        ? options.shard
        : `${options.shard.index}/${options.shard.count}`,
});

/**
 * Create a programmatic Rstest instance. Resolves the config file + inline
 * config + projects up front (the instance's stable identity); each `run()` /
 * `listTests()` performs a full build → execute → teardown against it.
 *
 * Resolves config-load errors at creation time. `run()` resolves on every
 * termination path — including worker crashes — with `ok` reflecting success.
 *
 * @experimental Subject to change until 1.0.0.
 */
export async function createRstest(
  options: CreateRstestOptions = {},
): Promise<RstestInstance> {
  // Match the CLI's environment setup so workers (spawned per run) observe
  // `NODE_ENV=test` / `RSTEST=true`.
  initRstestEnv();

  const cwd = options.cwd
    ? getAbsolutePath(process.cwd(), options.cwd)
    : process.cwd();
  const embedded = options.embedded ?? true;
  const trace = options.trace ?? false;
  const extraReporters: Reporter[] = [];

  // Holds the most recent build's context, exposed via `instance.context`.
  let context!: RstestContext;

  // Resolve config + projects from the static inputs and build an internal
  // runner for `command`, applying the per-invocation `runOptions`. Re-runs the
  // full resolution each call so no mutable state is shared across runs.
  const build = async (
    command: RstestCommand,
    runOptions: RunOptions,
  ): Promise<RstestRunner> => {
    const commonOptions = toCommonOptions(runOptions);

    const { content: userConfig, filePath: configFilePath } =
      await loadConfigForApi({
        cwd,
        configPath: options.config,
        inlineConfig: options.inlineConfig,
      });

    // Propagate per-invocation config-shaped options to the root config and —
    // via `resolveProjects` — to every project config.
    mergeWithCLIOptions(userConfig, commonOptions);
    userConfig.root = userConfig.root
      ? getAbsolutePath(cwd, userConfig.root)
      : cwd;

    const projects = await resolveProjects({
      config: userConfig,
      root: userConfig.root,
      options: commonOptions,
    });

    const resolved = await resolveEffectiveCliFilters({
      options: commonOptions,
      filters: runOptions.filters ?? [],
      createRstest: createRstestContext,
      config: userConfig,
      configFilePath,
      projects,
    });

    // Related/changed runs force exact matching; otherwise honor an explicit
    // `filterMode` (default fuzzy, matching the CLI's positional behavior).
    const finalMode = isRelatedRun(commonOptions)
      ? resolved.fileFilterMode
      : (runOptions.filterMode ?? resolved.fileFilterMode);

    const runner = createRstestContext(
      { config: userConfig, configFilePath, projects, cwd, embedded, trace },
      command,
      resolved.effectiveFilters,
      finalMode,
    );

    await applyResolvedFilters(runner, resolved);

    for (const reporter of extraReporters) {
      runner.context.reporters.push(reporter);
    }

    context = runner.context;
    return runner;
  };

  // Resolve up front so `context` is available for inspection and config-load
  // errors surface at creation time rather than on first run.
  await build('run', {});

  const run = async (runOptions: RunOptions = {}): Promise<TestRunResult> => {
    // Capture host globals up front; restore them in `finally` so the embedding
    // host isn't left with leaked exitCode/env state.
    const restoreProcessGuards = snapshotProcessGuards();
    const captured = createCapturedRunState();
    let files: TestFileResult[] = [];
    let runner: RstestRunner | undefined;

    try {
      runner = await build('run', runOptions);
      runner.context.reporters.push(createCaptureReporter(captured));
      await runner.runTests();
    } catch (err) {
      captured.unhandledErrors.unshift(toSerializedError(err));
    } finally {
      // Read collected results here (not at the end of `try`) so a failure in a
      // post-run step doesn't discard results already gathered during the run.
      if (runner) {
        files = runner.context.reporterResults.results.map(
          toPublicTestFileResult,
        );
      }
      restoreProcessGuards();
    }

    return assembleTestRunResult(files, captured, runner?.context);
  };

  const listTests = async (
    listOptions: ListCommandOptions & RunOptions = {},
  ): Promise<ListCommandResult[]> => {
    const runner = await build('list', listOptions);
    return runner.listTests({
      filesOnly: listOptions.filesOnly,
      json: listOptions.json,
      includeSuites: listOptions.includeSuites,
      printLocation: listOptions.printLocation,
      summary: listOptions.summary,
    });
  };

  const mergeReports = async (mergeOptions?: {
    path?: string;
    cleanup?: boolean;
  }): Promise<void> => {
    const runner = await build('merge-reports', {});
    return runner.mergeReports(mergeOptions);
  };

  const addReporter = (reporter: Reporter): void => {
    extraReporters.push(reporter);
  };

  const close = async (): Promise<void> => {
    // Each run() builds and tears down its own worker pool + Rsbuild server, so
    // there are no instance-held resources to release in 1.0. Kept as a stable
    // forward-compat hook (load-bearing once build-graph reuse lands).
  };

  return {
    get context() {
      return context;
    },
    run,
    listTests,
    mergeReports,
    addReporter,
    close,
  };
}
