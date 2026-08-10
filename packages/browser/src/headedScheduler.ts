import type {
  RstestContext,
  TestFileResult,
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
import { createHeadedRunRegistry } from './headedRunRegistry';
import { createHeadedSerialTaskQueue } from './headedSerialTaskQueue';
import { type FatalPayload, toError } from './hostPayloads';
import type {
  BrowserDispatchRequest,
  BrowserHostConfig,
  FileCleanupDispatchPayload,
  TestFileInfo,
} from './protocol';
import {
  DISPATCH_NAMESPACE_FILE_CLEANUP,
  DISPATCH_NAMESPACE_RUNNER,
} from './protocol';
import type { BrowserProviderContext, BrowserProviderPage } from './providers';
import { commitWatchFileSetUpdate, planWatchRerun } from './watchRerunPlanner';
import type {
  BrowserV8CoverageRuntime,
  BrowserWatchSession,
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
  v8Coverage?: BrowserV8CoverageRuntime;
  projectRoots: Map<string, string>;
  isWatchMode: boolean;
  createDispatchRouter: () => HostDispatchRouter;
  handlers: {
    // For the one result the host authors itself (the cleanup-timeout
    // failure); every runner-authored result flows through the dispatch
    // router instead.
    handleTestFileComplete: (payload: TestFileResult) => Promise<void>;
  };
  fatalErrorRef: { current: Error | null };
  watchSignals: Pick<WatchSignals, 'setDispatchRerun' | 'signalInvalidation'>;
  setDispatchPageResolver: (resolver: DispatchPageResolver) => void;
  createWatchSession: (
    execute: (testPaths: string[]) => Promise<unknown[]>,
  ) => BrowserWatchSession;
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
  handlers: { handleTestFileComplete },
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

  // `watchState.headedFileSetVersion` is the committed file set's monotonic
  // version, acked by the container once its frame set for that version is in
  // the DOM. A counter only increases, so a stale ack can never satisfy a
  // newer wait (the content signature it replaces could ABA back to a
  // previously-acked value).
  let ackedFrameSetVersion = 0;
  type FrameSetWaiter = {
    version: number;
    resolve: () => void;
    timeoutId: NodeJS.Timeout;
  };
  const frameSetWaiters = new Set<FrameSetWaiter>();

  const markFrameSetReady = (version: number): void => {
    // An ack above anything ever sent can only be a previous session's late
    // echo on the reused socket — accepting it would let every future wait
    // short-circuit.
    if (version > watchState.headedFileSetVersion) {
      return;
    }
    if (version > ackedFrameSetVersion) {
      ackedFrameSetVersion = version;
    }
    for (const waiter of frameSetWaiters) {
      if (waiter.version <= ackedFrameSetVersion) {
        clearTimeout(waiter.timeoutId);
        frameSetWaiters.delete(waiter);
        waiter.resolve();
      }
    }
  };

  const waitForFrameSet = async (version: number): Promise<void> => {
    if (ackedFrameSetVersion >= version) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const waiter: FrameSetWaiter = {
        version,
        resolve,
        timeoutId: setTimeout(() => {
          frameSetWaiters.delete(waiter);
          reject(
            new Error(
              `Timed out waiting for headed runner frames to be ready (file-set version ${version}).`,
            ),
          );
        }, RUNNER_FRAMES_READY_TIMEOUT_MS),
      };
      frameSetWaiters.add(waiter);
    });
  };

  const findTestFileInfo = (testFile: string): TestFileInfo | undefined => {
    const normalizedTestFile = normalize(testFile);
    return currentTestFiles.find(
      (file) => file.testPath === normalizedTestFile,
    );
  };

  const getTestFileInfo = (testFile: string): TestFileInfo => {
    const fileInfo = findTestFileInfo(testFile);
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
        return;
      }
      // The runner logs nothing before its config handshake, so a frame that
      // dies during load is indistinguishable from one that never navigated.
      // Keep non-protocol output reachable under `--debug`.
      logger.debug(`[Browser Console] ${text}`);
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
  let enqueueHeadedReload = async (
    _file: TestFileInfo,
    _testNamePattern?: string,
  ): Promise<void> => {
    throw new Error('Headed reload queue is not initialized');
  };

  const isCurrentTestFile = (testPath: string): boolean =>
    findTestFileInfo(testPath) !== undefined;

  // The settlement contract — every run settles exactly once, and any host
  // action that makes a completion impossible settles it — lives in the
  // registry. It survives controller re-entry on the runtime's watch state,
  // so a re-entering scheduler cannot orphan the previous entry's runs.
  const runs = (watchState.headedRuns ??= createHeadedRunRegistry());

  // A wedged cleanup does not stay its own problem: every runner iframe and
  // the container are same-site, so they share one renderer process, and a
  // synchronous busy-loop in one document freezes the whole tab — no sibling
  // frame can boot until the page itself is replaced. Recovery therefore
  // tears down the container context and boots a fresh one; the frame-set
  // ack is reset because the old ack belongs to the destroyed page.
  const recoverHeadedContainer = async (): Promise<void> => {
    ackedFrameSetVersion = 0;
    await containerContext.close().catch(() => {});
    const created = await createContainerPage();
    containerContext = created.context;
    containerPage = created.page;
    if (isWatchMode) {
      runtime.containerPage = containerPage;
      runtime.containerContext = containerContext;
    }
    await containerPage.goto(containerUrl, { waitUntil: 'load' });
    await waitForFrameSet(watchState.headedFileSetVersion);
  };

  // The runner announces its fixture-cleanup window over the `file-cleanup`
  // namespace (already past the dispatch gate, so the run is live). The
  // deadline itself lives in the registry beside the boot deadline, and its
  // expiry claims the run before this handler starts: the recovery below
  // kills the container transport, and an unclaimed run would be swept by
  // that very disconnect. Settling waits until the new container is ready —
  // it is what releases the serial loop, and the next reload must find a
  // living page. The wedged document's late messages find their run claimed
  // (terminal) or gone and drop at the gate — no tombstone needed.
  dispatchRouter.register(DISPATCH_NAMESPACE_FILE_CLEANUP, async (request) => {
    const { runId } = request;
    if (!runId) {
      return;
    }
    if (request.method === 'start') {
      const payload = request.args as FileCleanupDispatchPayload;
      runs.armCleanupDeadline(runId, FIXTURE_CLEANUP_TIMEOUT_MS, () => {
        void (async () => {
          try {
            // A cleanup timeout is a file failure, not a container failure:
            // report it, recover, then settle so the serial loop advances.
            await handleTestFileComplete(
              createFileCleanupTimeoutResult({
                message: `File fixture cleanup did not finish within ${FIXTURE_CLEANUP_TIMEOUT_MS}ms`,
                projectName: payload.projectName,
                result: payload.result,
                testPath: payload.testPath,
              }),
            );
            await recoverHeadedContainer();
            runs.resolve(runId);
          } catch (error) {
            runs.reject(runId, toError(error));
          }
        })();
      });
    } else if (request.method === 'end') {
      runs.disarmCleanupDeadline(runId);
    }
  });

  // No execution-duration watchdog: per-test/hook timeouts are enforced inside
  // the runner, a dead container is caught event-driven by the WebSocket
  // `close` handler / transport epoch, and a host action that makes a
  // completion impossible settles the run itself (`runs.retainPaths`).
  const reloadTestFileAndWait = async (
    file: TestFileInfo,
    testNamePattern?: string,
  ): Promise<void> => {
    // Mint + register are one synchronous step BEFORE the RPC leaves the
    // process: no file-set commit or inbound message can land between "the
    // run exists on the wire" and "the registry owns it".
    const { runId, settled } = runs.mint(file.testPath);
    // The wait is on `settled` ALONE, never serially on the RPC: the host
    // birpc has no timeout, so a reload delivery that silently hangs (socket
    // looks open, no close event, no replacement) would otherwise block this
    // cycle past every deadline the registry enforces. The RPC's only job is
    // delivery — its failure settles the run like any other settler, and if
    // the run was already settled (boot deadline, transport epoch) the late
    // rejection is a no-op.
    rpcManager
      .reloadTestFile(file.testPath, runId, testNamePattern)
      .catch((error) => runs.reject(runId, error));
    await settled;
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
      return {
        files: currentTestFiles,
        version: watchState.headedFileSetVersion,
      };
    },
    async onFrameSetReady(version: number) {
      markFrameSetReady(version);
    },
    /**
     * The ONE inbound gate for everything a runner document produces —
     * lifecycle messages and browser/snapshot RPCs alike. A message is
     * accepted iff its stamped runId names a live run; path lookups, frame
     * lookups and fallback identities do not exist here, so a completion
     * already in transport when its run was closed simply finds its runId
     * gone and drops.
     *
     * The terminal methods ("file-complete", "fatal") also settle the run:
     * `admit` claims settlement synchronously, before the handler's first
     * await, so a file-set commit racing the handler cannot settle it a
     * second time. A handler failure rejects the run — `dispatchRouter`
     * catches handler errors into `response.error` rather than throwing, and
     * a reporter/snapshot-ingest failure must ride the cycle outcome, not
     * vanish into a response the runner discards.
     */
    async dispatch(request: BrowserDispatchRequest) {
      const { method, runId } = request;
      const isTerminal =
        request.namespace === DISPATCH_NAMESPACE_RUNNER &&
        (method === 'file-complete' || method === 'fatal');
      if (!runId || !runs.admit(runId, isTerminal)) {
        logger.debug(
          `[Headed] Dropped stale "${method}" from run ${runId ?? '(none)'}`,
        );
        return { requestId: request.requestId, stale: true };
      }
      const response = await dispatchRouter.dispatch(request);
      if (!isTerminal) {
        return response;
      }
      if (method === 'file-complete') {
        if (response.error) {
          runs.reject(runId, new Error(response.error));
        } else {
          runs.resolve(runId);
        }
      } else {
        // A fatal settles its OWN run; sibling runs and the watch session
        // survive. The cycle still fails through `fatalErrorRef`, which the
        // routed handler just set.
        const payload = request.args as FatalPayload | undefined;
        const error = new Error(payload?.message ?? 'Fatal browser error');
        if (payload?.stack) {
          error.stack = payload.stack;
        }
        runs.reject(runId, error);
      }
      return response;
    },
  });

  // Setup RPC manager
  let rpcManager: ContainerRpcManager;

  if (isWatchMode && runtime.rpcManager) {
    rpcManager = runtime.rpcManager;
    // Update methods with new test state (caseResults, completedTests, etc.)
    rpcManager.updateMethods(
      createRpcMethods(),
      runs.rejectAll,
      runs.setTransportEpoch,
    );
    // Reattach if we have an existing WebSocket
    const existingWs = rpcManager.currentWebSocket;
    if (existingWs) {
      rpcManager.reattach(existingWs);
    }
  } else {
    rpcManager = new ContainerRpcManager(
      wss,
      createRpcMethods(),
      runs.rejectAll,
      runs.setTransportEpoch,
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
      // `claimHeadedCycleScope` checks membership once per cycle, but the queue
      // spans cycles and `dispatchRerun` commits a new set between them —
      // granting a run to a file whose frame is gone would only burn the boot
      // deadline. (The set can change again during the reload itself;
      // `runs.retainPaths` settles that run at the commit.)
      if (!isCurrentTestFile(file.testPath)) {
        logger.debug(
          `[Browser UI] Skipping reload for removed test file: ${file.testPath}`,
        );
        return;
      }
      await reloadTestFileAndWait(file, testNamePattern);
    });
  };

  let testTime = 0;
  if (currentTestFiles.length > 0) {
    const testStart = Date.now();
    try {
      // A container connected before this scheduler existed (controller
      // re-entry on the persistent runtime) never re-pulls `getTestFiles`, so
      // push the set — the commit effect acks the version either way.
      if (rpcManager.isConnected) {
        await rpcManager.notifyTestFileUpdate(
          currentTestFiles,
          watchState.headedFileSetVersion,
        );
      }
      await waitForFrameSet(watchState.headedFileSetVersion);

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

    const runScope = async (testPaths: string[]): Promise<unknown[]> => {
      rawCoverage = [];
      // Claimed in this synchronous prefix, before `runCycle` suspends, so
      // nothing this cycle does can change what it runs or which patterns it
      // takes.
      const cycleScope = claimHeadedCycleScope(
        testPaths,
        currentTestFiles,
        pendingTestNamePatterns,
      );
      for (const { file, testNamePattern } of cycleScope) {
        await enqueueHeadedReload(file, testNamePattern);
      }
      return rawCoverage;
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

    const runDispatchRerunOnce = async (): Promise<void> => {
      // Exactly one of `signalInvalidation` / `logWatchReady` must run on
      // every exit path: a rejection escaping after the file-set commit (for
      // example the frame-set wait timing out) would otherwise leave watch
      // committed but never signalled — silently dead, with no error and no
      // disconnect to show for it.
      try {
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
          const version = (watchState.headedFileSetVersion += 1);
          // Must run before the container is told: `notifyTestFileUpdate` is
          // what unmounts the dropped iframes, and their runs must already be
          // settled (and out of the registry) when that happens.
          runs.retainPaths(currentTestFiles.map((file) => file.testPath));
          await rpcManager.notifyTestFileUpdate(currentTestFiles, version);
          if (currentTestFiles.length > 0) {
            await waitForFrameSet(version);
          }
        }

        logger.log(color.cyan(rerunPlan.decision.message));
        if (rerunPlan.decision.kind === 'idle') {
          logWatchReady();
          return;
        }

        await watchSignals.signalInvalidation(
          rerunPlan.decision.kind === 'empty'
            ? []
            : rerunPlan.decision.testPaths,
        );
      } catch (error) {
        logWatchReady();
        throw error;
      }
    };

    // Serialized against itself: each per-project compiler fires its own
    // `onAfterDevCompile`, and two interleaved planning passes would race on
    // the drain-once affected set and the file-set commit.
    const dispatchRerunQueue = createHeadedSerialTaskQueue();
    watchSignals.setDispatchRerun(() =>
      dispatchRerunQueue.enqueue(runDispatchRerunOnce),
    );

    runUiRequestedRerun = async (file, testNamePattern) => {
      await refreshHostConfig();
      const { cycle } = await watchSignals.signalInvalidation(
        [file.testPath],
        () => {
          if (testNamePattern === undefined) {
            pendingTestNamePatterns.delete(normalize(file.testPath));
          } else {
            pendingTestNamePatterns.set(
              normalize(file.testPath),
              testNamePattern,
            );
          }
        },
      );
      // Await the cycle THIS signal started — not whichever signal last wrote
      // the shared slot, which a concurrent rebuild trigger can overwrite
      // between the signal and the wait.
      await cycle;
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
