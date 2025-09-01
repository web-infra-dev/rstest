import { WebSocket } from 'ws';
import type { WorkerInitData, WorkerRunTestData } from '../types';
import { VscodeReporter } from './reporter';
import { logger } from './logger';

class Worker {
  private ws: WebSocket;
  // private rstest!: RstestInstance;
  // public initPromise: Promise<void>;
  // private resolveInitPromise!: () => void;
  public rstestPath!: string;
  public cwd!: string;

  constructor() {
    this.ws = new WebSocket(process.env.RSTEST_WS_ADDRESS!);
    // this.initPromise = this.waitInitPromise();
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
    logger.debug('🙋', data);
    try {
      const rstest = await this.createRstest(data);
      rstest.context.fileFilters = data.fileFilters;
      rstest.context.normalizedConfig.testNamePattern = data.testNamePattern;
      let res = await rstest.runTests();
      logger.debug('🏁', res);
    } catch (error) {
      logger.error('🤒', error);
    }
  }

  // private waitInitPromise = () => {
  //   return new Promise<void>((resolve) => {
  //     this.resolveInitPromise = resolve as any;
  //   });
  // };

  public async initRstest(data: WorkerInitData) {
    this.rstestPath = data.rstestPath;
    this.cwd = data.cwd;
  }

  public async createRstest(data: WorkerRunTestData) {
    const rstestModule = (await import(
      this.rstestPath
    )) as typeof import('@rstest/core');
    logger.debug('🤶', rstestModule);
    const { createRstest, loadConfig } = rstestModule;
    const { filePath } = await loadConfig({
      cwd: this.cwd,
    });

    // process.env.DEBUG = 'rstest';
    const rstest = createRstest(
      {
        config: {
          root: this.cwd,
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
        configFilePath: filePath ?? undefined,
        projects: [],
      },
      'run',
      [],
    );

    // TODO: pass to here
    // this.rstest.context.fileFilters = ['foo']; // to filter file name
    // this.rstest.context.normalizedConfig.testNamePattern = 'foo'; // to filter pattern
    // this.resolveInitPromise();

    return rstest;
  }
}

(async () => {
  const _worker = new Worker();
  // await worker.initPromise;
  // await worker.runTest();
})();
