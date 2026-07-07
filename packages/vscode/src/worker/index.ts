import { pathToFileURL } from 'node:url';
import type { RstestInstance, RstestWatcher } from '@rstest/core/api';
import { createBirpc } from 'birpc';
import type { TestRunReporter } from '../testRunReporter';
import type { WorkerInitOptions } from '../types';
import { logger } from './logger';
import { CoverageReporter, ProgressLogger, ProgressReporter } from './reporter';

// Rstest applies these default coverage reporters only when `coverage.reporters`
// is left undefined (see the `@rstest/core` coverage `reporters` @default). The
// function form below sets `reporters` explicitly, which would otherwise drop
// those defaults, so mirror them here — a workspace that never configured
// reporters still gets the normal reports alongside the extension reporter.
// Mirror of the coverage.reporters default in packages/core/src/config.ts (the
// worker loads the workspace's core, so it can't import the constant) — keep in
// sync.
const DEFAULT_COVERAGE_REPORTERS = ['text', 'html', 'clover', 'json'] as const;

export class Worker {
  /** Active watch session for a continuous run, if any. */
  private watcher?: RstestWatcher;

  /**
   * Instances cached by init-identity (config file + core path + override
   * config), so repeated `runTest` / `listTests` / `getNormalizedConfig` RPCs
   * on the same target reuse one instance instead of re-running `loadConfig`
   * (TS config compile) + `resolveProjects` (glob walk) on every call. Per-call
   * `run()` re-resolves config from disk, so a cached instance stays fresh.
   */
  private instances = new Map<string, Promise<RstestInstance>>();

  private init(options: WorkerInitOptions): Promise<RstestInstance> {
    // Key on everything except the per-invocation `fileFilters`/`command`,
    // which don't affect the instance's identity (they're applied per
    // `run()`/`listTests()`).
    const {
      fileFilters: _fileFilters,
      command: _command,
      ...identity
    } = options;
    const key = JSON.stringify(identity);
    let instance = this.instances.get(key);
    if (!instance) {
      instance = this.createInstance(options);
      this.instances.set(key, instance);
      // Drop a failed creation so the next RPC retries instead of caching the
      // rejected promise.
      instance.catch(() => this.instances.delete(key));
    }
    return instance;
  }

  private async createInstance({
    configFilePath,
    // `fileFilters`/`command` are per-invocation concerns handled by
    // `run()`/`listTests()`; destructure them out so they don't leak into the
    // inline config. The rest is `RstestConfig`-shaped override content.
    fileFilters: _fileFilters,
    rstestPath,
    command: _command,
    ...overrideConfig
  }: WorkerInitOptions): Promise<RstestInstance> {
    // Load the programmatic API from the resolved core package (sibling of the
    // main entry under `dist/api/index.js`), plus the main `@rstest/core` entry
    // where `loadConfig` lives (the programmatic API no longer reads a config
    // file itself, so we load it and hand it to `config`). The two imports are
    // independent — load them concurrently.
    const rstestApiUrl = new URL('./api/index.js', pathToFileURL(rstestPath))
      .href;
    const [rstestApi, rstestMain] = await Promise.all([
      import(rstestApiUrl) as Promise<typeof import('@rstest/core/api')>,
      import(pathToFileURL(rstestPath).href) as Promise<
        typeof import('@rstest/core')
      >,
    ]);
    logger.debug('Loaded Rstest API module');
    const { createRstest } = rstestApi;
    const { loadConfig } = rstestMain;

    const coverageEnabled = !!overrideConfig.coverage?.enabled;
    const { coverage: coverageOverride, ...restOverride } = overrideConfig;

    const rstest = await createRstest({
      // The programmatic API doesn't read a config file itself, so this factory
      // loads the resolved disk config and hands it to us. Use the function form
      // so the extension's coverage reporter is *appended* to the user's
      // configured `coverage.reporters` (lcov/html/…) rather than replacing
      // them — returning a plain override object would drop whatever the
      // workspace configured.
      config: async () => {
        const { content: loaded } = await loadConfig({ path: configFilePath });
        // `coverage` is pulled out of the overrides above and handled explicitly
        // so a `coverage: undefined` override can't wipe the disk coverage
        // config, and so the extension's reporter is appended to (not replacing)
        // the user's configured coverage reporters.
        // Distinguish "never configured" (undefined → Rstest's defaults) from
        // an explicit empty array (suppress all report files). `??`-merging
        // mirrors core, which keeps an explicit `[]` and only falls back to the
        // defaults for an undefined `reporters`.
        const hasConfiguredReporters =
          loaded.coverage?.reporters !== undefined ||
          coverageOverride?.reporters !== undefined;
        const configuredReporters = [
          ...(loaded.coverage?.reporters ?? []),
          ...(coverageOverride?.reporters ?? []),
        ];
        const coverage = coverageEnabled
          ? {
              ...loaded.coverage,
              ...coverageOverride,
              // The coverage report runs per `run()`, so the reporter must be
              // part of the resolved config rather than pushed after
              // construction. When the workspace never configured reporters,
              // keep Rstest's defaults — they are only auto-applied for an
              // undefined `reporters`, which setting this explicitly (including
              // an empty array to suppress reports) would otherwise drop.
              reporters: [
                ...(hasConfiguredReporters
                  ? configuredReporters
                  : DEFAULT_COVERAGE_REPORTERS),
                new CoverageReporter(),
              ],
            }
          : coverageOverride
            ? { ...loaded.coverage, ...coverageOverride }
            : loaded.coverage;

        // Shallow-merge the per-invocation overrides over the disk config; the
        // worker drives the run over RPC, so force its own top-level reporters.
        return {
          ...loaded,
          ...restOverride,
          reporters: [
            // place default reporter first to ensure output is flushed
            ['default', { logger: new ProgressLogger() }],
            new ProgressReporter(),
          ],
          coverage,
        };
      },
    });

    return rstest;
  }

  public async getNormalizedConfig(options: WorkerInitOptions) {
    const { context } = await this.init(options);
    return {
      root: context.normalizedConfig.root,
      include: context.normalizedConfig.include,
      exclude: context.normalizedConfig.exclude.patterns,
      // Sub-projects this config aggregates via `projects`. Empty for a leaf
      // config. The extension uses these to avoid registering a child config
      // as its own top-level project when a parent already covers it
      // (otherwise the same test files show up twice). A file-based child is
      // identified by its config file; inline children only have a root.
      // `null` (not `undefined`) so the fields survive the IPC JSON round-trip.
      childProjects: context.projects
        // A config that declares no `projects` still resolves to a single
        // synthetic project standing for the config itself — drop it so a leaf
        // config reports no children.
        .filter(
          (project) =>
            project.configFilePath !== context.configFilePath ||
            project.rootPath !== context.rootPath,
        )
        .map((project) => ({
          configFilePath: project.configFilePath ?? null,
          root: project.rootPath ?? null,
        })),
    };
  }

  public async runTest(data: WorkerInitOptions) {
    logger.debug('Received runTest request', JSON.stringify(data, null, 2));
    try {
      const rstest = await this.init(data);

      if (data.command === 'watch') {
        // Continuous run: keep the worker process alive, re-running tests on
        // file changes. Per-run results reach the extension via the
        // `ProgressReporter`. Store the watcher so the master can release its
        // pool / dev server / globalSetup resources via `closeWatch()` before
        // the worker process is killed.
        this.watcher = await rstest.watch({ filters: data.fileFilters });
        logger.debug('Watch mode started');
        return;
      }

      const res = await rstest.run({ filters: data.fileFilters });
      logger.debug('Test run completed', { result: res });
      // `run()` resolves (never throws) even on run-level failures such as an
      // Rsbuild build error or a worker crash, surfacing them as
      // `unhandledErrors`. The extension only ends a run from reporter
      // `onTestRunEnd` or this RPC `catch`, so forward these here — otherwise a
      // failure that aborts before reporters are notified leaves the UI hanging.
      if (res.unhandledErrors.length > 0) {
        throw new Error(
          res.unhandledErrors
            .map((err) => err.stack ?? `${err.name}: ${err.message}`)
            .join('\n\n'),
        );
      }
    } catch (error) {
      logger.error('Test run failed', error);
      throw error;
    }
  }

  public async listTests(data: WorkerInitOptions) {
    const rstest = await this.init(data);
    const res = await rstest.listTests({ filters: data.fileFilters });
    return res;
  }

  /**
   * Stop an active watch session and release its worker pool / dev server /
   * globalSetup resources. Idempotent: a no-op when no watch session is active.
   * Invoked both by the master's `closeWatch()` RPC (the fast, awaited graceful
   * path) and by this process's own termination-signal handler below.
   */
  public async closeWatch(): Promise<void> {
    const watcher = this.watcher;
    this.watcher = undefined;
    await watcher?.close();
  }
}

const worker = new Worker();

export const masterApi = createBirpc<TestRunReporter, Worker>(worker, {
  post: (data) => process.send?.(data),
  on: (fn) => process.on('message', fn),
  bind: 'functions',
});

// The master stops a continuous run by killing this worker process. The embedded
// core API installs no signal handlers (the host owns the process), so install
// one here in the worker wrapper: on termination, release any active watch
// session's pool / dev server before exiting. This is the robust floor covering
// every kill path — including the master's synchronous `dispose()` hard kill,
// which can't await the `closeWatch()` RPC — not just the graceful RPC path.
// `closeWatch()` is idempotent, so the master calling it first then killing is
// safe (the handler's call becomes a no-op). POSIX-only: on Windows `kill()`
// terminates without delivering a signal, so the RPC path remains the primary
// graceful route there.
let shuttingDown = false;
const gracefulShutdown = (): void => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  // Never let a stalled teardown wedge the process: force-exit as a backstop.
  const force = setTimeout(() => process.exit(0), 5000);
  force.unref();
  void worker
    .closeWatch()
    .catch(() => {})
    .finally(() => process.exit(0));
};
process.once('SIGTERM', gracefulShutdown);
process.once('SIGINT', gracefulShutdown);
