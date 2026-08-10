import { FIXTURE_CLEANUP_TIMEOUT_MS } from '@rstest/core/internal/browser';
import { describe, expect, it, rs, rstest } from '@rstest/core';
import { HostDispatchRouter } from '../src/dispatchRouter';
import { createHeadlessScheduler } from '../src/headlessScheduler';
import { createDeferredPromise } from '../src/hostPayloads';
import type {
  BrowserClientMessage,
  BrowserDispatchRequest,
  BrowserDispatchResponse,
  FileCleanupDispatchPayload,
  BrowserProjectRuntime,
  TestFileInfo,
} from '../src/protocol';
import {
  DISPATCH_MESSAGE_TYPE,
  DISPATCH_NAMESPACE_FILE_CLEANUP,
  DISPATCH_NAMESPACE_RUNNER,
  DISPATCH_RPC_BRIDGE_NAME,
} from '../src/protocol';
import type {
  BrowserConsoleMessage,
  BrowserProviderBrowser,
  BrowserProviderContext,
  BrowserProviderPage,
} from '../src/providers';

type SchedulerOptions = Parameters<typeof createHeadlessScheduler>[0];
type BrowserWatchState = SchedulerOptions['watchState'];
type FileCompleteMessage = Extract<
  BrowserClientMessage,
  { type: 'file-complete' }
>;

const createDeferred = <T = void>() => createDeferredPromise<T>();

type PageScript = (page: FakePage) => Promise<void> | void;

class FakePage implements BrowserProviderPage {
  readonly exposed = new Map<string, (...args: any[]) => any>();
  readonly listeners = new Map<string, Array<(...args: any[]) => void>>();
  readonly initScripts: string[] = [];
  readonly closeStarted = createDeferred();
  closeGate?: Promise<void>;

  constructor(
    readonly id: number,
    private readonly script: PageScript,
    private readonly steps: string[],
  ) {}

  async goto(url: string): Promise<void> {
    this.steps.push(`page:${this.id}:goto:${url}`);
    await Promise.resolve();
    void this.script(this);
  }

  async exposeFunction(
    name: string,
    fn: (...args: any[]) => any,
  ): Promise<void> {
    this.exposed.set(name, fn);
  }

  async addInitScript(script: string): Promise<void> {
    this.initScripts.push(script);
  }

  on(event: 'popup', listener: (page: BrowserProviderPage) => void): void;
  on(
    event: 'console',
    listener: (message: BrowserConsoleMessage) => void,
  ): void;
  on(event: 'crash' | 'close', listener: () => void): void;
  on(event: string, listener: (...args: any[]) => void): void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  emit(event: 'crash' | 'close'): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener();
    }
  }

  async send(message: BrowserClientMessage): Promise<void> {
    // The wire shape is the identity envelope; headless routing ignores the
    // runId (identity there is the host-injected runToken).
    await this.exposed.get(DISPATCH_MESSAGE_TYPE)?.({ message });
  }

  async dispatch(
    request: BrowserDispatchRequest,
  ): Promise<BrowserDispatchResponse> {
    return this.exposed.get(DISPATCH_RPC_BRIDGE_NAME)?.(request);
  }

  async close(): Promise<void> {
    this.steps.push(`page:${this.id}:close:start`);
    this.closeStarted.resolve();
    await this.closeGate;
    this.steps.push(`page:${this.id}:close:end`);
  }

  async [Symbol.asyncDispose](): Promise<void> {}
}

class FakeContext implements BrowserProviderContext {
  readonly closeStarted = createDeferred();
  closeCount = 0;

  constructor(
    readonly page: FakePage,
    private readonly steps: string[],
  ) {}

  async newPage(): Promise<BrowserProviderPage> {
    return this.page;
  }

  on(): void {}

  async close(): Promise<void> {
    this.closeCount += 1;
    this.steps.push(`context:${this.page.id}:close`);
    this.closeStarted.resolve();
  }

  async [Symbol.asyncDispose](): Promise<void> {}
}

class FakeBrowser implements BrowserProviderBrowser {
  readonly contexts: FakeContext[] = [];
  readonly contextOptions: Array<
    Parameters<BrowserProviderBrowser['newContext']>[0]
  > = [];

  constructor(
    private readonly scripts: PageScript[],
    private readonly steps: string[],
  ) {}

  async newContext(
    options: Parameters<BrowserProviderBrowser['newContext']>[0],
  ): Promise<BrowserProviderContext> {
    const id = this.contexts.length;
    const page = new FakePage(id, this.scripts[id] ?? (() => {}), this.steps);
    const context = new FakeContext(page, this.steps);
    this.contextOptions.push(options);
    this.contexts.push(context);
    this.steps.push(`context:${id}:created`);
    return context;
  }

  async close(): Promise<void> {}
  async [Symbol.asyncDispose](): Promise<void> {}
}

const firstContext = (browser: FakeBrowser): FakeContext => {
  const context = browser.contexts.at(0);
  if (!context) {
    throw new Error('Expected the browser to have created a context.');
  }
  return context;
};

const file = (testPath: string, projectName = 'browser'): TestFileInfo => ({
  testPath,
  projectName,
});

const complete = (testPath: string): FileCompleteMessage => ({
  type: 'file-complete',
  payload: {
    testId: testPath,
    status: 'pass',
    name: '',
    testPath,
    project: 'browser',
    results: [],
  },
});

type HarnessOptions = {
  files?: TestFileInfo[];
  scripts?: PageScript[];
  watch?: boolean;
  bail?: number;
  maxWorkers?: number;
  failedCount?: () => number;
  projectEntries?: () => Promise<
    Array<{ project: { name: string }; testFiles: string[] }>
  >;
  affected?: string[];
  v8Coverage?: SchedulerOptions['v8Coverage'];
};

const createHarness = (options: HarnessOptions = {}) => {
  const files = options.files ?? [file('/a.test.ts')];
  const defaultTestPath = files[0]?.testPath ?? '/a.test.ts';
  const steps: string[] = [];
  const browser = new FakeBrowser(
    options.scripts ?? [async (page) => page.send(complete(defaultTestPath))],
    steps,
  );
  const routed: BrowserClientMessage[] = [];
  const fatalErrors: Array<{ message: string; stack?: string }> = [];
  const completed: string[] = [];
  const completedResults: FileCompleteMessage['payload'][] = [];
  const invalidations: string[][] = [];
  const deleted: string[][] = [];
  const ready = rstest.fn();
  let interrupt = async () => {};
  let dispatchRerun = async () => {};
  let runScope = async (_paths: string[]): Promise<unknown[]> => [];
  const watchState: BrowserWatchState = {
    hooksEnabled: false,
    invalidation: new Map(),
    pendingAffectedTestFiles: new Map(
      options.affected ? [['browser', new Set(options.affected)]] : [],
    ),
    compileStartTimes: new Map(),
    pendingBuildTimeMs: 0,
    lastTestFiles: [...files],
  };
  const reporterResults: FileCompleteMessage['payload'][] = [];

  const result = createHeadlessScheduler({
    context: {
      command: options.watch ? 'watch' : 'run',
      normalizedConfig: {
        bail: options.bail ?? 0,
        pool: { maxWorkers: options.maxWorkers ?? 1 },
      },
      snapshotManager: { options: { updateSnapshot: 'none' } },
      stateManager: {
        getCountOfFailedTests: options.failedCount ?? (() => 0),
      },
      updateReporterResultState: (
        _files: unknown[],
        _cases: unknown[],
        deletedPaths?: string[],
      ) => {
        if (deletedPaths) deleted.push(deletedPaths);
      },
    } as SchedulerOptions['context'],
    browser,
    browserLaunchOptions: {
      provider: 'playwright',
      browser: 'chromium',
      headless: true,
      port: 3000,
      strictPort: true,
      providerOptions: { marker: true },
    },
    // The scheduler reads only the port; Rsbuild server objects are outside this unit seam.
    projectServers: new Map([
      ['browser', { port: 3000 }],
    ]) as SchedulerOptions['projectServers'],
    v8Coverage: options.v8Coverage,
    allTestFiles: files,
    projectRuntimeConfigs: [
      { name: 'browser', viewport: { width: 800, height: 600 } },
    ] as BrowserProjectRuntime[],
    hostOptions: {
      rootPath: '/',
      projects: [],
      snapshot: { updateSnapshot: 'none' },
    },
    watchState,
    isWatchMode: options.watch ?? false,
    createDispatchRouter: (routerOptions) => {
      const router = new HostDispatchRouter(routerOptions);
      router.register(DISPATCH_NAMESPACE_RUNNER, async (request) => {
        const message = {
          type: request.method,
          ...(request.args === undefined ? {} : { payload: request.args }),
        } as BrowserClientMessage;
        routed.push(message);
        if (message.type === 'file-complete') {
          reporterResults.push(message.payload);
        }
      });
      return router;
    },
    handlers: {
      async handleFatal(payload) {
        fatalErrors.push(payload);
      },
      async handleTestFileComplete(payload) {
        completed.push(payload.testPath);
        completedResults.push(payload);
      },
    },
    watchSignals: {
      setDispatchRerun(fn) {
        dispatchRerun = fn;
      },
      setInterrupt(fn) {
        interrupt = fn;
      },
      async signalInvalidation(paths) {
        invalidations.push(paths);
        return { cycle: Promise.resolve() };
      },
    },
    setDispatchPageResolver() {},
    createWatchSession(execute) {
      runScope = execute;
      return {
        async runCycle(testPaths) {
          await execute(testPaths);
          return {
            results: [],
            testResults: [],
            errors: [],
            testPaths,
            duration: { buildTime: 0, testTime: 0 },
          };
        },
        requestRerun: async (
          testPaths = files.map((entry) => entry.testPath),
        ) => {
          await execute(testPaths);
        },
      };
    },
    collectProjectEntries:
      options.projectEntries ??
      (async () => [
        {
          project: { name: 'browser' },
          testFiles: files.map((f) => f.testPath),
        },
      ]),
    logWatchReady: ready,
    async destroyRuntime() {},
  });

  return {
    browser,
    completed,
    completedResults,
    deleted,
    dispatchRerun: () => dispatchRerun(),
    fatalErrors,
    interrupt: () => interrupt(),
    invalidations,
    ready,
    result,
    routed,
    runScope: (paths: string[]) => runScope(paths),
    steps,
    watchState,
  };
};

describe('headless scheduler', () => {
  it('fans files out to the worker pool', async () => {
    const firstGate = createDeferred();
    const secondGate = createDeferred();
    const gates = [firstGate, secondGate];
    const thirdStarted = createDeferred();
    const harness = createHarness({
      files: [file('/a.test.ts'), file('/b.test.ts'), file('/c.test.ts')],
      maxWorkers: 2,
      scripts: [
        ...gates.map((gate, index) => async (page: FakePage) => {
          await gate.promise;
          await page.send(complete(index === 0 ? '/a.test.ts' : '/b.test.ts'));
        }),
        async (page) => {
          thirdStarted.resolve();
          await page.send(complete('/c.test.ts'));
        },
      ],
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(harness.browser.contexts).toHaveLength(2);

    firstGate.resolve();
    await thirdStarted.promise;
    expect(harness.browser.contexts).toHaveLength(3);
    secondGate.resolve();
    await harness.result;
  });

  it('drains unclaimed files as skipped after cross-file bail', async () => {
    let failed = 0;
    const first = createDeferred();
    const second = createDeferred();
    const harness = createHarness({
      files: [
        file('/a.test.ts'),
        file('/b.test.ts'),
        file('/c.test.ts'),
        file('/d.test.ts'),
      ],
      maxWorkers: 2,
      bail: 1,
      failedCount: () => failed,
      scripts: [
        async (page) => {
          await first.promise;
          failed = 1;
          await page.send(complete('/a.test.ts'));
        },
        async (page) => {
          await second.promise;
          await page.send(complete('/b.test.ts'));
        },
      ],
    });

    await Promise.resolve();
    first.resolve();
    await firstContext(harness.browser).closeStarted.promise;
    second.resolve();
    await harness.result;

    expect(harness.browser.contexts).toHaveLength(2);
    expect(harness.completed.sort()).toEqual(['/c.test.ts', '/d.test.ts']);
  });

  it('drops a late dispatch after latest-wins interruption', async () => {
    const firstRunStarted = createDeferred();
    let latePage: FakePage | undefined;
    const harness = createHarness({
      watch: true,
      scripts: [
        async (page) => page.send(complete('/a.test.ts')),
        (page) => {
          latePage = page;
          firstRunStarted.resolve();
        },
        async (page) => page.send(complete('/a.test.ts')),
      ],
    });
    await harness.result;

    const staleRun = harness.runScope(['/a.test.ts']);
    await firstRunStarted.promise;
    await harness.interrupt();
    await harness.runScope(['/a.test.ts']);
    await staleRun;
    const routedBeforeLateMessage = harness.routed.length;
    await latePage?.send(complete('/a.test.ts'));

    expect(harness.browser.contexts).toHaveLength(3);
    expect(harness.routed).toHaveLength(routedBeforeLateMessage);
  });

  it.each([
    ['crash', 'Browser page crashed while running /a.test.ts.'],
    ['close', 'Browser page closed unexpectedly while running /a.test.ts.'],
  ] as const)(
    'reports an unexpected page %s and cancels the run',
    async (event, message) => {
      const harness = createHarness({
        scripts: [(page) => page.emit(event)],
      });

      await harness.result;
      expect(harness.fatalErrors).toEqual([{ message }]);
      expect(firstContext(harness.browser).closeCount).toBeGreaterThan(0);
    },
  );

  it('collects coverage from concurrent pages before a fatal cancellation', async () => {
    const siblingStarted = createDeferred();
    const collectedPages: number[] = [];
    const harness = createHarness({
      files: [file('/fatal.test.ts'), file('/sibling.test.ts')],
      maxWorkers: 2,
      scripts: [
        async (page) => {
          await siblingStarted.promise;
          await page.send({
            type: 'fatal',
            payload: { message: 'fatal test failure' },
          });
        },
        () => {
          siblingStarted.resolve();
        },
      ],
      v8Coverage: {
        start: async () => {},
        take: async (page) => {
          collectedPages.push((page as FakePage).id);
          return { entries: [] };
        },
      },
    });

    await harness.result;

    expect(collectedPages.sort()).toEqual([0, 1]);
  });

  it('fails only the file whose fixture cleanup times out', async () => {
    rs.useFakeTimers();
    try {
      const cleanupStarted = createDeferred();
      const harness = createHarness({
        files: [file('/a.test.ts'), file('/b.test.ts')],
        maxWorkers: 1,
        scripts: [
          async (page) => {
            const result = {
              ...complete('/a.test.ts').payload,
              coverageRaw: { preserved: true },
              meta: { preserved: true },
              snapshotResult: {
                added: 1,
                fileDeleted: false,
                filepath: '/a.test.ts.snap',
                matched: 0,
                unchecked: 0,
                uncheckedKeys: [],
                unmatched: 0,
                updated: 0,
              },
            };
            await page.dispatch({
              requestId: 'cleanup-start',
              namespace: DISPATCH_NAMESPACE_FILE_CLEANUP,
              method: 'start',
              args: {
                projectName: 'browser',
                result,
                testPath: '/a.test.ts',
              } satisfies FileCleanupDispatchPayload,
            });
            cleanupStarted.resolve();
          },
          async (page) => page.send(complete('/b.test.ts')),
        ],
      });

      await cleanupStarted.promise;
      await rs.advanceTimersByTimeAsync(FIXTURE_CLEANUP_TIMEOUT_MS);
      await harness.result;

      expect(harness.browser.contexts).toHaveLength(2);
      expect(harness.completedResults).toEqual([
        expect.objectContaining({
          status: 'fail',
          testPath: '/a.test.ts',
          coverageRaw: { preserved: true },
          meta: { preserved: true },
          snapshotResult: expect.objectContaining({ added: 1 }),
          errors: [
            expect.objectContaining({
              message: `File fixture cleanup did not finish within ${FIXTURE_CLEANUP_TIMEOUT_MS}ms`,
            }),
          ],
        }),
      ]);
      expect(harness.routed).toContainEqual(complete('/b.test.ts'));
      expect(harness.fatalErrors).toEqual([]);
    } finally {
      rs.useRealTimers();
    }
  });

  it('detaches teardown for an abandoned run', async () => {
    const started = createDeferred();
    const harness = createHarness({
      watch: true,
      scripts: [
        async (page) => page.send(complete('/a.test.ts')),
        (page) => {
          page.closeGate = new Promise(() => {});
          started.resolve();
        },
      ],
    });
    await harness.result;

    const abandoned = harness.runScope(['/a.test.ts']);
    await started.promise;
    await harness.interrupt();
    await abandoned;

    expect(harness.steps).toContain('page:1:close:start');
    expect(harness.steps).not.toContain('context:1:close');
  });

  it('filters queued run scope against the latest watch file set', async () => {
    const harness = createHarness({ watch: true });
    await harness.result;
    harness.watchState.lastTestFiles = [file('/b.test.ts')];

    await harness.runScope(['/a.test.ts', '/missing.test.ts']);
    expect(harness.browser.contexts).toHaveLength(1);
  });

  it('signals an empty cycle when a file-set change removes every file', async () => {
    const harness = createHarness({
      watch: true,
      projectEntries: async () => [
        { project: { name: 'browser' }, testFiles: [] },
      ],
    });
    await harness.result;
    await harness.dispatchRerun();

    expect(harness.invalidations).toEqual([[]]);
    expect(harness.deleted).toEqual([['/a.test.ts']]);
  });

  it('signals all current files when the file set changes', async () => {
    const harness = createHarness({
      watch: true,
      projectEntries: async () => [
        {
          project: { name: 'browser' },
          testFiles: ['/a.test.ts', '/b.test.ts'],
        },
      ],
    });
    await harness.result;
    await harness.dispatchRerun();

    expect(harness.invalidations).toEqual([['/a.test.ts', '/b.test.ts']]);
  });

  it('does not signal when no current file is affected', async () => {
    const harness = createHarness({
      watch: true,
      affected: ['/other.test.ts'],
    });
    await harness.result;
    await harness.dispatchRerun();

    expect(harness.invalidations).toEqual([]);
    expect(harness.ready).toHaveBeenCalledTimes(1);
  });

  it('signals only the affected current-file scope', async () => {
    const harness = createHarness({
      watch: true,
      files: [file('/a.test.ts'), file('/b.test.ts')],
      affected: ['/b.test.ts', '/missing.test.ts'],
      scripts: [
        async (page) => page.send(complete('/a.test.ts')),
        async (page) => page.send(complete('/b.test.ts')),
      ],
    });
    await harness.result;
    await harness.dispatchRerun();

    expect(harness.invalidations).toEqual([['/b.test.ts']]);
  });
});
