import { describe, expect, it, rstest } from '@rstest/core';
import { SnapshotManager } from '@vitest/snapshot/manager';
import type { BrowserRuntime } from '../src/browserRsbuild';
import type { HostRpcMethods } from '../src/containerRpc';
import { HostDispatchRouter } from '../src/dispatchRouter';
import {
  claimHeadedCycleScope,
  createHeadedScheduler,
} from '../src/headedScheduler';
import type { FatalPayload } from '../src/hostPayloads';
import { DISPATCH_NAMESPACE_RUNNER } from '../src/protocol';
import type {
  BrowserProviderContext,
  BrowserProviderPage,
} from '../src/providers';

describe('claimHeadedCycleScope', () => {
  const testFile = (testPath: string) => ({
    testPath,
    projectName: 'browser',
  });

  it('claims only the patterns of the paths in its own scope', () => {
    // The race the per-file map exists for: a rebuild cycle for one file is
    // dequeued while a click on another is still waiting for the cycle it
    // signalled. The rebuild must not run with — or swallow — that pattern.
    const patterns = new Map([
      ['/a.test.ts', 'sums'],
      ['/b.test.ts', 'renders'],
    ]);
    const currentTestFiles = [testFile('/a.test.ts'), testFile('/b.test.ts')];

    const scope = claimHeadedCycleScope(
      ['/a.test.ts'],
      currentTestFiles,
      patterns,
    );

    expect(scope).toEqual([
      { file: currentTestFiles[0], testNamePattern: 'sums' },
    ]);
    expect([...patterns]).toEqual([['/b.test.ts', 'renders']]);
  });

  it('consumes a pattern once, so a later cycle runs the whole file', () => {
    const patterns = new Map([['/a.test.ts', 'sums']]);
    const currentTestFiles = [testFile('/a.test.ts')];

    const claimed = claimHeadedCycleScope(
      ['/a.test.ts'],
      currentTestFiles,
      patterns,
    );
    const afterwards = claimHeadedCycleScope(
      ['/a.test.ts'],
      currentTestFiles,
      patterns,
    );

    expect(claimed[0]!.testNamePattern).toBe('sums');
    expect(afterwards[0]!.testNamePattern).toBeUndefined();
  });

  it('skips a path the file set no longer has and keeps every live one', () => {
    // A queued scope goes stale when a later trigger rebuilds the file set
    // without one of its files. Skipping is what the headless twin does;
    // failing the cycle would take the surviving files down with it.
    const currentTestFiles = [testFile('/a.test.ts'), testFile('/c.test.ts')];

    const scope = claimHeadedCycleScope(
      ['/a.test.ts', '/deleted.test.ts', '/c.test.ts'],
      currentTestFiles,
      new Map(),
    );

    expect(scope.map(({ file }) => file.testPath)).toEqual([
      '/a.test.ts',
      '/c.test.ts',
    ]);
  });

  it('leaves a skipped path’s pattern for whichever cycle runs the file', () => {
    // The file set can be rebuilt back — the click's pattern is only spent when
    // a cycle actually carries the file. Consuming it on the way past would turn
    // the user's single-test click into a full-file rerun, silently.
    const patterns = new Map([['/a.test.ts', 'sums']]);

    const skipped = claimHeadedCycleScope(['/a.test.ts'], [], patterns);
    const later = claimHeadedCycleScope(
      ['/a.test.ts'],
      [testFile('/a.test.ts')],
      patterns,
    );

    expect(skipped).toEqual([]);
    expect(later[0]!.testNamePattern).toBe('sums');
  });

  it('normalizes the scope paths before matching files and patterns', () => {
    // The scope arrives from core's cycle options while the file set and the
    // pattern map are keyed on normalized paths.
    const patterns = new Map([['/a.test.ts', 'sums']]);
    const currentTestFiles = [testFile('/a.test.ts')];

    const scope = claimHeadedCycleScope(
      ['/tests/../a.test.ts'],
      currentTestFiles,
      patterns,
    );

    expect(scope).toEqual([
      { file: currentTestFiles[0], testNamePattern: 'sums' },
    ]);
  });
});

describe('createHeadedScheduler', () => {
  it('settles the run and still routes the fatal when coverage take rejects', async () => {
    const testFile = {
      testPath: '/fatal.test.ts',
      projectName: 'browser',
    };
    let hostMethods: HostRpcMethods | undefined;
    const reloadRequested = Promise.withResolvers<string>();
    const page = {} as BrowserProviderPage;
    const context = {} as BrowserProviderContext;
    const handleFatal = rstest.fn(async (_payload: FatalPayload) => {});
    const coverageError = new Error('coverage collection failed');
    const fatalErrorRef: { current: Error | null } = { current: null };
    const snapshotManager = new SnapshotManager({ updateSnapshot: 'none' });
    const runtime = {
      browser: {},
      browserLaunchOptions: { providerOptions: {} },
      containerContext: context,
      containerPage: page,
      containerServer: { port: 3000 },
      rpcManager: {
        currentWebSocket: null,
        isConnected: false,
        reloadTestFile: async (_testFile: string, runId: string) => {
          reloadRequested.resolve(runId);
        },
        updateMethods: (methods: HostRpcMethods) => {
          hostMethods = methods;
        },
      },
      watchState: { lastTestFiles: [], headedFileSetVersion: 0 },
    } as unknown as BrowserRuntime;

    // The runner-namespace routing the controller normally installs: the gate
    // must reach the fatal handler even though the coverage take just threw.
    const createDispatchRouter = () => {
      const router = new HostDispatchRouter();
      router.register(DISPATCH_NAMESPACE_RUNNER, async (request) => {
        if (request.method === 'fatal') {
          const payload = request.args as FatalPayload;
          fatalErrorRef.current = new Error(payload.message);
          await handleFatal(payload);
        }
      });
      return router;
    };

    const schedulerResult = createHeadedScheduler({
      context: {
        rootPath: '/project',
        normalizedConfig: { name: 'browser' },
        snapshotManager,
        updateReporterResultState: () => {},
      },
      runtime,
      allTestFiles: [testFile],
      hostOptions: {
        rootPath: '/project',
        projects: [],
        snapshot: { updateSnapshot: 'none' },
      },
      v8Coverage: {
        start: async () => {},
        take: async () => {
          throw coverageError;
        },
      },
      projectRoots: new Map([['browser', '/project']]),
      isWatchMode: true,
      createDispatchRouter,
      handlers: { handleTestFileComplete: async () => {} },
      fatalErrorRef,
      watchSignals: {
        setDispatchRerun: () => {},
        signalInvalidation: async () => ({ cycle: Promise.resolve() }),
      },
      setDispatchPageResolver: () => {},
      createWatchSession: () => ({
        runCycle: async () => ({
          results: [],
          testResults: [],
          errors: [],
          testPaths: [],
          duration: { buildTime: 0, testTime: 0 },
        }),
        requestRerun: async () => {},
      }),
      collectProjectEntries: async () => [],
      logWatchReady: () => {},
      destroyRuntime: async () => {},
    });

    // The identity the fatal must speak under is the one the host minted for
    // this reload — the fake transport hands it back like the wire would.
    const runId = await reloadRequested.promise;
    if (!hostMethods) {
      throw new Error('Expected headed RPC methods to be registered');
    }

    const response = await hostMethods.dispatch({
      namespace: DISPATCH_NAMESPACE_RUNNER,
      method: 'fatal',
      requestId: 'req-fatal',
      runId,
      args: { message: 'fatal test failure' },
    });

    expect(response).not.toMatchObject({ stale: true });
    expect(handleFatal).toHaveBeenCalledWith({ message: 'fatal test failure' });
    // The run settled (the scheduler's serial loop got released) and the take
    // failure neither wedged it nor displaced the fatal as the cycle outcome.
    await expect(schedulerResult).resolves.toMatchObject({ rawCoverage: [] });
    expect(fatalErrorRef.current?.message).toBe('fatal test failure');
  });
});
