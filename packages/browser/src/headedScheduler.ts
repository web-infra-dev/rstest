import type {
  RstestContext,
  TestFileResult,
  TestResult,
} from '@rstest/core/internal/browser';
import {
  color,
  createFileCleanupTimeoutResult,
  FIXTURE_CLEANUP_TIMEOUT_MS,
  logger,
} from '@rstest/core/internal/browser';
import { normalize, relative } from 'pathe';
import {
  type BrowserRuntime,
  drainPendingAffectedTestFiles,
} from './browserRsbuild';
import { ContainerRpcManager, type HostRpcMethods } from './containerRpc';
import type { HostDispatchRouter } from './dispatchRouter';
import { createHeadedSerialTaskQueue } from './headedSerialTaskQueue';
import {
  createDeferredPromise,
  type DeferredPromise,
  type FatalPayload,
  type HeadedTestFileCompletePayload,
  type LogPayload,
  type ReloadTestFileAck,
  type TestFileStartPayload,
  toError,
} from './hostPayloads';
import type {
  BrowserDispatchRequest,
  BrowserHostConfig,
  FileCleanupDispatchPayload,
  TestFileInfo,
} from './protocol';
import { DISPATCH_NAMESPACE_FILE_CLEANUP } from './protocol';
import type { BrowserProviderContext, BrowserProviderPage } from './providers';
import { commitWatchFileSetUpdate, planWatchRerun } from './watchRerunPlanner';
import type {
  BrowserWatchSession,
  CreateBrowserWatchSession,
  DispatchPageResolver,
  SchedulerRunResult,
} from './schedulerSeam';
import type { WatchSignals } from './watchSignals';

type HeadedSchedulerContext = Pick<
  RstestContext,
  'rootPath' | 'snapshotManager' | 'updateReporterResultState'
> & {
  normalizedConfig: Pick<RstestContext['normalizedConfig'], 'name'>;
};

type HeadedSchedulerDeps = {
  context: HeadedSchedulerContext;
  runtime: BrowserRuntime;
  allTestFiles: TestFileInfo[];
  hostOptions: BrowserHostConfig;
  v8Coverage?: {
    start: (page: BrowserProviderPage) => Promise<void>;
    take: (
      page: BrowserProviderPage,
      projectRoot: string,
    ) => Promise<unknown | null>;
  };
  projectRoots: Map<string, string>;
  isWatchMode: boolean;
  createDispatchRouter: () => HostDispatchRouter;
  handlers: {
    handleTestFileStart: (payload: TestFileStartPayload) => Promise<void>;
    handleTestCaseResult: (payload: TestResult) => Promise<void>;
    handleTestFileComplete: (payload: TestFileResult) => Promise<void>;
    handleLog: (payload: LogPayload) => Promise<void>;
    handleFatal: (payload: FatalPayload) => Promise<void>;
  };
  fatalErrorRef: { current: Error | null };
  watchSignals: Pick<
    WatchSignals,
    'setDispatchRerun' | 'signalInvalidation' | 'awaitSignalledCycle'
  >;
  setDispatchPageResolver: (resolver: DispatchPageResolver) => void;
  createWatchSession: CreateBrowserWatchSession;
  collectProjectEntries: () => Promise<
    Parameters<typeof planWatchRerun>[0]['projectEntries']
  >;
  logWatchReady: () => void;
  destroyRuntime: () => Promise<void>;
};

/**
 * A headed cycle's work list: the files of its scope that still exist, each
 * paired with the test-name pattern whichever trigger put it in scope asked for.
 *
 * Both halves are resolved in one pass, synchronously, at the top of the cycle.
 * A queued scope can go stale before its cycle is dequeued — a later trigger may
 * have rebuilt the file set without one of these files — and it is skipped the
 * way the headless twin skips it; throwing would abandon the still-valid files
 * beside it and fail the run. The patterns are claimed here, and only for the
 * paths in this scope, so a click landing once the cycle is under way keeps its
 * pattern for the cycle it signalled instead of losing it to this one mid-loop.
 *
 * A skipped path keeps its pattern too, for the same reason: consuming it on the
 * way past would leave the next cycle that does run the file — the file set can
 * be rebuilt back — running it unfiltered, so the user's click would silently
 * become a full-file rerun. The cost is one map entry per path that never comes
 * back, which the next launch drops with the map.
 */
export const claimHeadedCycleScope = (
  testPaths: string[],
  currentTestFiles: TestFileInfo[],
  pendingTestNamePatterns: Map<string, string>,
): { file: TestFileInfo; testNamePattern?: string }[] => {
  const scope: { file: TestFileInfo; testNamePattern?: string }[] = [];
  const filesByPath = new Map(
    currentTestFiles.map((file) => [file.testPath, file]),
  );
  for (const testPath of testPaths) {
    const normalizedTestPath = normalize(testPath);
    const file = filesByPath.get(normalizedTestPath);
    if (file) {
      scope.push({
        file,
        testNamePattern: pendingTestNamePatterns.get(normalizedTestPath),
      });
      pendingTestNamePatterns.delete(normalizedTestPath);
    }
  }
  return scope;
};

export const createHeadedScheduler = async ({
  context,
  runtime,
  allTestFiles,
  hostOptions,
  v8Coverage,
  projectRoots,
  isWatchMode,
  createDispatchRouter,
  handlers: {
    handleTestFileStart,
    handleTestCaseResult,
    handleTestFileComplete,
    handleLog,
    handleFatal,
  },
  fatalErrorRef,
  watchSignals,
  setDispatchPageResolver,
  createWatchSession,
  collectProjectEntries,
  logWatchReady,
  destroyRuntime,
}: HeadedSchedulerDeps): Promise<SchedulerRunResult> => {
  const { browser, browserLaunchOptions, watchState, wss } = runtime;
  const containerUrl = `http://localhost:${runtime.containerServer.port}/`;
  let currentTestFiles = allTestFiles;
  // Coincidentally equal to the runner-side CONFIG_WAIT_TIMEOUT_MS and
  // DEFAULT_RPC_TIMEOUT_MS (client/runner.ts, client/dispatchTransport.ts) but
  // semantically distinct and in a different runtime, so deliberately NOT shared
  // with them. Invariant worth preserving: a runner must be able to receive its
  // config (config-wait) before the host declares its frames un-ready, i.e.
  // CONFIG_WAIT_TIMEOUT_MS <= RUNNER_FRAMES_READY_TIMEOUT_MS.
  const RUNNER_FRAMES_READY_TIMEOUT_MS = 30_000;
  let currentRunnerFramesSignature: string | null = null;
  const runnerFramesWaiters = new Map<string, Set<() => void>>();

  const createTestFilesSignature = (testFiles: readonly string[]): string => {
    return JSON.stringify(testFiles.map((testFile) => normalize(testFile)));
  };

  const markRunnerFramesReady = (testFiles: string[]): void => {
    const signature = createTestFilesSignature(testFiles);
    currentRunnerFramesSignature = signature;
    const waiters = runnerFramesWaiters.get(signature);
    if (!waiters) {
      return;
    }
    runnerFramesWaiters.delete(signature);
    for (const waiter of waiters) {
      waiter();
    }
  };

  const waitForRunnerFramesReady = async (
    testFiles: readonly string[],
  ): Promise<void> => {
    const signature = createTestFilesSignature(testFiles);
    if (currentRunnerFramesSignature === signature) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const waiters =
        runnerFramesWaiters.get(signature) ?? new Set<() => void>();

      const cleanup = () => {
        const currentWaiters = runnerFramesWaiters.get(signature);
        if (!currentWaiters) {
          return;
        }
        currentWaiters.delete(onReady);
        if (currentWaiters.size === 0) {
          runnerFramesWaiters.delete(signature);
        }
      };

      const onReady = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        cleanup();
        resolve();
      };

      const timeoutId = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Timed out waiting for headed runner frames to be ready for ${testFiles.length} file(s).`,
          ),
        );
      }, RUNNER_FRAMES_READY_TIMEOUT_MS);

      waiters.add(onReady);
      runnerFramesWaiters.set(signature, waiters);

      if (currentRunnerFramesSignature === signature) {
        onReady();
      }
    });
  };

  const getTestFileInfo = (testFile: string): TestFileInfo => {
    const normalizedTestFile = normalize(testFile);
    const fileInfo = currentTestFiles.find(
      (file) => file.testPath === normalizedTestFile,
    );
    if (!fileInfo) {
      throw new Error(`Unknown browser test file: ${JSON.stringify(testFile)}`);
    }
    return fileInfo;
  };

  // Open a container page for user to view (reuse in watch mode)
  let containerContext: BrowserProviderContext;
  let containerPage: BrowserProviderPage;
  let isNewPage = false;

  const attachContainerPageHandlers = (
    activeContext: BrowserProviderContext,
    activePage: BrowserProviderPage,
  ): void => {
    activePage.on('popup', async (popup: BrowserProviderPage) => {
      await popup.close().catch(() => {});
    });

    activeContext.on('page', async (page: BrowserProviderPage) => {
      if (page !== activePage) {
        await page.close().catch(() => {});
      }
    });

    activePage.on('console', (msg) => {
      const text = msg.text();
      if (text.startsWith('[Container]') || text.startsWith('[Runner]')) {
        logger.log(color.gray(`[Browser Console] ${text}`));
      }
    });
  };

  const createContainerPage = async (): Promise<{
    context: BrowserProviderContext;
    page: BrowserProviderPage;
  }> => {
    const nextContext = await browser.newContext({
      providerOptions: browserLaunchOptions.providerOptions,
      viewport: null,
    });
    const nextPage = await nextContext.newPage();
    attachContainerPageHandlers(nextContext, nextPage);
    return { context: nextContext, page: nextPage };
  };

  if (isWatchMode && runtime.containerPage && runtime.containerContext) {
    containerContext = runtime.containerContext;
    containerPage = runtime.containerPage;
    logger.log(color.gray('\n[Watch] Reusing existing container page\n'));
  } else {
    isNewPage = true;
    const created = await createContainerPage();
    containerContext = created.context;
    containerPage = created.page;

    if (isWatchMode) {
      runtime.containerPage = containerPage;
      runtime.containerContext = containerContext;
    }
  }

  setDispatchPageResolver(() => ({ containerPage }));

  const dispatchRouter = createDispatchRouter();
  const headedReloadQueue = createHeadedSerialTaskQueue();
  const pendingHeadedReloads = new Map<
    string,
    {
      cleanupTimer?: ReturnType<typeof setTimeout>;
      deferred: DeferredPromise<void>;
      file: TestFileInfo;
      result?: TestFileResult;
      runId: string;
    }
  >();
  let rawCoverage: unknown[] = [];
  let coverageStarted = false;
  const collectCoverage = async (projectName?: string): Promise<void> => {
    if (!coverageStarted || !v8Coverage) {
      return;
    }
    coverageStarted = false;
    const coverage = await v8Coverage.take(
      containerPage,
      projectRoots.get(projectName ?? '') ?? context.rootPath,
    );
    if (coverage) {
      rawCoverage.push(coverage);
    }
  };
  const timedOutHeadedRuns = new Set<string>();
  let enqueueHeadedReload = async (
    _file: TestFileInfo,
    _testNamePattern?: string,
  ): Promise<void> => {
    throw new Error('Headed reload queue is not initialized');
  };

  const rejectPendingHeadedReload = (
    testPath: string,
    error: Error,
    runId?: string,
  ): void => {
    const pending = pendingHeadedReloads.get(testPath);
    if (!pending) {
      return;
    }
    if (runId && pending.runId !== runId) {
      return;
    }
    if (pending.cleanupTimer) {
      clearTimeout(pending.cleanupTimer);
    }
    pendingHeadedReloads.delete(testPath);
    pending.deferred.reject(error);
  };

  const rejectAllPendingHeadedReloads = (error: Error): void => {
    for (const [testPath, pending] of pendingHeadedReloads) {
      if (pending.cleanupTimer) {
        clearTimeout(pending.cleanupTimer);
      }
      pendingHeadedReloads.delete(testPath);
      pending.deferred.reject(error);
    }
  };

  const registerPendingHeadedReload = (
    file: TestFileInfo,
    runId: string,
  ): Promise<void> => {
    const { testPath } = file;
    const previousPending = pendingHeadedReloads.get(testPath);
    if (previousPending) {
      if (previousPending.cleanupTimer) {
        clearTimeout(previousPending.cleanupTimer);
      }
      previousPending.deferred.reject(
        new Error(
          `Reload for "${testPath}" was superseded by a newer request.`,
        ),
      );
      pendingHeadedReloads.delete(testPath);
    }

    const deferred = createDeferredPromise<void>();
    pendingHeadedReloads.set(testPath, {
      deferred,
      file,
      runId,
    });

    return deferred.promise;
  };

  const resolvePendingHeadedReload = (
    testPath: string,
    runId?: string,
  ): void => {
    const pending = pendingHeadedReloads.get(testPath);
    if (!pending) {
      return;
    }
    if (runId && pending.runId !== runId) {
      logger.debug(
        `[Browser UI] Ignoring stale file-complete for ${testPath}. current=${pending.runId}, incoming=${runId}`,
      );
      return;
    }
    if (pending.cleanupTimer) {
      clearTimeout(pending.cleanupTimer);
    }
    pendingHeadedReloads.delete(testPath);
    pending.deferred.resolve();
  };

  const recoverHeadedContainer = async (): Promise<void> => {
    currentRunnerFramesSignature = null;
    await containerContext.close().catch(() => {});
    const created = await createContainerPage();
    containerContext = created.context;
    containerPage = created.page;
    if (isWatchMode) {
      runtime.containerPage = containerPage;
      runtime.containerContext = containerContext;
    }
    await containerPage.goto(containerUrl, { waitUntil: 'load' });
    await waitForRunnerFramesReady(
      currentTestFiles.map((file) => file.testPath),
    );
  };

  const startFileCleanupTimeout = (
    payload: FileCleanupDispatchPayload,
  ): void => {
    const pending = pendingHeadedReloads.get(payload.testPath);
    if (!pending || (payload.runId && pending.runId !== payload.runId)) {
      return;
    }
    if (pending.cleanupTimer) {
      clearTimeout(pending.cleanupTimer);
    }
    pending.result = payload.result;
    pending.cleanupTimer = setTimeout(() => {
      const currentPending = pendingHeadedReloads.get(payload.testPath);
      if (!currentPending || currentPending.runId !== pending.runId) {
        return;
      }

      currentPending.cleanupTimer = undefined;
      pendingHeadedReloads.delete(payload.testPath);
      // The iframe may eventually finish after the watchdog. Keep that stale
      // completion from reporting a second result for the same run.
      timedOutHeadedRuns.add(`${payload.testPath}\0${pending.runId}`);

      void (async () => {
        const message = `File fixture cleanup did not finish within ${FIXTURE_CLEANUP_TIMEOUT_MS}ms`;
        try {
          await collectCoverage(pending.file.projectName);
          // A cleanup timeout is a file failure, not a container failure. Resolve
          // this reload after reporting it so the headed serial loop advances.
          await handleTestFileComplete(
            createFileCleanupTimeoutResult({
              message,
              projectName: pending.file.projectName,
              result: pending.result,
              testPath: payload.testPath,
            }),
          );
          await recoverHeadedContainer();
          pending.deferred.resolve();
        } catch (error) {
          pending.deferred.reject(error);
        }
      })();
    }, FIXTURE_CLEANUP_TIMEOUT_MS);
  };

  const finishFileCleanup = (payload: FileCleanupDispatchPayload): void => {
    const pending = pendingHeadedReloads.get(payload.testPath);
    if (!pending || (payload.runId && pending.runId !== payload.runId)) {
      return;
    }
    if (pending.cleanupTimer) {
      clearTimeout(pending.cleanupTimer);
      pending.cleanupTimer = undefined;
    }
  };

  dispatchRouter.register(DISPATCH_NAMESPACE_FILE_CLEANUP, async (request) => {
    const payload = request.args as FileCleanupDispatchPayload;
    if (request.method === 'start') {
      startFileCleanupTimeout(payload);
    } else if (request.method === 'end') {
      finishFileCleanup(payload);
    }
  });

  // No execution-duration watchdog: per-test/hook timeouts are enforced inside
  // the runner, and a dead container is caught event-driven by the WebSocket
  // `close` handler, which rejects every pending reload via `onDisconnect`.
  const reloadTestFileAndWait = async (
    file: TestFileInfo,
    testNamePattern?: string,
  ): Promise<void> => {
    let reloadAck: ReloadTestFileAck | undefined;

    try {
      await v8Coverage?.start(containerPage);
      coverageStarted = Boolean(v8Coverage);
      reloadAck = await rpcManager.reloadTestFile(
        file.testPath,
        testNamePattern,
      );
      await registerPendingHeadedReload(file, reloadAck.runId);
    } catch (error) {
      if (reloadAck?.runId) {
        rejectPendingHeadedReload(
          file.testPath,
          toError(error),
          reloadAck.runId,
        );
      }
      if (coverageStarted) {
        await collectCoverage(file.projectName);
      }
      throw error;
    }
  };

  // The in-page rerun button is a watch trigger like any other, so once the
  // watch session exists it routes through core's cycle instead of reloading
  // the frame behind core's back. Until then (during the initial cycle) the
  // direct reload is all there is.
  let runUiRequestedRerun = async (
    file: TestFileInfo,
    testNamePattern?: string,
  ): Promise<void> => {
    await enqueueHeadedReload(file, testNamePattern);
  };

  // Create RPC methods that can access test state variables
  const createRpcMethods = (): HostRpcMethods => ({
    async rerunTest(testFile: string, testNamePattern?: string) {
      const projectName = context.normalizedConfig.name || 'project';
      const relativePath = relative(context.rootPath, testFile);
      const displayPath = `<${projectName}>/${relativePath}`;
      logger.log(
        color.cyan(
          `\nRe-running test: ${displayPath}${testNamePattern ? ` (pattern: ${testNamePattern})` : ''}\n`,
        ),
      );
      await runUiRequestedRerun(getTestFileInfo(testFile), testNamePattern);
    },
    async getTestFiles() {
      return currentTestFiles;
    },
    async onRunnerFramesReady(testFiles: string[]) {
      markRunnerFramesReady(testFiles);
    },
    async onTestFileStart(payload: TestFileStartPayload) {
      await handleTestFileStart(payload);
    },
    async onTestCaseResult(payload: TestResult) {
      await handleTestCaseResult(payload);
    },
    async onTestFileComplete(payload: HeadedTestFileCompletePayload) {
      if (
        payload.runId &&
        timedOutHeadedRuns.delete(`${payload.testPath}\0${payload.runId}`)
      ) {
        return;
      }
      try {
        const projectName = pendingHeadedReloads.get(payload.testPath)?.file
          .projectName;
        await collectCoverage(projectName);
        await handleTestFileComplete(payload);
        resolvePendingHeadedReload(payload.testPath, payload.runId);
      } catch (error) {
        rejectPendingHeadedReload(
          payload.testPath,
          toError(error),
          payload.runId,
        );
        throw error;
      }
    },
    async onLog(payload: LogPayload) {
      await handleLog(payload);
    },
    async onFatal(payload: FatalPayload) {
      const error = new Error(payload.message);
      error.stack = payload.stack;
      const pending = pendingHeadedReloads.values().next().value;
      const projectName = pending?.file.projectName;
      await collectCoverage(projectName);
      rejectAllPendingHeadedReloads(error);
      await handleFatal(payload);
    },
    async dispatch(request: BrowserDispatchRequest) {
      // Headed/container path now shares the same dispatch contract as headless.
      return dispatchRouter.dispatch(request);
    },
  });

  // Setup RPC manager
  let rpcManager: ContainerRpcManager;

  if (isWatchMode && runtime.rpcManager) {
    rpcManager = runtime.rpcManager;
    // Update methods with new test state (caseResults, completedTests, etc.)
    rpcManager.updateMethods(createRpcMethods(), rejectAllPendingHeadedReloads);
    // Reattach if we have an existing WebSocket
    const existingWs = rpcManager.currentWebSocket;
    if (existingWs) {
      rpcManager.reattach(existingWs);
    }
  } else {
    rpcManager = new ContainerRpcManager(
      wss,
      createRpcMethods(),
      rejectAllPendingHeadedReloads,
    );

    if (isWatchMode) {
      runtime.rpcManager = rpcManager;
    }
  }

  // Only navigate on first creation
  if (isNewPage) {
    await containerPage.goto(containerUrl, {
      waitUntil: 'load',
    });

    logger.log(color.cyan(`\nBrowser mode opened at ${containerUrl}\n`));
  }

  enqueueHeadedReload = async (
    file: TestFileInfo,
    testNamePattern?: string,
  ): Promise<void> => {
    return headedReloadQueue.enqueue(async () => {
      if (fatalErrorRef.current) {
        return;
      }
      await reloadTestFileAndWait(file, testNamePattern);
    });
  };

  let testTime = 0;
  if (currentTestFiles.length > 0) {
    const testStart = Date.now();
    try {
      await waitForRunnerFramesReady(
        currentTestFiles.map((file) => file.testPath),
      );

      for (const file of currentTestFiles) {
        await enqueueHeadedReload(file);
        if (fatalErrorRef.current) {
          break;
        }
      }
    } catch (error) {
      // The fatal error rides the returned result into the cycle outcome, and
      // core's `finalizeRunCycle` raises the exit code from it.
      fatalErrorRef.current = fatalErrorRef.current ?? toError(error);
    }

    testTime = Date.now() - testStart;
  }

  let watchSession: BrowserWatchSession | undefined;
  if (isWatchMode) {
    // Set by the in-page rerun trigger and consumed by the cycle that reloads
    // that file — the pattern is a headed-UI concept core's cycle options
    // cannot carry, so it travels beside the scope rather than inside it.
    // Keyed by test path rather than held in one slot: core queues cycles, so
    // an unrelated trigger can be dequeued between the click and its own cycle,
    // and a single slot would hand the pattern to whichever cycle ran first.
    // An entry is written with its own signal and read at a cycle's first
    // synchronous step, so the cycle that takes it is the one that signal
    // started — or, when the file was already in a queued scope, the one it
    // folded into, which is the cycle that runs the file. That holds as long as
    // nothing yields between the two: core closes the fold window and then
    // awaits `notifyReportersOnTestRunStart` before this cycle claims, so a user
    // reporter with an async `onTestRunStart` hook is the one thing that can
    // stretch the gap wide enough for another signal to land in it. A tracked
    // gap, not a choice: a second click on the same file inside that window
    // overwrites the entry, so the earlier cycle claims the newer pattern and
    // the later one finds it gone and reloads the file unfiltered. Closing it
    // means the pattern crossing the seam inside the queued cycle's own
    // options instead of traveling beside the scope.
    const pendingTestNamePatterns = new Map<string, string>();

    const runScope: Parameters<CreateBrowserWatchSession>[0] = async (
      testPaths,
    ) => {
      rawCoverage = [];
      // Claimed in this synchronous prefix, before `runCycle` suspends, so
      // nothing this cycle does can change what it runs or which patterns it
      // takes.
      const cycleScope = claimHeadedCycleScope(
        testPaths,
        currentTestFiles,
        pendingTestNamePatterns,
      );
      try {
        for (const { file, testNamePattern } of cycleScope) {
          await enqueueHeadedReload(file, testNamePattern);
        }
        return { rawCoverage };
      } catch (error) {
        return { rawCoverage, error: toError(error) };
      }
    };

    /**
     * Re-deliver the host config so runner iframes reloaded by the next cycle
     * observe live per-rerun values ('u' flips updateSnapshot between reruns);
     * `setContainerOptions` keeps full container reloads in sync.
     */
    const refreshHostConfig = async (): Promise<void> => {
      const refreshedHostOptions: BrowserHostConfig = {
        ...hostOptions,
        snapshot: {
          updateSnapshot: context.snapshotManager.options.updateSnapshot,
        },
      };
      runtime.setContainerOptions(refreshedHostOptions);
      await rpcManager.updateHostConfig(refreshedHostOptions);
    };

    watchSignals.setDispatchRerun(async () => {
      // Independent: config push to the container vs. local entry collection.
      const [, newProjectEntries] = await Promise.all([
        refreshHostConfig(),
        collectProjectEntries(),
      ]);
      const rerunPlan = planWatchRerun({
        projectEntries: newProjectEntries,
        previousTestFiles: watchState.lastTestFiles,
        affectedTestFiles: drainPendingAffectedTestFiles(watchState),
      });

      commitWatchFileSetUpdate(
        rerunPlan.fileSetUpdate,
        watchState,
        (deletedTestPaths) =>
          context.updateReporterResultState([], [], deletedTestPaths),
      );

      if (rerunPlan.fileSetUpdate) {
        currentTestFiles = rerunPlan.fileSetUpdate.currentTestFiles;
        await rpcManager.notifyTestFileUpdate(currentTestFiles);
        if (currentTestFiles.length > 0) {
          await waitForRunnerFramesReady(
            currentTestFiles.map((file) => file.testPath),
          );
        }
      }

      logger.log(color.cyan(rerunPlan.decision.message));
      if (rerunPlan.decision.kind === 'idle') {
        logWatchReady();
        return;
      }

      await watchSignals.signalInvalidation(
        rerunPlan.decision.kind === 'empty' ? [] : rerunPlan.decision.testPaths,
      );
    });

    runUiRequestedRerun = async (file, testNamePattern) => {
      await refreshHostConfig();
      await watchSignals.signalInvalidation([file.testPath], () => {
        if (testNamePattern === undefined) {
          pendingTestNamePatterns.delete(normalize(file.testPath));
        } else {
          pendingTestNamePatterns.set(
            normalize(file.testPath),
            testNamePattern,
          );
        }
      });
      await watchSignals.awaitSignalledCycle();
    };

    watchSession = createWatchSession(runScope);
  }

  const closeContainerRuntime = !isWatchMode
    ? async () => {
        try {
          await containerPage.close();
        } catch {
          // ignore
        }
        try {
          await containerContext.close();
        } catch {
          // ignore
        }
        await destroyRuntime();
      }
    : undefined;

  return {
    testTime,
    rawCoverage,
    watchSession,
    // `closeContainerRuntime` is already `undefined` in watch mode: the watch
    // runtime outlives the cycle and is torn down through `executor.close()`.
    close: closeContainerRuntime,
  };
};
