import { WebSocket } from 'ws';
import type { WorkerInitData, WorkerRunTestData } from '../types';
import { logger } from './logger';
import { VscodeReporter } from './reporter';

class Worker {
  private ws: WebSocket;
  public rstestPath!: string;
  public cwd!: string;

  constructor() {
    this.ws = new WebSocket(process.env.RSTEST_WS_ADDRESS!);
    this.ws.on('message', (bufferData) => {
      const _data = JSON.parse(bufferData.toString());
      if (_data.type === 'init') {
        const data: WorkerInitData = _data;
        this.initRstest(data);
      } else if (_data.type === 'runTest') {
        const data: WorkerRunTestData = _data;
        this.runTest(data);
      }
    });
  }

  public async runTest(data: WorkerRunTestData) {
    logger.debug('Received runTest request', JSON.stringify(data, null, 2));
    try {
      const rstest = await this.createRstest(data);
      rstest.context.fileFilters = data.fileFilters;
      rstest.context.normalizedConfig.testNamePattern = data.testNamePattern;
      const res = await rstest.runTests();
      logger.debug(
        'Test run completed',
        JSON.stringify({ id: data.id, result: res }, null, 2),
      );
    } catch (error) {
      logger.error('Test run failed', error);
    }
  }

  public async initRstest(data: WorkerInitData) {
    this.rstestPath = data.rstestPath;
    this.cwd = data.cwd;
    logger.debug('Initialized worker context', {
      cwd: this.cwd,
      rstestPath: this.rstestPath,
    });
  }

  public async createRstest(data: WorkerRunTestData) {
    const rstestModule = (await import(
      this.rstestPath
    )) as typeof import('@rstest/core');
    logger.debug('Loaded Rstest module');
    const { createRstest, loadConfig, initCli } = rstestModule;
    const { filePath } = await loadConfig({
      cwd: this.cwd,
    });

    logger.debug('Loaded Rstest config', {
      id: data.id,
      configFile: filePath ?? null,
    });

    type CommonOptions = Parameters<typeof import('@rstest/core').initCli>[0];

    const commonOptions: CommonOptions = {
      root: this.cwd,
      config: filePath ?? undefined,
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
          reporters: [
            new VscodeReporter({
              onTestRunEndCallback: ({ testFileResults, testResults }) => {
                this.ws.send(
                  JSON.stringify({
                    type: 'finish',
                    id: data.id,
                    testResults,
                    testFileResults,
                  }),
                );
              },
            }),
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

(async () => {
  const _worker = new Worker();
})();
