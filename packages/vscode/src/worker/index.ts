import { pathToFileURL } from 'node:url';
import { createBirpc } from 'birpc';
import type { RstestApi } from '../master';
import type { WorkerInitData, WorkerRunTestData } from '../types';
import { logger } from './logger';
import { ProgressLogger, ProgressReporter } from './reporter';

type CommonOptions = Parameters<typeof import('@rstest/core').initCli>[0];

// fix ESM import path issue on windows
// Only URLs with a scheme in: file, data, and node are supported by the default ESM loader.
const normalizeImportPath = (path: string) => {
  return pathToFileURL(path).toString();
};

export class Worker {
  public rstestPath!: string;
  public root!: string;
  public configFilePath!: string;

  public async runTest(data: WorkerRunTestData) {
    logger.debug('Received runTest request', JSON.stringify(data, null, 2));
    try {
      const rstest = await this.createRstest(data.runId, data.updateSnapshot);
      rstest.context.fileFilters = data.fileFilters;
      rstest.context.normalizedConfig.testNamePattern = data.testNamePattern;
      const res = await rstest.runTests();
      logger.debug(
        'Test run completed',
        JSON.stringify({ runId: data.runId, result: res }, null, 2),
      );
    } catch (error) {
      logger.error('Test run failed', error);
      throw error;
    }
  }

  public async initRstest(data: WorkerInitData) {
    this.rstestPath = data.rstestPath;
    this.root = data.root;
    this.configFilePath = data.configFilePath;
    logger.debug('Initialized worker context', {
      root: this.root,
      rstestPath: this.rstestPath,
    });
  }

  public async createRstest(runId: string, updateSnapshot?: boolean) {
    const rstestModule = (await import(
      normalizeImportPath(this.rstestPath)
    )) as typeof import('@rstest/core');
    logger.debug('Loaded Rstest module');
    const { createRstest, initCli } = rstestModule;

    const commonOptions: CommonOptions = {
      root: this.root,
      config: this.configFilePath,
    };

    const initializedOptions = await initCli(commonOptions);
    logger.debug('commonOptions', JSON.stringify(commonOptions, null, 2));
    const { config, configFilePath, projects } = initializedOptions;
    logger.debug(
      'initializedOptions',
      JSON.stringify(initializedOptions, null, 2),
    );

    const rstest = createRstest(
      {
        config: {
          ...config,
          update: updateSnapshot,
          reporters: [
            new ProgressReporter(runId),
            ['default', { logger: new ProgressLogger(runId) }],
          ],
        },
        configFilePath,
        projects,
      },
      'run',
      [],
    );

    return rstest;
  }
}

export const masterApi = createBirpc<
  Pick<RstestApi, 'log' | 'onTestProgress'>,
  Worker
>(new Worker(), {
  post: (data) => process.send?.(data),
  on: (fn) => process.on('message', fn),
  bind: 'functions',
});
