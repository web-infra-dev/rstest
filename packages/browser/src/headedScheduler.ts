import type {
  InternalContext,
  RawTestFileResult,
} from '@rstest/core/internal/browser';
import {
  color,
  createFileCleanupTimeoutResult,
  FIXTURE_CLEANUP_TIMEOUT_MS,
  logger,
} from '@rstest/core/internal/browser';
import { normalize, relative } from 'pathe';
import type { SnapshotUpdateState } from '@vitest/snapshot';
import { getTestPathKey } from './pathUtils';
import type { BrowserRuntime } from './browserRsbuild';
import type { ConcurrencyLimiter } from './concurrencyLimiter';
import { ContainerRpcHub, type HostRpcMethods } from './containerRpc';
import type { HostDispatchRouter } from './dispatchRouter';
import { createHeadedRunRegistry } from './headedRunRegistry';
import { createSerialTaskQueue } from './serialTaskQueue';
import { type FatalPayload, toError } from './hostPayloads';
import type {
  BrowserDispatchRequest,
  BrowserHostConfig,
  BrowserProjectRuntime,
  FileCleanupDispatchPayload,
  TestFileInfo,
} from './protocol';
import {
  DISPATCH_NAMESPACE_FILE_CLEANUP,
  DISPATCH_NAMESPACE_RUNNER,
  toWireRow,
} from './protocol';
import type {
  BrowserProviderBrowser,
  BrowserProviderContext,
  BrowserProviderPage,
} from './providers';
import type {
  BrowserV8CoverageRuntime,
  DispatchPageResolver,
  HeadedLaneResult,
} from './schedulerSeam';
import type { WatchSignals } from './watchSignals';

type HeadedSchedulerContext = Pick<
  InternalContext,
  'rootPath' | 'snapshotManager'
> & {
  normalizedConfig: Pick<InternalContext['normalizedConfig'], 'name'>;
};

type HeadedSchedulerDeps = {
  context: HeadedSchedulerContext;
  runtime: BrowserRuntime;
  /**
   * The headed `(project, browser)` row this container window owns. Each
   * headed row gets its own container window, RPC session, run registry, and
   * reload queue, while rows sharing a launch key reuse one Playwright browser
   * process via `runtime.launchPool`.
   */
  headedRow: BrowserProjectRuntime;
  /** Multi-lane runs only: the budget shared across all active lanes. */
  fileLimiter?: ConcurrencyLimiter;
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
    handleTestFileComplete: (payload: RawTestFileResult) => Promise<void>;
  };
  fatalErrorRef: { current: Error | null };
  watchSignals: Pick<WatchSignals, 'addInterrupt' | 'addAbort'>;
  setDispatchPageResolver: (
    containerId: string,
    resolver: DispatchPageResolver,
  ) => void;
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
    currentTestFiles.map((file) => [getTestPathKey(file.testPath), file]),
  );
  for (const testPath of testPaths) {
    const normalizedTestPath = getTestPathKey(testPath);
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

const sameTestPaths = (
  a: readonly TestFileInfo[],
  b: readonly TestFileInfo[],
): boolean =>
  a.length === b.length &&
  a.every((file, index) => file.testPath === b[index]!.testPath);

export const createHeadedScheduler = async ({
  context,
  runtime,
  headedRow,
  fileLimiter,
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
}: HeadedSchedulerDeps): Promise<HeadedLaneResult> => {
  const { watchState, wss } = runtime;
  const containerId = headedRow.instanceName;
  // A headed launch is pinned in the pool (never evicted, outside the headless
  // cap), so this lease is held until the runtime closes the pool and never
  // released. Multiple headed rows sharing a launch key share one browser
  // process while keeping independent contexts/windows.
  let headedBrowser: BrowserProviderBrowser | undefined;
  const headedHostOptions: BrowserHostConfig = {
    ...hostOptions,
    containerId,
    projects: [toWireRow(headedRow)],
  };
  runtime.setContainerOptions(headedHostOptions, containerId);
  const containerUrl = `http://localhost:${runtime.containerServer.port}/?containerId=${encodeURIComponent(containerId)}`;
  // Each headed lane runs its row's project only and stamps each file with its
  // browserName so the container forwards it in the iframe options.
  const stampLaneFiles = (
    files: readonly { testPath: string; projectName: string }[],
  ): TestFileInfo[] =>
    files
      .filter((file) => file.projectName === headedRow.name)
      .map((file) => ({
        testPath: file.testPath,
        projectName: file.projectName,
        browserName: headedRow.browserName,
      }));
  let currentTestFiles = stampLaneFiles(allTestFiles);
  // Coincidentally equal to the runner-side CONFIG_WAIT_TIMEOUT_MS and
  // DEFAULT_RPC_TIMEOUT_MS (client/runner.ts, client/dispatchTransport.ts) but
  // semantically distinct and in a different runtime, so deliberately NOT shared
  // with them. Invariant worth preserving: a runner must be able to receive its
  // config (config-wait) before the host declares its frames un-ready, i.e.
  // CONFIG_WAIT_TIMEOUT_MS <= RUNNER_FRAMES_READY_TIMEOUT_MS.
  const RUNNER_FRAMES_READY_TIMEOUT_MS = 30_000;

  let containerState = isWatchMode
    ? watchState.headedContainers.get(containerId)
    : undefined;
  if (!containerState) {
    containerState = {
      runs: createHeadedRunRegistry(),
      fileSetVersion: 1,
    };
    if (isWatchMode) {
      watchState.headedContainers.set(containerId, containerState);
    }
  }
  const runs = containerState.runs;

  // `containerState.fileSetVersion` is the committed file set's monotonic
  // version, acked by this container once its frame set for that version is in
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
    if (version > containerState.fileSetVersion) {
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
    headedBrowser ??= (await runtime.launchPool.acquire(headedRow.launchKey))
      .browser;
    const nextContext = await headedBrowser.newContext({
      providerOptions: headedRow.providerOptions,
      viewport: null,
    });
    const nextPage = await nextContext.newPage();
    attachContainerPageHandlers(nextContext, nextPage);
    return { context: nextContext, page: nextPage };
  };

  if (isWatchMode && containerState.page && containerState.context) {
    containerContext = containerState.context;
    containerPage = containerState.page;
    logger.log(
      color.gray(
        `\n[Watch] Reusing existing container page (${containerId})\n`,
      ),
    );
  } else {
    isNewPage = true;
    const created = await createContainerPage();
    containerContext = created.context;
    containerPage = created.page;

    if (isWatchMode) {
      containerState.page = containerPage;
      containerState.context = containerContext;
    }
  }

  setDispatchPageResolver(containerId, (_target, runId) => {
    if (!runId) {
      return { containerPage };
    }
    return runs.has(runId)
      ? {
          containerPage,
          isRunCurrent: () => runs.isCurrent(runId),
        }
      : {};
  });

  const dispatchRouter = createDispatchRouter();
  const headedReloadQueue = createSerialTaskQueue();
  let rawCoverage: unknown[] = [];
  // The session's project is recorded at start rather than re-derived at each
  // take site: headed reloads are strictly serial, so at most one coverage
  // session exists, and it belongs to the run that started it — not to
  // whatever payload happens to be in hand when it is taken.
  let coverageProject: string | undefined;
  let coverageStarted = false;
  const startCoverage = async (projectName?: string): Promise<void> => {
    if (!v8Coverage) {
      return;
    }
    await v8Coverage.start(containerPage);
    coverageStarted = true;
    coverageProject = projectName;
  };
  const collectCoverage = async (): Promise<void> => {
    if (!coverageStarted || !v8Coverage) {
      return;
    }
    coverageStarted = false;
    const coverage = await v8Coverage.take(
      containerPage,
      projectRoots.get(coverageProject ?? '') ?? context.rootPath,
      coverageProject,
    );
    if (coverage) {
      rawCoverage.push(coverage);
    }
  };
  let enqueueHeadedReload = async (
    _file: TestFileInfo,
    _testNamePattern?: string,
    _generation?: number,
  ): Promise<void> => {
    throw new Error('Headed reload queue is not initialized');
  };

  const isCurrentTestFile = (testPath: string): boolean =>
    findTestFileInfo(testPath) !== undefined;

  let aborted = false;
  let cycleGeneration = 0;
  // Skipping queued files in a superseded cycle lets the replacement watch
  // cycle start right after the currently running iframe finishes instead of
  // draining stale files first.
  watchSignals.addInterrupt(() => {
    cycleGeneration += 1;
  });
  // Dropping every retained path and marking the current frame set ready
  // settles everything the cycle is waiting on, so it unwinds instead of
  // hanging on a container that is about to go away. `aborted` keeps the
  // teardown errors that follow from being reported as a fatal run failure.
  watchSignals.addAbort(() => {
    aborted = true;
    runs.retainPaths([]);
    markFrameSetReady(containerState.fileSetVersion);
  });

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
      containerState.page = containerPage;
      containerState.context = containerContext;
    }
    await containerPage.goto(containerUrl, { waitUntil: 'load' });
    await waitForFrameSet(containerState.fileSetVersion);
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
    if (request.method === 'start' || request.method === 'worker-start') {
      const payload = request.args as FileCleanupDispatchPayload;
      runs.armCleanupDeadline(runId, FIXTURE_CLEANUP_TIMEOUT_MS, () => {
        void (async () => {
          try {
            // The page may be synchronously blocked by the cleanup callback.
            // Coverage collection talks to that same renderer and can never
            // return in that state, so recover first and intentionally omit
            // the incomplete coverage sample for this file.
            await recoverHeadedContainer();
            await handleTestFileComplete(
              createFileCleanupTimeoutResult({
                message: `File fixture cleanup did not finish within ${FIXTURE_CLEANUP_TIMEOUT_MS}ms`,
                // The headed lane runs one row: the payload names it.
                projectName: headedRow.instanceName,
                result: payload.result,
                testPath: payload.testPath,
              }),
            );
            runs.resolve(runId);
          } catch (error) {
            runs.reject(runId, toError(error));
          }
        })();
      });
    } else if (request.method === 'end' || request.method === 'worker-end') {
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
    // The coverage session opens before the run exists: a start failure must
    // surface as a cycle error, and a minted run it could never serve would
    // only burn the boot deadline.
    await startCoverage(file.projectName);
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
    rpcSession
      .reloadTestFile(file.testPath, runId, testNamePattern)
      .catch((error) => runs.reject(runId, error));
    try {
      await settled;
    } finally {
      // A settlement that skipped the terminal gate (file-set commit, boot
      // deadline, transport death) leaves the session running; flush it so
      // the next file's start opens on a clean session. A no-op when the
      // gate already took it, and best-effort by design: the settlement
      // outcome — success or the error propagating past this block — is the
      // truth about the run, and a take failure here must not replace it.
      await collectCoverage().catch((error) => {
        logger.debug(`[Headed] Failed to flush coverage: ${error}`);
      });
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
      const relativePath = relative(context.rootPath, testFile);
      const displayPath = `<${headedRow.instanceName}>/${relativePath}`;
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
        version: containerState.fileSetVersion,
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
      // The coverage session ends with the run that started it, taken while
      // the admitted run still holds the page. A take failure must not wedge
      // the claimed run: it settles below exactly like a handler failure.
      let coverageError: Error | undefined;
      if (isTerminal) {
        try {
          await collectCoverage();
        } catch (error) {
          coverageError = toError(error);
        }
      }
      const response = await dispatchRouter.dispatch(request);
      if (!isTerminal) {
        return response;
      }
      if (method === 'file-complete') {
        const failure =
          coverageError ??
          (response.error ? new Error(response.error) : undefined);
        if (failure) {
          runs.reject(runId, failure);
        } else {
          runs.resolve(runId);
        }
      } else {
        if (coverageError) {
          // The fatal outranks it for the cycle outcome; anything but a log
          // line would displace the error that actually killed the run.
          logger.error(
            `[Headed] Failed to take coverage during fatal handling: ${coverageError.message}`,
          );
        }
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

  // Register this container's RPC session on the runtime's shared WebSocket hub.
  const rpcHub = (runtime.rpcHub ??= new ContainerRpcHub(wss));
  const rpcSession = rpcHub.register(
    containerId,
    createRpcMethods(),
    runs.rejectAll,
    runs.setTransportEpoch,
  );

  // Only navigate on first creation
  if (isNewPage) {
    await containerPage.goto(containerUrl, {
      waitUntil: 'load',
    });

    logger.log(
      color.cyan(
        `\nBrowser mode opened at ${containerUrl} (${headedRow.instanceName})\n`,
      ),
    );
  }

  const isReloadStopped = (generation?: number): boolean =>
    aborted ||
    Boolean(fatalErrorRef.current) ||
    (generation !== undefined && generation !== cycleGeneration);

  enqueueHeadedReload = async (
    file: TestFileInfo,
    testNamePattern?: string,
    generation?: number,
  ): Promise<void> => {
    return headedReloadQueue.enqueue(async () => {
      if (isReloadStopped(generation)) {
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
      // Multi-lane runs share one file budget, so the headed file runs only
      // once a slot is free.
      const release = await fileLimiter?.acquire();
      try {
        if (isReloadStopped(generation)) {
          return;
        }
        await reloadTestFileAndWait(file, testNamePattern);
      } finally {
        release?.();
      }
    });
  };

  let testTime = 0;
  if (currentTestFiles.length > 0) {
    const testStart = Date.now();
    const initialGeneration = cycleGeneration;
    try {
      // A container connected before this scheduler existed (controller
      // re-entry on the persistent runtime) never re-pulls `getTestFiles`, so
      // push the set — the commit effect acks the version either way.
      if (rpcSession.isConnected) {
        await rpcSession.notifyTestFileUpdate(
          currentTestFiles,
          containerState.fileSetVersion,
        );
      }
      await waitForFrameSet(containerState.fileSetVersion);

      for (const file of currentTestFiles) {
        await enqueueHeadedReload(file, undefined, initialGeneration);
        if (isReloadStopped(initialGeneration)) {
          break;
        }
      }
    } catch (error) {
      // The fatal error rides the returned result into the cycle outcome, and
      // core's `finalizeRunCycle` raises the exit code from it.
      // The abort guard protects the reported outcome, not the max-only exit
      // code: the signal registrar has already raised that to 128 + signal.
      if (!aborted) {
        fatalErrorRef.current = fatalErrorRef.current ?? toError(error);
      }
    }

    testTime = Date.now() - testStart;
  }

  // Per-file test-name pattern set by the in-page rerun trigger and consumed
  // synchronously at the top of the cycle that reloads that file.
  const pendingTestNamePatterns = new Map<string, string>();

  /**
   * Re-deliver the host config so runner iframes reloaded by the next cycle
   * observe live per-rerun values ('u' flips updateSnapshot between reruns);
   * `setContainerOptions` keeps full container reloads in sync.
   */
  const refreshHostConfig = async (
    updateSnapshot: SnapshotUpdateState,
  ): Promise<void> => {
    const refreshedHostOptions: BrowserHostConfig = {
      ...headedHostOptions,
      snapshot: {
        updateSnapshot,
      },
    };
    runtime.setContainerOptions(refreshedHostOptions, containerId);
    await rpcSession.updateHostConfig(refreshedHostOptions);
  };

  const runScope = async (
    testPaths: string[],
    updateSnapshot: SnapshotUpdateState,
  ): Promise<unknown[]> => {
    await refreshHostConfig(updateSnapshot);
    rawCoverage = [];
    const generation = cycleGeneration;
    // Claimed in this synchronous prefix, before reloading suspends, so
    // nothing this cycle does can change what it runs or which patterns it
    // takes.
    const cycleScope = claimHeadedCycleScope(
      testPaths,
      currentTestFiles,
      pendingTestNamePatterns,
    );
    for (const { file, testNamePattern } of cycleScope) {
      await enqueueHeadedReload(file, testNamePattern, generation);
      if (isReloadStopped(generation)) {
        break;
      }
    }
    return rawCoverage;
  };

  const syncFileSet = async (
    allCurrentTestFiles: readonly TestFileInfo[],
  ): Promise<void> => {
    const nextFiles = stampLaneFiles(allCurrentTestFiles);
    if (sameTestPaths(currentTestFiles, nextFiles)) {
      return;
    }
    currentTestFiles = nextFiles;
    const version = (containerState.fileSetVersion += 1);
    // Must run before the container is told: `notifyTestFileUpdate` is
    // what unmounts the dropped iframes, and their runs must already be
    // settled (and out of the registry) when that happens.
    runs.retainPaths(currentTestFiles.map((file) => file.testPath));
    await rpcSession.notifyTestFileUpdate(currentTestFiles, version);
    if (currentTestFiles.length > 0) {
      await waitForFrameSet(version);
    }
  };

  const setPendingTestNamePattern = (
    testPath: string,
    testNamePattern?: string,
  ): void => {
    const key = getTestPathKey(testPath);
    if (testNamePattern === undefined) {
      pendingTestNamePatterns.delete(key);
    } else {
      pendingTestNamePatterns.set(key, testNamePattern);
    }
  };

  const setUiRerunHandler = (
    handler: (file: TestFileInfo, testNamePattern?: string) => Promise<void>,
  ): void => {
    runUiRequestedRerun = handler;
  };

  const closeContainerLane = !isWatchMode
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
      }
    : undefined;

  return {
    containerId,
    row: headedRow,
    testTime,
    rawCoverage,
    runScope,
    syncFileSet,
    setPendingTestNamePattern,
    setUiRerunHandler,
    close: closeContainerLane,
  };
};
