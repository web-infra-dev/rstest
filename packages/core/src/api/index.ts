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
import { loadConfig, mergeRstestConfig, resolveExtends } from '../config';
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
 * Function form of {@link CreateRstestOptions.config}: receives the config
 * loaded from `configFile` (an empty object when none is set) and returns the
 * final config to run with. Letting you transform the disk config directly
 * rather than deep-merging an override object over it.
 *
 * @experimental Subject to change until 1.0.0.
 */
export type RstestConfigFn = (
  loadedConfig: RstestConfig,
) => RstestConfig | Promise<RstestConfig>;

/**
 * Options for {@link createRstest}. Construction carries only the static
 * config + host wiring; per-invocation selection/control lives in
 * {@link RunOptions}.
 *
 * @experimental Subject to change until 1.0.0.
 */
export interface CreateRstestOptions {
  /** Working directory. Defaults to `process.cwd()`. Base for resolving `root`. */
  cwd?: string;

  /**
   * Path to a config file. Unlike the CLI, the programmatic API does NOT
   * auto-discover a config file from `cwd` — pass an explicit path or omit to
   * run with `config` only.
   */
  configFile?: string;

  /**
   * Inline configuration applied on top of `configFile` (or used alone). The
   * single override channel for all config content — including `projects` and
   * `reporters`.
   *
   * - **Object**: deep-merged over the disk config (inline wins for scalars;
   *   arrays follow `mergeRstestConfig` semantics).
   * - **Function**: receives the disk-loaded config (an empty object when no
   *   `configFile` is set) and returns the final config, letting you mutate or
   *   replace it directly instead of merging. Mirrors rsbuild's
   *   `createRsbuild({ config })` factory, but the callback is handed the
   *   resolved disk config so it can transform it.
   */
  config?: RstestConfig | RstestConfigFn;

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
 * Parsed CLI flag bag accepted by {@link runCli} — mirrors what a parsed
 * `rstest <args>` produces: named flags plus positional files in `_`. This is
 * the full, undifferentiated CLI option surface (analogous to jest's
 * `Config.Argv`), as opposed to {@link RunOptions}'s curated per-run subset.
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
   * Collect matching test files / cases without executing. Accepts the same
   * file-selection options as `run` plus list-specific flags; execution-only
   * {@link RunOptions} fields (`update`, `bail`, `shard`) are ignored here.
   */
  listTests(
    options?: ListCommandOptions & RunOptions,
  ): Promise<ListCommandResult[]>;

  /** Merge on-disk blob reports into a single aggregate report. */
  mergeReports(options?: { path?: string; cleanup?: boolean }): Promise<void>;

  /** Release instance resources. No-op on the 1.0 happy path (each run self-cleans). */
  close(): Promise<void>;
}

/** Resolve an optional caller-supplied cwd against the current process cwd. */
const resolveCwd = (cwd?: string): string =>
  cwd ? getAbsolutePath(process.cwd(), cwd) : process.cwd();

const loadConfigForApi = async ({
  cwd,
  configFile,
  config,
}: {
  cwd: string;
  configFile?: string;
  config?: RstestConfig | RstestConfigFn;
}): Promise<{ content: RstestConfig; filePath?: string }> => {
  let diskContent: RstestConfig = {};
  let filePath: string | undefined;

  if (configFile) {
    const loaded = await loadConfig({ cwd, path: configFile });
    diskContent = loaded.content;
    filePath = loaded.filePath ?? undefined;
  }

  // `resolveExtends` is a no-op when a config has no `extends`, so both branches
  // call it unconditionally.

  // Function form: hand the resolved disk config to the caller and use whatever
  // they return as the final config (no auto-merge — they own the result).
  if (typeof config === 'function') {
    const content = await resolveExtends(await config(diskContent));
    return { content, filePath };
  }

  // Object form. `loadConfig` already resolved `extends` on disk content;
  // resolve inline extends *before* merging so the merged result doesn't carry
  // both copies (which would double-apply disk extends if re-run afterwards).
  const resolvedInline = await resolveExtends(config ?? {});
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
 * Run a freshly-built runner host-safely and assemble a {@link TestRunResult}:
 * snapshot/restore process globals so the embedding host isn't left with leaked
 * `exitCode`/`env` state, and contain any build/run error as an `unhandledError`
 * (with `ok: false`) instead of throwing or exiting. Shared by
 * {@link createRstest}'s `run` and the standalone {@link runCli} entry.
 *
 * `buildRunner` runs inside the guarded `try` so config/build errors are
 * captured too; results are read in `finally` so a failure in a post-run step
 * doesn't discard results already gathered during the run.
 */
const executeHostSafeRun = async (
  buildRunner: () => Promise<RstestRunner>,
): Promise<TestRunResult> => {
  const restoreProcessGuards = snapshotProcessGuards();
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
    restoreProcessGuards();
  }

  return assembleTestRunResult(files, captured, runner?.context);
};

/**
 * Create a programmatic Rstest instance. The static inputs (`configFile` +
 * inline `config`) are the instance's identity, but the config is
 * **re-resolved on every** `run()` / `listTests()` / `mergeReports()` (and once
 * eagerly at creation), so no mutable state is shared across runs and
 * {@link RstestInstance.context} reflects the most recent build rather than a
 * creation-time snapshot. Each call performs a full build → execute → teardown.
 *
 * Resolves config-load errors at creation time. `run()` resolves on every
 * termination path — including worker crashes — with `ok` reflecting success.
 * Watch mode is intentionally CLI-only and has no programmatic entry here.
 *
 * @experimental Subject to change until 1.0.0.
 */
export async function createRstest(
  options: CreateRstestOptions = {},
): Promise<RstestInstance> {
  // Match the CLI's environment setup so workers (spawned per run) observe
  // `NODE_ENV=test` / `RSTEST=true`.
  initRstestEnv();

  const cwd = resolveCwd(options.cwd);
  const embedded = options.embedded ?? true;
  const trace = options.trace ?? false;

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
        configFile: options.configFile,
        config: options.config,
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

    const runner = await buildResolvedRunner({
      createRstest: createRstestContext,
      config: userConfig,
      configFilePath,
      projects,
      command,
      options: commonOptions,
      filters: runOptions.filters ?? [],
      cwd,
      embedded,
      trace,
      filterMode: runOptions.filterMode,
    });

    context = runner.context;
    return runner;
  };

  // Resolve up front so `context` is available for inspection and config-load
  // errors surface at creation time rather than on first run.
  await build('run', {});

  const run = (runOptions: RunOptions = {}): Promise<TestRunResult> =>
    executeHostSafeRun(() => build('run', runOptions));

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

  const close = async (): Promise<void> => {
    // Each run() builds and tears down its own worker pool + Rsbuild server, so
    // there are no instance-held resources to release in 1.0.
  };

  return {
    get context() {
      return context;
    },
    run,
    listTests,
    mergeReports,
    close,
  };
}

/**
 * Run Rstest once from a parsed CLI flag bag — the jest-compatible programmatic
 * entry, analogous to `@jest/core`'s `runCLI(argv, projects)`. It accepts the
 * full, undifferentiated CLI option bag ({@link RstestArgv}: named flags plus
 * positional files in `argv._`) and resolves to a structured
 * {@link TestRunResult}.
 *
 * Unlike {@link createRstest}, this mirrors the `rstest run` CLI command:
 * it auto-discovers the config file from `cwd` and applies CLI defaults. It is
 * host-safe (never calls `process.exit`) and one-shot — for repeated runs,
 * config inspection, listing, or report merging, use {@link createRstest}.
 * Watch mode is intentionally CLI-only and has no programmatic entry here.
 *
 * @experimental Subject to change until 1.0.0.
 */
export async function runCli(
  argv: RstestArgv = {},
  options: { cwd?: string } = {},
): Promise<TestRunResult> {
  // Match the CLI's environment setup so workers (spawned per run) observe
  // `NODE_ENV=test` / `RSTEST=true`.
  initRstestEnv();

  const cwd = resolveCwd(options.cwd);
  const { _: positionals, ...commonOptions } = argv;
  const filters = positionals ?? [];

  return executeHostSafeRun(async () => {
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
