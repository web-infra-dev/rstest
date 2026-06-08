import { pathToFileURL } from 'node:url';
import { createBirpc } from 'birpc';
import type { TestRunReporter } from '../testRunReporter';
import type { WorkerInitOptions } from '../types';
import { logger } from './logger';
import { CoverageReporter, ProgressLogger, ProgressReporter } from './reporter';

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
    logger.debug('Loaded Rstest API module');
    const { createRstest } = rstestApi;

    const coverageEnabled = !!overrideConfig.coverage?.enabled;

    const rstest = await createRstest({
      configFile: configFilePath,
      config: {
        ...overrideConfig,
        reporters: [
          // place default reporter first to ensure output is flushed
          ['default', { logger: new ProgressLogger() }],
          new ProgressReporter(),
        ],
        coverage: {
          ...overrideConfig.coverage,
          // The coverage report runs per `run()`, so the reporter must be part
          // of the resolved config rather than pushed after construction.
          ...(coverageEnabled
            ? {
                reporters: [
                  ...(overrideConfig.coverage?.reporters ?? []),
                  new CoverageReporter(),
                ],
              }
            : {}),
        },
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
      const res = await rstest.run({ filters: data.fileFilters });
      logger.debug('Test run completed', { result: res });
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
