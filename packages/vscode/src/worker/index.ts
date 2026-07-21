import { pathToFileURL } from 'node:url';
import { createBirpc } from 'birpc';
import type { TestRunReporter } from '../testRunReporter';
import type { WorkerInitOptions } from '../types';
import { logger } from './logger';
import { CoverageReporter, ProgressLogger, ProgressReporter } from './reporter';

// fix ESM import path issue on windows
// Only URLs with a scheme in: file, data, and node are supported by the default ESM loader.
const normalizeImportPath = (path: string) => {
  return pathToFileURL(path).toString();
};

export class Worker {
  private async init({
    configFilePath,
    fileFilters,
    rstestPath,
    command = 'run',
    ...overrideConfig
  }: WorkerInitOptions) {
    const rstestModule = (await import(
      normalizeImportPath(rstestPath)
    )) as typeof import('@rstest/core');
    logger.debug('Loaded Rstest module');
    const { createRstest, initCli } = rstestModule;

    const initializedOptions = await initCli({
      config: configFilePath,
    });
    const { projects, config: initializedConfig } = initializedOptions;
    logger.debug('initializedOptions', initializedOptions);

    const rstest = createRstest(
      {
        config: {
          ...initializedConfig,
          ...overrideConfig,
          reporters: [
            // place default reporter first to ensure output is flushed
            ['default', { logger: new ProgressLogger() }],
            new ProgressReporter(),
          ],
          coverage: {
            ...initializedConfig.coverage,
            ...overrideConfig.coverage,
          },
        },
        configFilePath,
        projects,
      },
      command,
      fileFilters ?? [],
    );

    return { rstest, projects };
  }

  public async getNormalizedConfig(options: WorkerInitOptions) {
    const { rstest, projects } = await this.init(options);
    return {
      root: rstest.context.normalizedConfig.root,
      include: rstest.context.normalizedConfig.include,
      exclude: rstest.context.normalizedConfig.exclude.patterns,
      // Sub-projects this config aggregates via `projects`. Empty for a leaf
      // config. The extension uses these to avoid registering a child config
      // as its own top-level project when a parent already covers it
      // (otherwise the same test files show up twice). A file-based child is
      // identified by its config file; inline children only have a root.
      // `null` (not `undefined`) so the fields survive the IPC JSON round-trip.
      childProjects: projects.map((project) => ({
        configFilePath: project.configFilePath ?? null,
        root: project.config.root ?? null,
      })),
    };
  }

  public async runTest(data: WorkerInitOptions) {
    logger.debug('Received runTest request', JSON.stringify(data, null, 2));
    try {
      const { rstest } = await this.init(data);
      if (data.coverage?.enabled) {
        rstest.context.normalizedConfig.coverage.reporters.push(
          new CoverageReporter(),
        );
      }
      const res = await rstest.runTests();
      logger.debug('Test run completed', { result: res });
    } catch (error) {
      logger.error('Test run failed', error);
      throw error;
    }
  }

  public async listTests(data: WorkerInitOptions) {
    const { rstest } = await this.init({ ...data, command: 'list' });
    const res = await rstest.listTests({});
    return res;
  }
}

export const masterApi = createBirpc<TestRunReporter, Worker>(new Worker(), {
  post: (data) => process.send?.(data),
  on: (fn) => process.on('message', fn),
  bind: 'functions',
});
