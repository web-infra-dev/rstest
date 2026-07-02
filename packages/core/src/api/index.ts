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
import { buildResolvedRunner } from '../cli/commands';
import {
  type CommonOptions,
  initCli,
  mergeWithCLIOptions,
  resolveProjects,
} from '../cli/init';
import { initRstestEnv } from '../cli/prepare';
import { mergeRstestConfig, resolveExtends } from '../config';
import { createRstestContext } from '../core';
import type {
  FileFilterMode,
  ListCommandOptions,
  ListCommandResult,
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
  createResultReporter,
  type TestFileResult,
  type TestRunResult,
  toPublicTestFileResult,
  toSerializedError,
} from './result';

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
 * Function form of {@link CreateRstestOptions.config}: a zero-argument factory
 * that returns the final config to run with. Load a config file yourself inside
 * it (e.g. via `loadConfig` from `@rstest/core`) — the programmatic API does not
 * read one for you. Mirrors rsbuild's `createRsbuild({ config })` factory.
 *
 * @experimental Subject to change until 1.0.0.
 */
export type RstestConfigFn = () => RstestConfig | Promise<RstestConfig>;

/**
 * Options for {@link createRstest}. Construction carries only the static
 * config; per-invocation selection/control lives in {@link RunOptions}.
 *
 * @experimental Subject to change until 1.0.0.
 */
export interface CreateRstestOptions {
  /** Working directory. Defaults to `process.cwd()`. Base for resolving `root`. */
  cwd?: string;

  /**
   * The configuration to run with. Unlike the CLI, the programmatic API does
   * NOT auto-discover or read a config file from `cwd` — you own config
   * loading. This is the single channel for all config content, including
   * `projects` and `reporters`.
   *
   * - **Object**: used as the inline config directly.
   * - **Function** ({@link RstestConfigFn}): a zero-argument factory returning
   *   the final config. Load a config file yourself inside it via `loadConfig`
   *   from `@rstest/core` (optionally merging an override with
   *   `mergeRstestConfig`). Mirrors rsbuild's `createRsbuild({ config })`.
   */
  config?: RstestConfig | RstestConfigFn;

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
 * map to the CLI's positional args + per-run flags. With `related`, the
 * positional `filters` are treated as the source files whose tests are run;
 * `changed` cannot be combined with positional `filters` (validated at run
 * time).
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
 * Parsed CLI options accepted by {@link runCLI} — mirrors what a parsed
 * `rstest <args>` produces: named flags plus positional files in `_`. This is
 * the full CLI option surface (analogous to Jest's `Config.Argv`), as opposed
 * to {@link RunOptions}'s curated per-run subset.
 *
 * @experimental Subject to change until 1.0.0.
 */
export type RstestArgv = CommonOptions & {
  /**
   * Positional arguments. Test-file filters by default; treated as source files
   * when `related` / `findRelatedTests` is set.
   */
  _?: (string | number)[];
};

/**
 * Watch-only options for {@link RstestInstance.watch}, merged with the
 * per-invocation {@link RunOptions}. Mirrors how `listTests` takes
 * `ListCommandOptions & RunOptions`.
 *
 * @experimental Subject to change until 1.0.0.
 */
export interface WatchOptions {
  /**
   * Called after each run in the session — including the first — with that
   * run's {@link TestRunResult}, the same shape {@link RstestInstance.run}
   * resolves. Lets a caller observe every rerun (pass/fail, `unhandledErrors`)
   * without implementing a reporter. A throwing callback is isolated so it
   * can't tear down the watch session.
   */
  onResult?: (result: TestRunResult) => void;
}

/**
 * Handle for an active watch session started by {@link RstestInstance.watch}.
 * Watch keeps re-running the matching tests on file changes; per-run results
 * surface via the configured reporters or {@link WatchOptions.onResult}, not a
 * return value. `close()` stops watching and releases the Rsbuild dev server +
 * worker pool.
 *
 * @experimental Subject to change until 1.0.0.
 */
export interface RstestWatcher {
  /** Stop watching and release the dev server + worker pool. */
  close: () => Promise<void>;
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

  /**
   * Start a watch session: run the matching tests, then keep re-running them as
   * files change. Accepts the same file-selection options as `run`, plus
   * {@link WatchOptions.onResult} to observe each run. Per-run results surface
   * via the configured reporters and/or `onResult` (not the resolved value);
   * resolves once watching is established. Call {@link RstestWatcher.close} to
   * stop watching. Mirrors the CLI's `--watch`, exposed programmatically here.
   */
  watch(options?: WatchOptions & RunOptions): Promise<RstestWatcher>;

  /**
   * Collect matching test files / cases without executing. Accepts the same
   * file-selection options as `run` plus list-specific flags; execution-only
   * {@link RunOptions} fields (`update`, `bail`, `shard`) are ignored here.
   */
  listTests(
    options?: ListCommandOptions & RunOptions,
  ): Promise<ListCommandResult[]>;

  /** Merge on-disk blob reports into a single aggregate report. */
  mergeReports(options?: { path?: string; cleanup?: boolean }): Promise<void>;
}

/** Resolve an optional caller-supplied cwd against the current process cwd. */
const resolveCwd = (cwd?: string): string =>
  cwd ? getAbsolutePath(process.cwd(), cwd) : process.cwd();

const loadConfigForApi = async (
  config?: RstestConfig | RstestConfigFn,
): Promise<RstestConfig> => {
  // The programmatic API never reads a config file itself — the caller owns
  // loading (e.g. via `loadConfig` from `@rstest/core`). Object form is used
  // as-is; function form is a zero-arg factory whose return value is the config.
  const resolved =
    typeof config === 'function' ? await config() : (config ?? {});
  // Clone up front so neither `resolveExtends` nor the later `build` mutations
  // (root resolution, CLI-option merge, e.g. reporters/includeTaskLocation)
  // touch the caller's `config` object — the same object is reused across every
  // `run` / `listTests` / `watch` call (and the eager creation build).
  // `resolveExtends` is a no-op when there's no `extends`.
  return resolveExtends(mergeRstestConfig({}, resolved));
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
  // `isRelatedRun` treats any defined `changed` as changed-mode, so drop an
  // explicit `false` — otherwise `run({ changed: false })` would run only
  // git-changed tests (and reject positional filters).
  changed: options.changed === false ? undefined : options.changed,
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
 * Run a freshly-built runner host-safely and assemble a {@link TestRunResult}:
 * snapshot/restore process globals so the embedding host isn't left with leaked
 * `exitCode`/`env` state, and contain any build/run error as an `unhandledError`
 * (with `ok: false`) instead of throwing or exiting. Shared by
 * {@link createRstest}'s `run` and the standalone {@link runCLI} entry.
 *
 * `buildRunner` runs inside the guarded `try` so config/build errors are
 * captured too; results are read in `finally` so a failure in a post-run step
 * doesn't discard results already gathered during the run.
 */
const executeHostSafeRun = async (
  buildRunner: () => Promise<RstestRunner>,
): Promise<TestRunResult> => {
  const restoreProcessGuards = snapshotProcessGuards();
  // Start from a clean exit code (like the CLI) so `ok` reflects only failures
  // this run produced — not a non-zero code the embedding host set earlier. The
  // guard restores the host's original value afterwards.
  process.exitCode = undefined;
  const captured = createCapturedRunState();
  let files: TestFileResult[] = [];
  let runner: RstestRunner | undefined;

  try {
    runner = await buildRunner();
    runner.context.reporters.push(createCaptureReporter(captured));
    await runner.runTests();
  } catch (err) {
    captured.unhandledErrors.unshift(toSerializedError(err));
  } finally {
    if (runner) {
      files = runner.context.reporterResults.results.map(
        toPublicTestFileResult,
      );
    }
    // Observe the run's final exit code before the guard restores it, so `ok`
    // reflects exit-code-only failures (coverage thresholds, teardown).
    captured.exitCode = process.exitCode;
    restoreProcessGuards();
  }

  return assembleTestRunResult(files, captured, runner?.context);
};

/**
 * Create a programmatic Rstest instance. The static `config` is the instance's
 * identity, but it is **re-resolved on every** `run()` / `listTests()` /
 * `mergeReports()` (and once eagerly at creation), so no mutable state is
 * shared across runs and
 * {@link RstestInstance.context} reflects the most recent build rather than a
 * creation-time snapshot. Each call performs a full build → execute → teardown.
 *
 * Resolves config-load errors at creation time. `run()` resolves on every
 * termination path — including worker crashes — with `ok` reflecting success.
 * For continuous, re-run-on-change execution use {@link RstestInstance.watch}.
 *
 * @experimental Subject to change until 1.0.0.
 */
export async function createRstest(
  options: CreateRstestOptions = {},
): Promise<RstestInstance> {
  const cwd = resolveCwd(options.cwd);
  const trace = options.trace ?? false;

  // Holds the most recent build's context, exposed via `instance.context`.
  let context!: RstestContext;

  // Resolve config + projects from the static inputs and build an internal
  // runner for `command`, applying the per-invocation `runOptions`. Re-runs the
  // full resolution each call so no mutable state is shared across runs.
  const build = async (
    command: RstestCommand,
    runOptions: RunOptions,
    prepareOptions?: (options: CommonOptions) => void,
  ): Promise<RstestRunner> => {
    // Match the CLI's environment setup so workers (spawned per run) observe
    // `NODE_ENV=test` / `RSTEST=true`. Every entry that calls `build` snapshots
    // and restores process globals around it (construction, `run`, `watch`,
    // `listTests`, `mergeReports`), so this mutation never leaks to the host.
    initRstestEnv();

    const commonOptions = toCommonOptions(runOptions);
    // Mutate the option bag (not the root config) so the tweak reaches both the
    // root config and — via `resolveProjects` — every project config, which
    // both derive from `commonOptions`.
    prepareOptions?.(commonOptions);

    const userConfig = await loadConfigForApi(options.config);

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

    const runner = await buildResolvedRunner({
      createRstest: createRstestContext,
      config: userConfig,
      // The programmatic API doesn't read a config file, so there's no path to
      // track (the caller's factory owns any file it loads).
      configFilePath: undefined,
      projects,
      command,
      options: commonOptions,
      filters: runOptions.filters ?? [],
      cwd,
      embedded: true,
      trace,
      filterMode: runOptions.filterMode,
    });

    context = runner.context;
    return runner;
  };

  // Resolve up front so `context` is available for inspection and config-load
  // errors surface at creation time rather than on first run. Snapshot and
  // restore process globals around this eager build so merely creating an
  // instance never leaves the host in test mode or with a mutated exit code.
  // Build with no reporters: the default reporter constructs a TTY renderer that
  // intercepts `process.stdout`/`stderr` and registers a `process.on('exit')`
  // handler at construction time, which a host that only inspects `context` must
  // not incur. `run()` rebuilds with the real reporters.
  const restoreCreation = snapshotProcessGuards();
  try {
    await build('run', {}, (opts) => {
      opts.reporters = [];
    });
  } finally {
    restoreCreation();
  }

  const run = (runOptions: RunOptions = {}): Promise<TestRunResult> =>
    executeHostSafeRun(() => build('run', runOptions));

  const watch = async (
    watchOptions: WatchOptions & RunOptions = {},
  ): Promise<RstestWatcher> => {
    const { onResult, ...runOptions } = watchOptions;
    // Contain `process.exitCode` around the watch session so a failing run
    // doesn't leave the embedding host marked as failed; the dev server keeps
    // running after `runTests()` resolves, so restore only when `close()` is
    // called. `env` stays test-mode for the instance's lifetime (restored by
    // the instance's own `close()`), which is what re-run workers need.
    const restore = snapshotProcessGuards();
    try {
      const runner = await build('watch', runOptions);
      if (onResult) {
        // Bridge each run's summary to `onResult` as the public TestRunResult,
        // so a caller gets structured per-rerun results without writing a
        // reporter. The runner is built once for the session, so `context` is a
        // fixed reference; `createResultReporter` isolates a throwing callback.
        runner.context.reporters.push(
          createResultReporter(onResult, runner.context),
        );
      }
      const handle = await runner.runTests();
      return {
        close: async () => {
          try {
            if (handle) {
              await handle.close();
            }
          } finally {
            restore();
          }
        },
      };
    } catch (err) {
      // Setup failed before a watcher handle could be returned, so `close()`
      // will never run — restore the host snapshot here instead of leaking it.
      restore();
      throw err;
    }
  };

  const listTests = async (
    listOptions: ListCommandOptions & RunOptions = {},
  ): Promise<ListCommandResult[]> => {
    // `listTests` sets `process.exitCode = 1` on collection/parse errors; guard
    // the host process so an embedded caller isn't left marked as failed.
    const restore = snapshotProcessGuards();
    try {
      const runner = await build('list', listOptions, (opts) => {
        // Mirror the CLI: enable location collection before the runner is built,
        // otherwise `printLocation` is silently ineffective. Route it through the
        // option bag so it reaches per-project configs too (not just the root).
        if (listOptions.printLocation) {
          opts.includeTaskLocation = true;
        }
      });
      return await runner.listTests({
        filesOnly: listOptions.filesOnly,
        json: listOptions.json,
        includeSuites: listOptions.includeSuites,
        printLocation: listOptions.printLocation,
        summary: listOptions.summary,
      });
    } finally {
      restore();
    }
  };

  const mergeReports = async (mergeOptions?: {
    path?: string;
    cleanup?: boolean;
  }): Promise<void> => {
    // `mergeReports` sets `process.exitCode = 1` when a blob report contains
    // failed tests / unhandled errors; guard the host process so the merge
    // doesn't leave the embedding process marked as failed.
    const restore = snapshotProcessGuards();
    try {
      const runner = await build('merge-reports', {});
      return await runner.mergeReports(mergeOptions);
    } finally {
      restore();
    }
  };

  return {
    get context() {
      return context;
    },
    run,
    watch,
    listTests,
    mergeReports,
  };
}

/**
 * Run Rstest once from parsed CLI options — the Jest-compatible programmatic
 * entry, analogous to `@jest/core`'s `runCLI(argv, projects)`. It accepts the
 * full CLI option surface ({@link RstestArgv}: named flags plus positional files
 * in `argv._`) and resolves to a structured {@link TestRunResult}.
 *
 * Unlike {@link createRstest}, this mirrors the `rstest run` CLI command:
 * it auto-discovers the config file from `cwd` and applies CLI defaults. It is
 * host-safe (never calls `process.exit`) and one-shot — for repeated runs,
 * config inspection, listing, report merging, or watch mode, use
 * {@link createRstest}.
 *
 * @experimental Subject to change until 1.0.0.
 */
export async function runCLI(
  argv: RstestArgv = {},
  options: { cwd?: string } = {},
): Promise<TestRunResult> {
  const cwd = resolveCwd(options.cwd);
  const { _: positionals, ...commonOptions } = argv;
  const filters = positionals ?? [];

  // `isRelatedRun` treats any defined `changed` as changed-mode. An embedder
  // forwarding parsed argv with boolean defaults (`changed: false`) would then
  // wrongly run only git-changed tests / reject positional filters, so drop the
  // explicit `false` here the same way `toCommonOptions` does for `run()`.
  if (commonOptions.changed === false) {
    commonOptions.changed = undefined;
  }

  return executeHostSafeRun(async () => {
    // Match the CLI's environment setup so workers (spawned per run) observe
    // `NODE_ENV=test` / `RSTEST=true`. Run it *inside* the guarded section so the
    // env mutation is captured by `executeHostSafeRun`'s snapshot and restored
    // afterwards, keeping the embedding host's environment intact.
    initRstestEnv();
    const { config, configFilePath, projects } = await initCli(
      commonOptions,
      cwd,
    );
    return buildResolvedRunner({
      createRstest: createRstestContext,
      config,
      configFilePath,
      projects,
      command: 'run',
      options: commonOptions,
      filters,
      cwd,
      embedded: true,
      trace: commonOptions.trace,
    });
  });
}
