/**
 * Programmatic Node API for Rstest: an in-process, host-safe instance factory
 * (`createRstest`) plus a process-owning CLI passthrough (`runCLI`) for bridging
 * Rstest into another CLI.
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
  mergeWithCLIOptions,
  resolveProjects,
} from '../cli/init';
import { initRstestEnv } from '../cli/prepare';
import { mergeRstestConfig, resolveExtends } from '../config';
import { createRstestContext } from '../core';
import type {
  CoreTestRunner,
  FileFilterMode,
  ListCommandOptions,
  ListCommandResult,
  NormalizedConfig,
  ResolvedRstest,
  RstestCommand,
  RstestConfig,
  RstestContext,
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

// The CLI passthrough entry — canonical declaration + docs in `../cli`.
export { runCLI, type RunCLIOptions } from '../cli';

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
 * Resolved configuration Rstest runs with; the normalized form of
 * {@link RstestUserConfig}, surfaced on {@link RstestInstanceContext}.
 *
 * @experimental Subject to change until 1.0.0.
 */
export type { NormalizedConfig } from '../types';

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
 * Build-scoped selection for {@link RstestInstance.createRunner}: decides which
 * test files get compiled. Fixed for the runner's lifetime — which is why
 * {@link RstestRunner.build} takes no options, and why `related`/`changed`
 * resolve their git state once, at creation.
 *
 * @experimental Subject to change until 1.0.0.
 */
export interface CreateRunnerOptions {
  /** Positional test-file filters; matched per `filterMode`. */
  filters?: string[];

  /**
   * Matching strategy for `filters`: `'fuzzy'` (default; case-insensitive
   * substring) or `'exact'` (normalized path equality). Ignored for
   * `related`/`changed`, which always match exactly.
   */
  filterMode?: FileFilterMode;

  /** Treat positional `filters` as source files and run only their related tests. */
  related?: boolean;

  /** Derive the run set from git: `true` = working-tree + staged; a string = a `since` ref. */
  changed?: boolean | string;

  /** Run only a slice of files, as `<index>/<count>` (1-based) or `{ index, count }`. */
  shard?: string | { index: number; count: number };

  /** Run only the named projects (`*` wildcards, `!` negation). */
  project?: string[];
}

/**
 * Run-scoped selection and control for {@link RstestRunner.run}: picks within
 * the already-compiled test set and configures that one execution. Every field
 * is restored afterwards, so it never leaks into the next run.
 *
 * @experimental Subject to change until 1.0.0.
 */
export interface RunnerRunOptions {
  /**
   * Narrows within the built set, matched per `filterMode`. It can only narrow:
   * a filter matching no compiled test file runs nothing rather than widening
   * the build.
   */
  filters?: string[];

  /**
   * Matching strategy for `filters`: `'fuzzy'` (default; case-insensitive
   * substring) or `'exact'` (normalized path equality).
   */
  filterMode?: FileFilterMode;

  /** Run only tests whose full name matches (string coerced via `new RegExp`). */
  testNamePattern?: RegExp | string;

  /** Update outdated snapshots. */
  update?: boolean;

  /** Stop the run after N failing tests (`0`/`false` = run all). */
  bail?: number | boolean;

  /** Treat a run that matched no files as pass instead of failure. */
  passWithNoTests?: boolean;
}

/**
 * Per-invocation options for {@link RstestInstance.run} / `listTests`. These
 * map to the CLI's positional args + per-run flags. With `related`, the
 * positional `filters` are treated as the source files whose tests are run;
 * `changed` cannot be combined with positional `filters` (validated at run
 * time).
 *
 * A one-shot `run()` builds and executes in the same call, so it takes both of
 * the runner's scopes at once — declared as their union so the three types
 * cannot drift.
 *
 * @experimental Subject to change until 1.0.0.
 */
export interface RunOptions extends CreateRunnerOptions, RunnerRunOptions {}

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

/** A single resolved project, as surfaced on {@link RstestInstanceContext}. */
export interface RstestProjectSummary {
  /** Project name; `'default'` for the default project. */
  name: string;
  /** Absolute root path of this project. */
  rootPath: string;
  /**
   * Absolute path to this project's own config file. Undefined for an inline
   * project, which is identified by its `rootPath` instead.
   */
  configFilePath?: string;
}

/**
 * Read-only view of the resolved context exposed on the `context` property of
 * {@link RstestInstance}. A stable projection of Rstest's internal
 * context — the resolved config and projects — without the internal run state
 * or the reporter/snapshot managers.
 *
 * @experimental Subject to change until 1.0.0.
 */
export interface RstestInstanceContext {
  /** The Rstest core version. */
  version: string;
  /** Absolute root path resolved from `cwd` and `root`. */
  rootPath: string;
  /**
   * The resolved config Rstest runs with. This is a live reference to the
   * resolved config; treat it as read-only — mutating it is unsupported.
   */
  normalizedConfig: NormalizedConfig;
  /** Resolved projects. */
  projects: RstestProjectSummary[];
  /** Absolute path to the loaded config file, if one was loaded. */
  configFilePath?: string;
}

/**
 * What one {@link RstestRunner.build} produced. Lifecycle belongs to the runner,
 * so there is nothing to release here.
 *
 * @experimental Subject to change until 1.0.0.
 */
export interface RunnerBuildResult {
  /** Absolute paths of the test files compiled into this build. */
  testFiles: string[];
}

/**
 * A reusable runner: compiles a test set once and executes it many times,
 * keeping the Rsbuild dev server and the worker pool alive in between. Created
 * by {@link RstestInstance.createRunner}; the caller owns its lifetime and must
 * {@link RstestRunner.close} it.
 *
 * Semantics that differ from the one-shot {@link RstestInstance.run}:
 *
 * - **Clean runtime per run**: every `run()` starts from a fresh module
 *   registry and fresh test/snapshot/result state, so runs cannot contaminate
 *   each other. This is a contract, not an option.
 * - **`globalSetup` runs once per runner**, not per run, and its teardown runs
 *   in `close()` — so a failing teardown rejects `close()` instead of landing
 *   in the last run's result.
 * - **Runs are serial**: `run()` or `build()` while a run is in flight rejects
 *   instead of queueing.
 * - **The compiled test set is fixed at creation**: source edits made afterwards
 *   are not picked up, and per-run `filters` can only narrow it. Create a new
 *   runner for a new build.
 *
 * @experimental Subject to change until 1.0.0.
 */
export interface RstestRunner {
  /**
   * Same projection as the `context` property of {@link RstestInstance},
   * resolved once at runner creation (it does not change as later runs
   * execute).
   */
  readonly context: RstestInstanceContext;

  /**
   * Compile the test set and start the run resources (Rsbuild dev server +
   * worker pool). The first `run()` does this implicitly; call it explicitly to
   * separate compilation from execution, or to learn the compiled test files
   * before running. Resolves the same build for the runner's lifetime.
   *
   * Rejects on a compile error — the deliberate contrast with `run()`.
   */
  build(): Promise<RunnerBuildResult>;

  /**
   * Execute the built set once, building first if it never was. Resolves a
   * {@link TestRunResult} covering only this run.
   *
   * Never rejects for a failing run: test failures, worker crashes and
   * implicit-build failures are contained in the result (`ok: false`, with the
   * error in `unhandledErrors`) — the same contract as
   * {@link RstestInstance.run}. It does reject on misuse: an overlapping run,
   * or a closed runner.
   */
  run(options?: RunnerRunOptions): Promise<TestRunResult>;

  /**
   * Run `globalSetup` teardown, release the worker pool + dev server, and
   * restore the process globals snapshotted at creation. Waits for an in-flight
   * run (or build) first. Idempotent; the runner cannot be reused afterwards.
   *
   * Rejects when a `globalSetup` teardown failed — the only failure a runner
   * can produce outside a run. Every resource is released either way.
   */
  close(): Promise<void>;
}

/**
 * A programmatic Rstest instance. Created by {@link createRstest}; holds the
 * resolved config identity and runs tests against it per invocation.
 *
 * @experimental Subject to change until 1.0.0.
 */
export interface RstestInstance {
  /** Resolved context for the most recent build (config and projects). */
  readonly context: RstestInstanceContext;

  /** Run tests once with `options`; resolves a structured {@link TestRunResult}. */
  run(options?: RunOptions): Promise<TestRunResult>;

  /**
   * Create a reusable {@link RstestRunner}: compile the selected test set once,
   * then execute it as many times as needed over one dev server + worker pool.
   * `options` are build-scoped; per-execution selection and control go to
   * {@link RstestRunner.run}. The caller owns the runner's lifetime — always
   * `close()` it, or the dev server and pool stay alive.
   *
   * Browser mode is not supported yet: `createRunner()` rejects when the
   * resolved config has any browser-mode project (use `run()`, which builds and
   * tears down per call).
   */
  createRunner(options?: CreateRunnerOptions): Promise<RstestRunner>;

  /**
   * Start a watch session: run the matching tests, then keep re-running them as
   * files change. Accepts the same file-selection options as `run`, plus
   * {@link WatchOptions.onResult} to observe each run. Per-run results surface
   * via the configured reporters and/or `onResult` (not the resolved value);
   * resolves once watching is established. Call {@link RstestWatcher.close} to
   * stop watching. Mirrors the CLI's `--watch`, exposed programmatically here.
   *
   * Browser mode is not supported yet: `watch()` rejects when the resolved
   * config has any browser-mode project (use `run()`, or the CLI `rstest
   * watch`). Browser watch support is planned.
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

  /**
   * Merge on-disk blob reports into a single aggregate report. Resolves the
   * merged {@link TestRunResult} — the aggregate of the sharded runs, the same
   * shape `run()` resolves. `ok` is `false` when the merged blobs contain
   * failed tests or unhandled errors (mirroring the CLI's exit 1); the failing
   * detail is in `stats` / `files`, not thrown.
   *
   * Rejects only when the merge operation itself cannot be performed (missing
   * blob directory, no blob files, corrupt blob JSON), with the original core
   * error — in that case there is no aggregate to return. This is the
   * intentional contrast with `run()` (which never rejects): `run()` owns a
   * test execution and contains every failure in its result, whereas
   * `mergeReports` is an aggregation utility with a clean "couldn't do it at
   * all" failure mode.
   */
  mergeReports(options?: {
    path?: string;
    cleanup?: boolean;
  }): Promise<TestRunResult>;
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

const BROWSER_RUNNER_UNSUPPORTED =
  'The programmatic createRunner() does not support browser mode yet. ' +
  'Run browser-mode tests with run(), or use the CLI `rstest run`.';

/**
 * Execute one run against an already-resolved context and assemble its
 * {@link TestRunResult}: start from a clean exit code, capture the run summary
 * through a temporary reporter, contain every error as an `unhandledError`
 * (with `ok: false`) instead of throwing, and read the per-file results back
 * from the context.
 *
 * Everything here is run-scoped, because one runner context serves many runs:
 * the capture reporter is removed again, and the results are read in `finally`
 * so a failure in a post-run step doesn't discard results already gathered.
 * Process globals are guarded around the runner's whole lifetime instead.
 */
const executeHostSafeCycle = async (
  context: RstestContext,
  runCycle: () => Promise<void>,
  passWithNoTests?: boolean,
): Promise<TestRunResult> => {
  // Start from a clean exit code (like the CLI) so `ok` reflects only failures
  // this run produced — not a non-zero code an earlier run or the embedding
  // host set. The runner's guard restores the host's value at `close()`.
  process.exitCode = undefined;
  const captured = createCapturedRunState();
  const captureReporter = createCaptureReporter(captured);
  const { reporters } = context;
  reporters.push(captureReporter);
  let files: TestFileResult[] = [];

  try {
    await runCycle();
  } catch (err) {
    captured.unhandledErrors.unshift(toSerializedError(err));
  } finally {
    files = context.reporterResults.results.map(toPublicTestFileResult);
    // Observe the run's final exit code before the guard restores it, so `ok`
    // reflects exit-code-only failures (coverage thresholds).
    captured.exitCode = process.exitCode;
    reporters.splice(reporters.indexOf(captureReporter), 1);
  }

  return assembleTestRunResult(files, captured, context, passWithNoTests);
};

/**
 * Create a programmatic Rstest instance. The static `config` is the instance's
 * identity, but it is **re-resolved on every** `run()` / `listTests()` /
 * `mergeReports()` (and once eagerly at creation), so no mutable state is
 * shared across runs and the `context` property of {@link RstestInstance}
 * reflects the most recent build rather than a creation-time snapshot. Each call performs a full build → execute → teardown.
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

  // Holds the most recent build's context projection, exposed via
  // `instance.context`.
  let context!: RstestInstanceContext;

  // Resolve config + projects from the static inputs and build an internal
  // runner for `command`, applying the per-invocation `runOptions`. Re-runs the
  // full resolution each call so no mutable state is shared across runs.
  const build = async (
    command: RstestCommand,
    runOptions: RunOptions,
    prepareOptions?: (options: CommonOptions) => void,
  ): Promise<ResolvedRstest> => {
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

    // `loadConfig` (via rsbuild's) stamps the resolved config file path onto the
    // config as `_privateMeta.configFilePath`, and it survives the merge/spread
    // in a `config` factory. Read it here — mirroring rsbuild's own cache plugin
    // — so a factory that returns the loaded config tracks the file for free
    // (buildCache dependency + the watch set) without a separate option; a fully
    // inline config simply has no path to track.
    const configFilePath = (
      userConfig as { _privateMeta?: { configFilePath?: string } }
    )._privateMeta?.configFilePath;

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
      configFilePath,
      projects,
      command,
      options: commonOptions,
      filters: runOptions.filters ?? [],
      cwd,
      embedded: true,
      trace,
      filterMode: runOptions.filterMode,
    });

    // Expose a real plain projection of the internal context, not the live
    // `Rstest` engine object narrowed by a type. The internal context reaches
    // the reporter/snapshot/state managers and mutable run state; returning it
    // would let untyped callers mutate live internals and make
    // `structuredClone(instance.context)` throw on the reporter functions. Copy
    // only the documented public fields. `normalizedConfig` stays a live
    // reference to the resolved config (documented read-only; see the JSDoc on
    // RstestInstanceContext).
    const internal = runner.context;
    context = {
      version: internal.version,
      rootPath: internal.rootPath,
      normalizedConfig: internal.normalizedConfig,
      projects: internal.projects.map((project) => ({
        name: project.name,
        rootPath: project.rootPath,
        configFilePath: project.configFilePath,
      })),
      configFilePath: internal.configFilePath,
    };
    return runner;
  };

  // Resolve up front so `context` is available for inspection and config-load
  // errors surface at creation time rather than on first run. Snapshot and
  // restore process globals around this eager build so merely creating an
  // instance never leaves the host in test mode or with a mutated exit code.
  // Build with the `list` command: it resolves the full config/projects but
  // constructs no reporter instances (see `createReporters` gating), so the
  // default reporter's TTY renderer + `process.on('exit')` handler — installed
  // at construction time — are never incurred by a host that only inspects
  // `context`. Crucially, unlike forcing `reporters: []`, this leaves the
  // resolved `normalizedConfig.reporters` (and per-project reporter config)
  // intact, so config inspection sees the real reporters. `run()`/`watch()`
  // rebuild with the real command + reporters.
  const restoreCreation = snapshotProcessGuards();
  try {
    await build('list', {});
  } finally {
    restoreCreation();
  }

  /**
   * The single runner factory behind both `createRunner()` and the one-shot
   * `run()`. `oneShot` marks the `run()` path, which owns the runner's whole
   * lifetime and keeps two behaviors that predate the runner and are locked by
   * the programmatic e2e suite:
   *
   * - browser-mode projects are accepted — the reusable driver is node-only
   *   (it would plan browser projects but never execute them), so they are
   *   backed by the one-shot orchestrator instead;
   * - teardown runs as part of the run, so a failing `globalSetup` teardown
   *   still lands in that run's result instead of after it.
   */
  const createRunnerInstance = async (
    runnerOptions: RunOptions,
    { oneShot }: { oneShot: boolean },
  ): Promise<RstestRunner> => {
    // Held for the runner's whole lifetime, exactly like `watch()`: the dev
    // server and workers stay alive between runs, so `env` must remain in test
    // mode until `close()` puts the host snapshot back.
    const restoreProcessGuards = snapshotProcessGuards();
    try {
      const resolved = await build('run', runnerOptions);
      // The instance-level `context` projection is rebuilt by every later
      // build; this runner's stays the one it was created with.
      const runnerContext = context;

      const hasBrowserProject = resolved.context.projects.some(
        (project) => project.normalizedConfig.browser.enabled,
      );
      if (hasBrowserProject && !oneShot) {
        throw new Error(BROWSER_RUNNER_UNSUPPORTED);
      }

      const driver: CoreTestRunner = hasBrowserProject
        ? {
            // Unreachable from the public surface (`createRunner()` rejected
            // above), and the one-shot orchestrator has no separable compile
            // step to expose anyway.
            build: () => Promise.reject(new Error(BROWSER_RUNNER_UNSUPPORTED)),
            runCycle: async () => {
              await resolved.runTests();
            },
            close: () => Promise.resolve(),
          }
        : await resolved.createTestRunner();

      let inFlightRun: Promise<TestRunResult> | undefined;
      let closePromise: Promise<void> | undefined;

      const assertOpen = (): void => {
        if (closePromise) {
          throw new Error('The test runner is closed.');
        }
      };

      return {
        context: runnerContext,
        build: async () => {
          assertOpen();
          return driver.build();
        },
        run: async (cycleOptions = {}) => {
          // Misuse rejects instead of resolving a failed result: a closed or
          // busy runner is a caller bug, not an outcome of executing tests.
          assertOpen();
          if (inFlightRun) {
            throw new Error(
              'A test run is already in progress; runs on one runner are serial.',
            );
          }
          const pending = executeHostSafeCycle(
            resolved.context,
            oneShot
              ? async () => {
                  try {
                    await driver.runCycle(cycleOptions);
                  } catch (error) {
                    // Teardown still has to run, but the cycle's failure is the
                    // one to report — `close()` can reject on its own now.
                    await driver.close().catch(() => undefined);
                    throw error;
                  }
                  await driver.close();
                }
              : () => driver.runCycle(cycleOptions),
            cycleOptions.passWithNoTests,
          );
          // Never rejects, so `close()` can await it directly.
          inFlightRun = pending;
          try {
            return await pending;
          } finally {
            inFlightRun = undefined;
          }
        },
        close: () => {
          closePromise ??= (async () => {
            await inFlightRun;
            try {
              await driver.close();
            } finally {
              restoreProcessGuards();
            }
          })();
          return closePromise;
        },
      };
    } catch (err) {
      // Creation failed before a runner existed, so its `close()` will never
      // run — restore the host snapshot here instead of leaking it.
      restoreProcessGuards();
      throw err;
    }
  };

  const createRunner = (
    runnerOptions: CreateRunnerOptions = {},
  ): Promise<RstestRunner> =>
    createRunnerInstance(runnerOptions, { oneShot: false });

  const run = async (runOptions: RunOptions = {}): Promise<TestRunResult> => {
    let runner: RstestRunner | undefined;
    try {
      runner = await createRunnerInstance(runOptions, { oneShot: true });
      // Build scope already absorbed every option (`toCommonOptions` stamps the
      // run-scoped ones onto the config too); re-stating them keeps the sugar
      // faithful if the two scopes ever diverge. `filters` is deliberately not
      // forwarded: at build scope it may be a `related` source-file list, which
      // would match no compiled test file as a run-scoped filter.
      const { testNamePattern, update, bail, passWithNoTests } = runOptions;
      return await runner.run({
        testNamePattern,
        update,
        bail,
        passWithNoTests,
      });
    } catch (err) {
      // Only reachable when the runner could not be created (config load,
      // project resolution) — `runner.run()` contains its own failures. `run()`
      // never rejects, so report it as an unhandled error instead.
      const captured = createCapturedRunState();
      captured.unhandledErrors.push(toSerializedError(err));
      return assembleTestRunResult([], captured, undefined);
    } finally {
      // Teardown already ran inside the run (see `oneShot`) and any failure of
      // it is in the result; this only releases the process guards.
      await runner?.close().catch(() => undefined);
    }
  };

  const watch = async (
    watchOptions: WatchOptions & RunOptions = {},
  ): Promise<RstestWatcher> => {
    const { onResult, ...runOptions } = watchOptions;
    // Contain `process.exitCode` around the watch session so a failing run
    // doesn't leave the embedding host marked as failed; the dev server keeps
    // running after `runTests()` resolves, so restore only when the returned
    // watcher's `close()` is called. `env` stays test-mode until then — which is
    // what re-run workers need — and is put back by the same `restore()` inside
    // that `close()`.
    const restore = snapshotProcessGuards();
    try {
      const runner = await build('watch', runOptions);
      // Browser-mode watch is not wired up for the programmatic API yet: the
      // node watch path returns a close handle, but the browser watch session
      // (Playwright browser, WebSocket server, Rsbuild dev server) has no
      // teardown here, so a returned watcher would be a dead handle leaking
      // those resources. Fail fast pre-run (before `runTests()` starts the dev
      // server / pool) instead of leaking; full support is tracked by the
      // browser-executor unification RFC. Throwing here is safe — the `catch`
      // below restores the host snapshot and re-throws.
      const hasBrowserProject = runner.context.projects.some(
        (project) => project.normalizedConfig.browser.enabled,
      );
      if (hasBrowserProject) {
        throw new Error(
          'The programmatic watch() does not support browser mode yet. ' +
            'Run browser-mode tests with run(), or use the CLI `rstest watch`.',
        );
      }
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
      // Listing never executes, so drop execution-only `RunOptions` fields
      // before building the list runner (see the `listTests` contract above).
      // `shard` in particular would otherwise reach `normalizedConfig.shard`
      // and make the runner return only one shard of the collected files; a
      // caller reusing run options must still see the full listing.
      const { shard, update, bail, ...listBuildOptions } = listOptions;
      const runner = await build('list', listBuildOptions, (opts) => {
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
  }): Promise<TestRunResult> => {
    const restore = snapshotProcessGuards();
    // Start from a clean exit code (like the CLI) so `ok` reflects only this
    // merge's failing blobs, not a non-zero code the embedding host set earlier.
    // The guard restores the host's original value afterwards.
    process.exitCode = undefined;
    const captured = createCapturedRunState();
    try {
      const runner = await build('merge-reports', {});
      // Core merge does not populate `context.reporterResults`, so capture the
      // per-file results directly from the `onTestRunEnd` broadcast.
      runner.context.reporters.push(
        createCaptureReporter(captured, { captureFiles: true }),
      );
      // Operational failures (missing/empty blob dir, corrupt blob JSON) throw
      // in core `loadBlobFiles` and propagate as this promise's rejection — the
      // merge produced no aggregate to hand back.
      await runner.mergeReports(mergeOptions);
      // Core signals failing merged blobs only via `process.exitCode = 1`; fold
      // it into `ok` like `run()` does (the guard restores the host value).
      captured.exitCode = process.exitCode;
      return assembleTestRunResult(
        captured.files ?? [],
        captured,
        runner.context,
      );
    } finally {
      restore();
    }
  };

  return {
    get context() {
      return context;
    },
    run,
    createRunner,
    watch,
    listTests,
    mergeReports,
  };
}
