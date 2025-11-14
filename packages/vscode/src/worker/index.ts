import { pathToFileURL } from 'node:url';
import { createBirpc } from 'birpc';
import type { RstestApi } from '../master';
import type {
  WorkerEventFinish,
  WorkerInitData,
  WorkerRunTestData,
} from '../types';
import { logger } from './logger';
import { VscodeReporter } from './reporter';

type CommonOptions = Parameters<typeof import('@rstest/core').initCli>[0];

// fix ESM import path issue on windows
// Only URLs with a scheme in: file, data, and node are supported by the default ESM loader.
const normalizeImportPath = (path: string) => {
  return pathToFileURL(path).toString();
};

export class Worker {
  public rstestPath!: string;
  public cwd!: string;

  public async runTest(data: WorkerRunTestData) {
    logger.debug('Received runTest request', JSON.stringify(data, null, 2));
    let resolve!: (value: WorkerEventFinish) => void;
    const promise = new Promise<WorkerEventFinish>((res) => {
      resolve = res;
    });
    try {
      const rstest = await this.createRstest(resolve);
      rstest.context.fileFilters = data.fileFilters;
      rstest.context.normalizedConfig.testNamePattern = data.testNamePattern;
      const res = await rstest.runTests();
      logger.debug(
        'Test run completed',
        JSON.stringify({ id: data.id, result: res }, null, 2),
      );
    } catch (error) {
      logger.error('Test run failed', error);
      throw error;
    }
    return promise;
  }

  public async initRstest(data: WorkerInitData) {
    this.rstestPath = data.rstestPath;
    this.cwd = data.cwd;
    logger.debug('Initialized worker context', {
      cwd: this.cwd,
      rstestPath: this.rstestPath,
    });
  }

  public async createRstest(
    onTestRunEndCallback: (data: WorkerEventFinish) => void,
  ) {
    const rstestModule = (await import(
      normalizeImportPath(this.rstestPath)
    )) as typeof import('@rstest/core');
    logger.debug('Loaded Rstest module');
    const { createRstest, initCli } = rstestModule;

    const commonOptions: CommonOptions = {
      root: this.cwd,
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
          reporters: [new VscodeReporter({ onTestRunEndCallback })],
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

export const masterApi = createBirpc<Pick<RstestApi, 'log'>, Worker>(
  new Worker(),
  {
    post: (data) => process.send?.(data),
    on: (fn) => process.on('message', fn),
    bind: 'functions',
  },
);
