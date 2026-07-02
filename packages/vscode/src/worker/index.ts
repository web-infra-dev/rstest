import { pathToFileURL } from 'node:url';
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
const DEFAULT_COVERAGE_REPORTERS = ['text', 'html', 'clover', 'json'] as const;

export class Worker {
  private async init({
    configFilePath,
    // `fileFilters`/`command` are per-invocation concerns handled by
    // `run()`/`listTests()`; destructure them out so they don't leak into the
    // inline config. The rest is `RstestConfig`-shaped override content.
    fileFilters: _fileFilters,
    rstestPath,
    command: _command,
    ...overrideConfig
  }: WorkerInitOptions) {
    // Load the programmatic API from the resolved core package (sibling of the
    // main entry under `dist/api/index.js`).
    const rstestApiUrl = new URL('./api/index.js', pathToFileURL(rstestPath))
      .href;
    const rstestApi = (await import(
      rstestApiUrl
    )) as typeof import('@rstest/core/api');
    // `loadConfig` lives on the main `@rstest/core` entry — the programmatic API
    // no longer reads a config file itself, so we load it and hand it to `config`.
    const rstestMain = (await import(
      pathToFileURL(rstestPath).href
    )) as typeof import('@rstest/core');
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
              // construction. When the workspace configured no reporters, keep
              // Rstest's defaults — they are only auto-applied for an undefined
              // `reporters`, which setting this explicitly would otherwise
              // suppress.
              reporters: [
                ...(configuredReporters.length
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
    const rstest = await this.init(options);
    return {
      root: rstest.context.normalizedConfig.root,
      include: rstest.context.normalizedConfig.include,
      exclude: rstest.context.normalizedConfig.exclude.patterns,
    };
  }

  public async runTest(data: WorkerInitOptions) {
    logger.debug('Received runTest request', JSON.stringify(data, null, 2));
    try {
      const rstest = await this.init(data);

      if (data.command === 'watch') {
        // Continuous run: keep the worker process alive, re-running tests on
        // file changes. Per-run results reach the extension via the
        // `ProgressReporter`; the master stops watching by closing (killing)
        // the worker process.
        await rstest.watch({ filters: data.fileFilters });
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
}

export const masterApi = createBirpc<TestRunReporter, Worker>(new Worker(), {
  post: (data) => process.send?.(data),
  on: (fn) => process.on('message', fn),
  bind: 'functions',
});
