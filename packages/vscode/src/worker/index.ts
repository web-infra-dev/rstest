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
