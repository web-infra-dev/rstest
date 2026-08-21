import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBirpc } from 'birpc';
import type { TestRunReporter } from '../testRunReporter';
import type { WorkerInitOptions } from '../types';
import { logger } from './logger';
import { CoverageReporter, ProgressLogger, ProgressReporter } from './reporter';

type ActiveWatcher = {
  close(): Promise<void>;
};

// fix ESM import path issue on windows
// Only URLs with a scheme in: file, data, and node are supported by the default ESM loader.
const normalizeImportPath = (path: string) => {
  return pathToFileURL(path).toString();
};

export class Worker {
  private watcher?: ActiveWatcher;
  private watcherClosePromise?: Promise<void>;
  private watcherStartupPromise?: Promise<ActiveWatcher>;

  private async init({
    configFilePath,
    fileFilters,
    rstestPath,
    command = 'run',
    ...overrideConfig
  }: WorkerInitOptions) {
    const coreModule = (await import(
      normalizeImportPath(rstestPath)
    )) as typeof import('@rstest/core');
    const apiModule = (await import(
      normalizeImportPath(resolve(dirname(rstestPath), 'api/index.js'))
    )) as typeof import('@rstest/core/api');
    logger.debug('Loaded Rstest module');
    const { loadConfig, mergeRstestConfig } = coreModule;
    const { createRstest } = apiModule;

    const rstest = await createRstest({
      cwd: process.cwd(),
      config: async () => {
        const loaded = await loadConfig({
          cwd: process.cwd(),
          path: configFilePath,
        });
        return mergeRstestConfig(loaded.content, {
          ...overrideConfig,
          reporters: [
            ['default', { logger: new ProgressLogger() }],
            new ProgressReporter(),
          ],
          coverage: {
            ...loaded.content.coverage,
            ...overrideConfig.coverage,
          },
        });
      },
    });

    return { rstest, fileFilters, command };
  }

  public async getNormalizedConfig(options: WorkerInitOptions) {
    const { rstest } = await this.init(options);
    const { config } = rstest.context;
    return {
      root: rstest.context.root,
      include: config.include ?? [],
      exclude: Array.isArray(config.exclude)
        ? config.exclude
        : (config.exclude?.patterns ?? []),
      // Sub-projects this config aggregates via `projects`. Empty for a leaf
      // config. The extension uses these to avoid registering a child config
      // as its own top-level project when a parent already covers it
      // (otherwise the same test files show up twice). A file-based child is
      // identified by its config file; inline children only have a root.
      // `null` (not `undefined`) so the fields survive the IPC JSON round-trip.
      childProjects: rstest.context.projects.map((project) => ({
        configFilePath: project.configFilePath ?? null,
        root: project.root,
      })),
    };
  }

  public async runTest(data: WorkerInitOptions) {
    logger.debug('Received runTest request', JSON.stringify(data, null, 2));
    try {
      const { rstest, fileFilters, command } = await this.init({
        ...data,
        coverage: data.coverage?.enabled
          ? {
              ...data.coverage,
              reporters: [new CoverageReporter()],
            }
          : data.coverage,
      });
      const runOptions = {
        filters: fileFilters,
        filterMode: fileFilters ? 'exact' : undefined,
      } satisfies NonNullable<Parameters<typeof rstest.run>[0]>;
      // TODO: Browser and mixed continuous runs intentionally fail through the
      // public watch() guard until browser watch support lands in RFC PR4. Keep
      // this path on the public API instead of restoring an internal bypass.
      if (command === 'watch') {
        const watcherStartupPromise = rstest.watch(runOptions);
        this.watcherStartupPromise = watcherStartupPromise;
        try {
          const watcher = await watcherStartupPromise;
          this.watcherClosePromise = undefined;
          this.watcher = watcher;
          logger.debug('Test run completed', { result: this.watcher });
          return;
        } finally {
          if (this.watcherStartupPromise === watcherStartupPromise) {
            this.watcherStartupPromise = undefined;
          }
        }
      }

      const result = await rstest.run(runOptions);
      if (result.unhandledErrors.length > 0) {
        throw new Error(
          result.unhandledErrors.map((error) => error.message).join('\n\n'),
        );
      }
      if (
        !result.ok &&
        result.unhandledErrors.length === 0 &&
        result.stats.tests.failed === 0 &&
        result.stats.files.failed === 0
      ) {
        throw new Error(
          'Rstest run failed without test-level failures. Check for operation-level failures such as coverage report errors or unmet coverage thresholds.',
        );
      }
      logger.debug('Test run completed', { result });
    } catch (error) {
      logger.error('Test run failed', error);
      throw error;
    }
  }

  public async closeWatcher(): Promise<void> {
    let watcher = this.watcher;
    if (!watcher && this.watcherStartupPromise) {
      try {
        watcher = await this.watcherStartupPromise;
      } catch {
        return;
      }
    }
    if (!watcher) {
      return;
    }

    this.watcherClosePromise ??= watcher.close().finally(() => {
      this.watcher = undefined;
    });
    await this.watcherClosePromise;
  }

  public async listTests(data: WorkerInitOptions) {
    const { rstest, fileFilters } = await this.init({
      ...data,
      command: 'list',
    });
    const res = await rstest.listTests({
      filters: fileFilters,
      filterMode: fileFilters ? 'exact' : undefined,
      includeSuites: true,
      printLocation: true,
    });
    return res;
  }
}

const worker = new Worker();

export const masterApi = createBirpc<TestRunReporter, Worker>(worker, {
  post: (data) => process.send?.(data),
  on: (fn) => process.on('message', fn),
  bind: 'functions',
});

if (process.argv[1] === __filename) {
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => {
    // The master owns the 30-second grace period and uses SIGKILL if it expires.
    // Once SIGTERM arrives, wait for the same idempotent close instead of
    // truncating an in-flight teardown with a second one-second deadline.
    shutdownPromise ??= worker
      .closeWatcher()
      .catch((error) => {
        logger.error('Failed to close the active watcher', error);
      })
      .finally(() => {
        process.exit();
      });
  };

  process.once('disconnect', shutdown);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
