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
import type { SnapshotUpdateState } from '@vitest/snapshot';
import { getTestPathKey } from './pathUtils';
import { createSerialTaskQueue } from './serialTaskQueue';
import {
  type BrowserProjectServer,
  type BrowserRuntime,
  drainPendingAffectedTestFiles,
  resolveViewport,
  serializeForInlineScript,
} from './browserRsbuild';
import { getHeadlessConcurrency } from './concurrency';
import type { ConcurrencyLimiter } from './concurrencyLimiter';
import type { LaunchLease, LaunchPool } from './launchPool';
import type { HostDispatchRouterOptions } from './dispatchCapabilities';
import type { HostDispatchRouter } from './dispatchRouter';
import {
  attachHeadlessRunnerTransport,
  type HeadlessRunnerTransportHandlers,
} from './headlessTransport';
import {
  createDeferredPromise,
  type FatalPayload,
  toError,
} from './hostPayloads';
import type {
  BrowserClientMessage,
  BrowserDispatchRequest,
  BrowserDispatchResponse,
  BrowserHostConfig,
  BrowserProjectRuntime,
  FileCleanupDispatchPayload,
  RunnerEnvelope,
  TestFileInfo,
} from './protocol';
import {
  DISPATCH_NAMESPACE_FILE_CLEANUP,
  DISPATCH_NAMESPACE_RUNNER,
  getFileTaskId,
  RSTEST_CONFIG_MESSAGE_TYPE,
  toWireRow,
} from './protocol';
import type { BrowserProviderContext, BrowserProviderPage } from './providers';
import {
  createRunSession,
  type RunSession,
  RunSessionLifecycle,
} from './runSession';
import { RunnerSessionRegistry } from './sessionRegistry';
import { commitWatchFileSetUpdate, planWatchRerun } from './watchRerunPlanner';
import {
  expandToRows,
  groupRowsByProject,
  type BrowserV8CoverageRuntime,
  type BrowserWatchSession,
  type DispatchLanes,
  type ScheduledTestFile,
  type SchedulerRunResult,
} from './schedulerSeam';
import type { WatchSignals } from './watchSignals';

type HeadlessSchedulerContext = Pick<
  InternalContext,
  'command' | 'rootPath' | 'snapshotManager' | 'stateManager'
> & {
  normalizedConfig: Pick<InternalContext['normalizedConfig'], 'bail' | 'pool'>;
};

type HeadlessSchedulerDeps = {
  context: HeadlessSchedulerContext;
  /** Leases each row's browser by launch key (see `BrowserRuntime.launchPool`). */
  launchPool: LaunchPool;
  projectServers: BrowserRuntime['projectServers'];
  v8Coverage?: BrowserV8CoverageRuntime;
  allTestFiles: TestFileInfo[];
  projectRuntimeConfigs: BrowserProjectRuntime[];
  /** Mixed runs only: the budget shared with the headed lane. */
  fileLimiter?: ConcurrencyLimiter;
  hostOptions: BrowserHostConfig;
  watchState: BrowserRuntime['watchState'];
  isWatchMode: boolean;
  createDispatchRouter: (
    options?: HostDispatchRouterOptions,
  ) => HostDispatchRouter;
  handlers: {
    handleFatal: (payload: FatalPayload) => Promise<void>;
    handleTestFileComplete: (payload: RawTestFileResult) => Promise<void>;
  };
  watchSignals: Pick<
    WatchSignals,
    | 'setDispatchRerun'
    | 'setInterrupt'
    | 'signalInvalidation'
    | 'queueInvalidationAfter'
  >;
  setDispatchPageResolver: (lanes: Pick<DispatchLanes, 'headless'>) => void;
  createWatchSession: (
    execute: (
      testPaths: string[],
      updateSnapshot: SnapshotUpdateState,
    ) => Promise<unknown[]>,
  ) => BrowserWatchSession;
  collectProjectEntries: () => Promise<
    Parameters<typeof planWatchRerun>[0]['projectEntries']
  >;
  logWatchReady: () => void;
  destroyRuntime: () => Promise<void>;
};

/**
 * True when the row may reuse one worker page across its consecutive batch
 * files: `isolate: false` opts a row into one shared page per batch, and a
 * row with setup files always reloads per file. The batch builder and the
 * worker page lifecycle both read this one predicate.
 */
const shareWorkerFixtures = (row: BrowserProjectRuntime): boolean =>
  !row.hasSetupFiles && row.runtimeConfig?.isolate === false;

export const createHeadlessScheduler = async ({
  context,
  launchPool,
  projectServers,
  v8Coverage,
  allTestFiles,
  projectRuntimeConfigs,
  fileLimiter,
  hostOptions,
  watchState,
  isWatchMode,
  createDispatchRouter,
  handlers: { handleFatal, handleTestFileComplete },
  watchSignals,
  setDispatchPageResolver,
  createWatchSession,
  collectProjectEntries,
  logWatchReady,
  destroyRuntime,
}: HeadlessSchedulerDeps): Promise<SchedulerRunResult> => {
  // Session-based scheduling path: lifecycle + session index + dispatch routing.
  type ActiveHeadlessRun = RunSession & {
    contexts: Set<BrowserProviderContext>;
    coverageCollectors: Set<() => Promise<void>>;
  };

  const rowsByProject = groupRowsByProject(projectRuntimeConfigs);

  const runLifecycle = new RunSessionLifecycle<ActiveHeadlessRun>();
  const sessionRegistry = new RunnerSessionRegistry();
  setDispatchPageResolver({
    headless: (target) => ({
      runnerPage: target?.sessionId
        ? sessionRegistry.getById(target.sessionId)?.page
        : undefined,
    }),
  });
  let dispatchRequestCounter = 0;

  const nextDispatchRequestId = (namespace: string): string => {
    return `${namespace}-${++dispatchRequestCounter}`;
  };

  const closeContextSafely = async (
    browserContext: BrowserProviderContext,
  ): Promise<void> => {
    try {
      await browserContext.close();
    } catch {
      // ignore
    }
  };

  /** Unregister a context from the run and close it. */
  const discardContext = async (
    run: ActiveHeadlessRun,
    context: BrowserProviderContext,
  ): Promise<void> => {
    run.contexts.delete(context);
    await closeContextSafely(context);
  };

  /** The only way a row's runner context is created: pre-warm and batch share it. */
  const createRowContext = (
    browser: LaunchLease['browser'],
    row: BrowserProjectRuntime,
  ): Promise<BrowserProviderContext> =>
    browser.newContext({
      providerOptions: row.providerOptions,
      viewport: resolveViewport(row.viewport) ?? null,
    });

  const requireProjectServer = (
    projectName: string,
    testFile?: string,
  ): BrowserProjectServer => {
    const server = projectServers.get(projectName);
    if (!server) {
      throw new Error(
        `No browser dev server for project "${projectName}"${testFile ? ` (test file: ${testFile})` : ''}.`,
      );
    }
    return server;
  };

  const runnerPageUrl = (server: BrowserProjectServer): string =>
    `http://localhost:${server.port}/runner.html`;

  /**
   * A runner page prepared while the previous batch of the same row is still
   * executing: a fresh `BrowserContext` + `Page` on the same leased browser,
   * with the transport attached and `runner.html` already loaded. The runner
   * parks in `waitForConfig` (the page boots without injected options) until
   * the claiming batch delivers its config, so the page must not be claimed
   * before the batch's session, cleanup handlers, and transport handlers are
   * in place.
   */
  type PrewarmBridge = HeadlessRunnerTransportHandlers;

  type PrewarmPage = {
    context: BrowserProviderContext;
    page: BrowserProviderPage;
    bridge: PrewarmBridge;
  };

  type Prewarm = {
    /** The page crashed or closed before a batch claimed it. */
    invalidated: boolean;
    /** Never rejects: a failed warm-up cleans itself up and resolves null. */
    ready: Promise<PrewarmPage | null>;
  };

  /** Per-worker state that outlives one batch: the lease and its pre-warm. */
  type WorkerSlot = {
    row: BrowserProjectRuntime;
    lease: LaunchLease;
    /** Set once the lease was given back; the slot no longer owns it. */
    leaseReleased: boolean;
    prewarm?: Prewarm;
    /** Contexts still closing in the background, awaited before release. */
    pendingCloses: Promise<void>[];
  };

  // Idempotent: the abandoned teardown and a context-creation failure can
  // both release before the slot is finished, and `launchPool`'s release is
  // a bare `refs--` that must not run twice.
  const releaseSlotLease = (slot: WorkerSlot): void => {
    if (slot.leaseReleased) {
      return;
    }
    slot.lease.release();
    slot.leaseReleased = true;
  };

  /**
   * Preps in flight per browser (`launchKey` → count). A prep's `newPage` and
   * `goto` compete for the browser's CDP target budget: on a saturated browser
   * (high worker counts) stacked preps inflate every page's creation time by
   * more than they hide, so the pre-warm is skipped once this cap is reached.
   * Two covers the steady overlap of low-concurrency runs, where preps run
   * without contention.
   */
  const PREWARM_CAP_PER_BROWSER = 2;
  const prepsInFlight = new Map<string, number>();

  /**
   * Start a speculative pre-warm for `row` under `slot`'s lease when the
   * worker's queue still holds another batch of that row, keeping the count of
   * concurrent preps per browser inside the cap.
   */
  const maybeStartPrewarm = (
    run: ActiveHeadlessRun,
    slot: WorkerSlot,
    shouldPrewarm: (row: BrowserProjectRuntime) => boolean,
  ): void => {
    const row = slot.row;
    if (!shouldPrewarm(row)) {
      return;
    }
    const key = row.launchKey;
    const inFlight = prepsInFlight.get(key) ?? 0;
    if (inFlight >= PREWARM_CAP_PER_BROWSER) {
      return;
    }
    prepsInFlight.set(key, inFlight + 1);
    const prewarm = startPrewarm(run, slot.lease, row);
    void prewarm.ready.finally(() => {
      const remaining = (prepsInFlight.get(key) ?? 1) - 1;
      if (remaining > 0) {
        prepsInFlight.set(key, remaining);
      } else {
        prepsInFlight.delete(key);
      }
    });
    slot.prewarm = prewarm;
  };

  /**
   * Settle a worker slot: background closes joined, an unclaimed pre-warm
   * discarded, and the lease released — in that order, so the lease never
   * outlives a live context under it. The claiming batch closes its claimed
   * context itself, so only unclaimed pre-warms are discarded here.
   */
  const finishSlot = async (
    run: ActiveHeadlessRun,
    slot: WorkerSlot,
  ): Promise<void> => {
    await Promise.all(slot.pendingCloses.splice(0));
    const prewarm = slot.prewarm;
    slot.prewarm = undefined;
    if (prewarm) {
      // Any pre-warm still on the slot was never claimed (a claim clears it),
      // so discard it here.
      const warmed = await prewarm.ready;
      if (warmed) {
        await discardContext(run, warmed.context);
      }
    }
    releaseSlotLease(slot);
  };

  const startPrewarm = (
    run: ActiveHeadlessRun,
    lease: LaunchLease,
    row: BrowserProjectRuntime,
  ): Prewarm => {
    // `ready` mutates this object while it runs, so it is created first and
    // filled in below.
    const prewarm: Prewarm = {
      invalidated: false,
      ready: Promise.resolve(null),
    };
    prewarm.ready = (async (): Promise<PrewarmPage | null> => {
      let context: BrowserProviderContext | undefined;
      try {
        context = await createRowContext(lease.browser, row);
        // Register with the run right away so a `cancelRun` closes an
        // unclaimed pre-warm context like any other live context; the
        // claiming batch keeps the registration until its own teardown.
        run.contexts.add(context);
        const projectServer = requireProjectServer(row.name);
        // Forwarding stubs first: the claiming batch swaps these for its
        // real handlers before it delivers the config, and the runner
        // sends nothing until then (it parks in `waitForConfig`). A message
        // arriving while parked means the runner is past its wait (e.g. it
        // self-failed) — the page can no longer be claimed.
        const bridge: PrewarmBridge = {
          onDispatchMessage: async () => {
            prewarm.invalidated = true;
          },
          onDispatchRpc: async () => ({ requestId: 'pre-warm' }),
        };
        const page = await context.newPage();
        await attachHeadlessRunnerTransport(page, {
          onDispatchMessage: (envelope) => bridge.onDispatchMessage(envelope),
          onDispatchRpc: (request) => bridge.onDispatchRpc(request),
        });
        const invalidate = (): void => {
          prewarm.invalidated = true;
        };
        page.on('crash', invalidate);
        page.on('close', invalidate);
        await page.goto(runnerPageUrl(projectServer), { waitUntil: 'load' });
        return { context, page, bridge };
      } catch (error) {
        if (context) {
          await discardContext(run, context);
        }
        logger.debug(
          `[Headless] Pre-warm for project "${row.name}" (${row.browserName}) failed: ${toError(error).message}`,
        );
        return null;
      }
    })();
    return prewarm;
  };

  const cancelRun = async (
    run: ActiveHeadlessRun,
    waitForDone = true,
  ): Promise<void> => {
    await runLifecycle.cancel(run, {
      waitForDone,
      onCancel: async (session) => {
        await Promise.all(
          Array.from(session.contexts).map((browserContext) =>
            closeContextSafely(browserContext),
          ),
        );
      },
    });
  };

  const collectRunCoverage = async (run: ActiveHeadlessRun): Promise<void> => {
    const results = await Promise.allSettled(
      Array.from(run.coverageCollectors, (collect) => collect()),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        const error = toError(result.reason);
        await handleFatal({ message: error.message, stack: error.stack });
      }
    }
  };

  const dispatchRouter = createDispatchRouter({
    isRunTokenStale: (runToken) => runLifecycle.isTokenStale(runToken),
    onStale: (request) => {
      if (request.namespace === DISPATCH_NAMESPACE_RUNNER) {
        logger.debug(
          `[Headless] Dropped stale message "${request.method}" for ${request.target?.testFile ?? 'unknown'}`,
        );
      }
    },
  });
  const fileCleanupHandlers = new Map<
    string,
    {
      end: (payload: FileCleanupDispatchPayload) => Promise<void> | void;
      workerStart: () => Promise<void> | void;
      workerEnd: () => Promise<void> | void;
      start: (payload: FileCleanupDispatchPayload) => Promise<void> | void;
    }
  >();
  dispatchRouter.register(DISPATCH_NAMESPACE_FILE_CLEANUP, async (request) => {
    const sessionId = request.target?.sessionId;
    if (!sessionId) {
      throw new Error('File cleanup dispatch is missing a browser session.');
    }
    const handler = fileCleanupHandlers.get(sessionId);
    if (!handler) {
      return;
    }
    const payload = request.args as FileCleanupDispatchPayload;
    if (request.method === 'start') {
      await handler.start(payload);
    } else if (request.method === 'worker-start') {
      await handler.workerStart();
    } else if (request.method === 'end') {
      await handler.end(payload);
    } else if (request.method === 'worker-end') {
      await handler.workerEnd();
    }
  });

  const dispatchRunnerMessage = async (
    run: ActiveHeadlessRun,
    files: ScheduledTestFile[],
    sessionId: string,
    message: BrowserClientMessage,
  ): Promise<void> => {
    const payload = 'payload' in message ? message.payload : undefined;
    const testPath =
      payload && typeof payload === 'object' && 'testPath' in payload
        ? String(payload.testPath)
        : files[0]!.testPath;
    const file =
      files.find(
        (candidate) =>
          getTestPathKey(candidate.testPath) === getTestPathKey(testPath),
      ) ?? files[0]!;
    const response = await dispatchRouter.dispatch({
      requestId: nextDispatchRequestId(DISPATCH_NAMESPACE_RUNNER),
      runToken: run.token,
      namespace: DISPATCH_NAMESPACE_RUNNER,
      method: message.type,
      args: 'payload' in message ? message.payload : undefined,
      target: {
        sessionId,
        testFile: file.testPath,
        projectName: file.projectName,
      },
    });

    if (response.stale) {
      return;
    }

    if (response.error) {
      throw new Error(response.error);
    }
  };

  const runWorkerFiles = async (
    run: ActiveHeadlessRun,
    files: ScheduledTestFile[],
    slot: WorkerSlot,
    rawCoverage: unknown[],
    updateSnapshot: SnapshotUpdateState,
    shouldPrewarm: (row: BrowserProjectRuntime) => boolean,
  ): Promise<void> => {
    if (run.cancelled || runLifecycle.isTokenStale(run.token)) {
      return;
    }

    const file = files[0]!;
    let activeFile = file;
    const row = file.row;
    const lease = slot.lease;
    const prewarm = slot.prewarm;
    slot.prewarm = undefined;

    let claimed: PrewarmPage | undefined;
    if (prewarm) {
      const warmed = await prewarm.ready;
      if (warmed && !prewarm.invalidated) {
        claimed = warmed;
      } else if (warmed) {
        // The warm-up completed but its page died while idle; a failed
        // warm-up has already closed its own context.
        await discardContext(run, warmed.context);
      }
    }

    let browserContext: BrowserProviderContext;
    if (claimed) {
      browserContext = claimed.context;
    } else {
      try {
        browserContext = await createRowContext(lease.browser, row);
      } catch (error) {
        // The slot gives the lease back at once so the pool's other acquirers
        // (and eviction) are not held up by this worker's failure.
        releaseSlotLease(slot);
        throw error;
      }
    }
    run.contexts.add(browserContext);

    let page: BrowserProviderPage | null = null;
    let sessionId: string | null = null;
    let coverageCollection: Promise<void> | undefined;
    let settled = false;
    let resolveDone: (() => void) | null = null;
    let workerCleanupTimer: ReturnType<typeof setTimeout> | undefined;
    let dispatchQueue = Promise.resolve();
    const completedFiles = new Set<string>();
    const keepWorkerFixtures = shareWorkerFixtures(row);
    const fileCleanupStates = new Map<
      string,
      {
        timer?: ReturnType<typeof setTimeout>;
        finished: boolean;
        result?: RawTestFileResult;
      }
    >();

    const handleWorkerCleanupTimeout = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      void (async () => {
        await closeContextSafely(browserContext);
        // The page may be synchronously blocked by the cleanup callback.
        // Coverage collection uses the same renderer and is intentionally
        // skipped after this timeout so it cannot prevent settlement.
        await handleFatal({
          message: `Worker fixture cleanup did not finish within ${FIXTURE_CLEANUP_TIMEOUT_MS}ms`,
        });
        resolveDone?.();
      })();
    };

    const armWorkerCleanupDeadline = (): void => {
      if (workerCleanupTimer) {
        clearTimeout(workerCleanupTimer);
      }
      workerCleanupTimer = setTimeout(
        handleWorkerCleanupTimeout,
        FIXTURE_CLEANUP_TIMEOUT_MS,
      );
    };

    const disarmWorkerCleanupDeadline = (): void => {
      if (!workerCleanupTimer) {
        return;
      }
      clearTimeout(workerCleanupTimer);
      workerCleanupTimer = undefined;
    };

    const markDone = (): void => {
      if (!settled) {
        settled = true;
        resolveDone?.();
      }
    };

    const donePromise = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    // Event-driven death detection (vitest-style): a renderer crash or an
    // unexpected page close produces no further messages, so fail the file at
    // once. Per-test/hook timeouts are enforced inside the runner, so the host
    // deliberately keeps no execution-duration watchdog. Our own teardown
    // close is ignored because `settled`/`run.cancelled` are set by then.
    const crashDeferred = createDeferredPromise<string>();
    const onPageDead = (reason: string): void => {
      if (settled || run.cancelled || !runLifecycle.isTokenActive(run.token)) {
        return;
      }
      settled = true;
      crashDeferred.resolve(reason);
    };

    // Validation guarantees a v8 run selects only chromium rows, so every
    // row collects CDP coverage whenever the v8 provider is present.
    const collectCoverage = async (): Promise<void> => {
      if (!page || !v8Coverage) {
        return;
      }
      if (!coverageCollection) {
        coverageCollection = (async () => {
          const coverage = await v8Coverage.take(
            page,
            file.row.projectRoot,
            file.projectName,
          );
          if (coverage) {
            rawCoverage.push(coverage);
          }
          // Playwright's take() stops JavaScript coverage collection. A
          // non-isolated page runs multiple files, so restart collection
          // before the next file is loaded.
          if (keepWorkerFixtures) {
            await v8Coverage.start(page);
          }
        })();
      }
      await coverageCollection;
    };

    const abortRun = async (): Promise<void> => {
      markDone();
      await collectRunCoverage(run);
      await cancelRun(run, false);
    };

    try {
      page = claimed ? claimed.page : await browserContext.newPage();
      await v8Coverage?.start(page);
      run.coverageCollectors.add(collectCoverage);
      page.on('crash', () =>
        onPageDead(
          `Browser page crashed while running ${activeFile.testPath}.`,
        ),
      );
      page.on('close', () =>
        onPageDead(
          `Browser page closed unexpectedly while running ${activeFile.testPath}.`,
        ),
      );

      const session = sessionRegistry.register({
        testFile: file.testPath,
        projectName: file.projectName,
        runToken: run.token,
        mode: 'headless-page',
        context: browserContext,
        page,
      });
      sessionId = session.id;

      fileCleanupHandlers.set(session.id, {
        workerStart: armWorkerCleanupDeadline,
        end: (payload) => {
          const state = fileCleanupStates.get(payload.testPath);
          if (!state) {
            return;
          }
          state.finished = true;
          if (state.timer) {
            clearTimeout(state.timer);
            state.timer = undefined;
          }
          return collectCoverage().finally(() => {
            coverageCollection = undefined;
          });
        },
        workerEnd: () => {
          disarmWorkerCleanupDeadline();
          return collectCoverage().finally(() => {
            coverageCollection = undefined;
          });
        },
        start: async (payload) => {
          const state = fileCleanupStates.get(payload.testPath) ?? {
            finished: false,
          };
          if (state.finished) {
            return;
          }
          state.result = payload.result;
          if (state.timer) {
            clearTimeout(state.timer);
          }
          state.timer = setTimeout(() => {
            void (async () => {
              if (settled) {
                return;
              }
              settled = true;
              const message = `File fixture cleanup did not finish within ${FIXTURE_CLEANUP_TIMEOUT_MS}ms`;
              try {
                completedFiles.add(payload.testPath);
                await handleTestFileComplete(
                  createFileCleanupTimeoutResult({
                    message,
                    projectName: file.row.instanceName,
                    result: state.result,
                    testPath: payload.testPath,
                  }),
                );
                for (const pendingFile of files) {
                  if (completedFiles.has(pendingFile.testPath)) {
                    continue;
                  }
                  completedFiles.add(pendingFile.testPath);
                  await handleTestFileComplete(
                    createFileCleanupTimeoutResult({
                      message: `${message}; file was not run because the previous file cleanup timed out`,
                      projectName: pendingFile.row.instanceName,
                      testPath: pendingFile.testPath,
                    }),
                  );
                }
              } catch (error) {
                const formatted = toError(error);
                await closeContextSafely(browserContext);
                await handleFatal({
                  message: formatted.message,
                  stack: formatted.stack,
                });
              } finally {
                resolveDone?.();
              }
            })();
          }, FIXTURE_CLEANUP_TIMEOUT_MS);
          fileCleanupStates.set(payload.testPath, state);
          // The client waits for this acknowledgement before it can finish
          // the file. Coverage is collected from the acknowledged
          // file-complete message instead, after file/worker fixture cleanup
          // has run, so cleanup-only execution is included in the report.
        },
      });

      const onDispatchMessage = (envelope: RunnerEnvelope): Promise<void> => {
        const queued = dispatchQueue.then(async () => {
          try {
            const message = envelope.message;
            if (settled) {
              return;
            }
            if (message.type === 'file-start') {
              const startedPath = getTestPathKey(message.payload.testPath);
              activeFile =
                files.find(
                  (candidate) =>
                    getTestPathKey(candidate.testPath) === startedPath,
                ) ?? activeFile;
            }
            if (message.type === 'fatal') {
              await collectCoverage();
            }
            await dispatchRunnerMessage(run, files, session.id, message);
            if (message.type === 'file-complete') {
              const completedPath = message.payload.testPath;
              completedFiles.add(completedPath);
            }
            if (
              message.type === 'complete' ||
              (message.type === 'file-complete' &&
                files.length === 1 &&
                !keepWorkerFixtures)
            ) {
              disarmWorkerCleanupDeadline();
              markDone();
            } else if (message.type === 'fatal') {
              await abortRun();
            }
          } catch (error) {
            const formatted = toError(error);
            await handleFatal({
              message: formatted.message,
              stack: formatted.stack,
            });
            await abortRun();
          }
        });
        dispatchQueue = queued.catch(() => {});
        return queued;
      };
      const onDispatchRpc = async (
        request: BrowserDispatchRequest,
      ): Promise<BrowserDispatchResponse> => {
        return dispatchRouter.dispatch({
          ...request,
          runToken: run.token,
          target: {
            sessionId: session.id,
            testFile: file.testPath,
            projectName: file.projectName,
            ...request.target,
          },
        });
      };

      const inlineOptions: BrowserHostConfig = {
        ...hostOptions,
        // The runner page resolves only its own `(project, browser)` row; a
        // worker page never needs the other rows of this run.
        projects: [toWireRow(file.row)],
        snapshot: {
          updateSnapshot,
        },
        testFile: file.testPath,
        testFiles: files.map((item) => item.testPath),
        runId: `${run.token}:${session.id}`,
        // The runner resolves its `(project, browser)` runtime row through this
        // identity; results and screenshot RPCs attribute through it too.
        browserName: file.row.browserName,
      };

      if (claimed) {
        // The warm-up attached forwarding stubs before its goto; swap in this
        // batch's handlers, then unblock the runner the page already loaded.
        // Everything a runner message needs — session, cleanup handlers,
        // coverage collection — is registered by now.
        claimed.bridge.onDispatchMessage = onDispatchMessage;
        claimed.bridge.onDispatchRpc = onDispatchRpc;
        const configMessage = serializeForInlineScript({
          type: RSTEST_CONFIG_MESSAGE_TYPE,
          payload: inlineOptions,
        });
        await page.evaluate(`window.postMessage(${configMessage}, '*')`);
      } else {
        await attachHeadlessRunnerTransport(page, {
          onDispatchMessage,
          onDispatchRpc,
        });
        await page.addInitScript(
          `window.__RSTEST_BROWSER_OPTIONS__ = ${serializeForInlineScript(inlineOptions)};`,
        );

        const projectServer = requireProjectServer(
          file.projectName,
          file.testPath,
        );
        await page.goto(runnerPageUrl(projectServer), { waitUntil: 'load' });
      }

      // This batch is set up; if the queue still holds another batch of this
      // row, prepare its page now so the newContext/newPage/goto cost hides
      // behind the current file's execution.
      maybeStartPrewarm(run, slot, shouldPrewarm);

      const state = await Promise.race([
        donePromise.then(() => ({ type: 'done' as const })),
        crashDeferred.promise.then((reason) => ({
          type: 'crash' as const,
          reason,
        })),
        run.cancelSignal.then(() => ({ type: 'cancelled' as const })),
      ]);

      if (state.type === 'cancelled') {
        return;
      }

      if (
        state.type === 'crash' &&
        runLifecycle.isTokenActive(run.token) &&
        !run.cancelled
      ) {
        await collectRunCoverage(run);
        await handleFatal({ message: state.reason });
        await cancelRun(run, false);
      }
    } catch (error) {
      if (runLifecycle.isTokenActive(run.token) && !run.cancelled) {
        await collectRunCoverage(run);
        const formatted = toError(error);
        await handleFatal({
          message: formatted.message,
          stack: formatted.stack,
        });
        await cancelRun(run, false);
      }
    } finally {
      for (const state of fileCleanupStates.values()) {
        if (state.timer) {
          clearTimeout(state.timer);
        }
      }
      if (workerCleanupTimer) {
        clearTimeout(workerCleanupTimer);
      }
      if (sessionId) {
        fileCleanupHandlers.delete(sessionId);
      }
      run.coverageCollectors.delete(collectCoverage);
      // A superseded run can hold a renderer that will never answer again:
      // its test file may have been deleted mid-flight, leaving the page
      // waiting on a chunk the bundler will never produce, and closing such
      // a page blocks for as long as the renderer stays wedged. The cycle
      // waits on this teardown for a normal end only; for an abandoned run
      // it is detached — its results are already discarded, and the
      // replacement cycle must not be held up by a page nobody is reading.
      // The lease goes back at once in that case: closing the evicted
      // browser closes this context too.
      const abandoned = run.cancelled || runLifecycle.isTokenStale(run.token);
      if (sessionId) {
        sessionRegistry.deleteById(sessionId);
      }
      run.contexts.delete(browserContext);
      if (abandoned) {
        void closeContextSafely(browserContext);
        releaseSlotLease(slot);
      } else {
        // In-band close, tracked on the slot: the next same-row batch (with
        // its claimed pre-warm) starts while this context closes, and the
        // worker releases the lease only once every context it created under
        // the lease has closed. `context.close()` closes the page too, so no
        // separate `page.close()` round trip is issued.
        slot.pendingCloses.push(closeContextSafely(browserContext));
      }
    }
  };

  // Bailed files never run, so they carry no case results — mirror the node
  // pool's skip result (`runInPool.ts`) so the summary reports them as skipped
  // rather than dropping them silently.
  const makeSkippedFileResult = (
    file: ScheduledTestFile,
  ): RawTestFileResult => ({
    testId: getFileTaskId(file.testPath),
    status: 'skipped',
    name: '',
    testPath: file.testPath,
    project: file.row.instanceName,
    results: [],
  });

  const runFilesWithPool = async (
    files: TestFileInfo[],
    updateSnapshot: SnapshotUpdateState = hostOptions.snapshot.updateSnapshot,
  ): Promise<unknown[]> => {
    const rawCoverage: unknown[] = [];
    if (files.length === 0) {
      return rawCoverage;
    }

    const previous = runLifecycle.activeSession;
    if (previous) {
      await cancelRun(previous);
    }

    const run = runLifecycle.createSession((token) => ({
      ...createRunSession(token),
      contexts: new Set<BrowserProviderContext>(),
      coverageCollectors: new Set<() => Promise<void>>(),
    }));

    // Launch groups whose browser is already open go first, so a capped watch
    // pool reuses them before evicting them. `expandToRows` keeps each group
    // contiguous and the partition is stable.
    const expanded = expandToRows(files, rowsByProject);
    const queue = [
      ...expanded.filter((file) => launchPool.isOpen(file.row.launchKey)),
      ...expanded.filter((file) => !launchPool.isOpen(file.row.launchKey)),
    ];
    const concurrency = getHeadlessConcurrency(context, queue.length);
    const bail = context.normalizedConfig.bail;
    const bailReached = (): boolean =>
      Boolean(bail && context.stateManager.getCountOfFailedTests() >= bail);
    const nonIsolatedBatchSize = Math.max(
      1,
      bail ? 1 : Math.ceil(queue.length / Math.max(concurrency, 1)),
    );

    // Speculative pre-warm gate: another batch of this row must still be
    // queued, and the run must be live — a bail drain or a cancelled run
    // would only discard the warmed context. A mixed run gives the lease back
    // at every file slot boundary (see the worker's slot settling), so a
    // pre-warm could never survive to be claimed there.
    const shouldPrewarm = (row: BrowserProjectRuntime): boolean =>
      !fileLimiter &&
      queue.length > 0 &&
      !run.cancelled &&
      runLifecycle.isTokenActive(run.token) &&
      queue[0]!.row === row &&
      !bailReached();

    const worker = async (): Promise<void> => {
      // One worker slot per worker: the lease stays alive across consecutive
      // same-row batches (one pre-warm runs under it at a time), and it is
      // released only after every context created under it has closed.
      let workerSlot: WorkerSlot | undefined;
      try {
        while (
          queue.length > 0 &&
          !run.cancelled &&
          runLifecycle.isTokenActive(run.token)
        ) {
          // Mixed runs share one file budget with the headed lane. Acquire ahead
          // of the bail gate and the queue pop so a worker parked on the limiter
          // never picks a file against stale state; every exit below releases.
          const releaseFileSlot = await fileLimiter?.acquire();
          try {
            if (
              queue.length === 0 ||
              run.cancelled ||
              !runLifecycle.isTokenActive(run.token)
            ) {
              return;
            }
            // Cross-file bail gate (parity with the node pool's pickup-time skip
            // at `runInPool.ts`): once the cycle-wide failed count reaches `bail`,
            // drain the remaining files as skipped instead of running them. The
            // count is cycle-scoped because core clears `stateManager` ahead of
            // every cycle, a watch session's first one included — so a mixed
            // launch cannot drain this queue on the node initial cycle's
            // failures.
            if (bailReached()) {
              let skipped = queue.shift();
              while (skipped) {
                await handleTestFileComplete(makeSkippedFileResult(skipped));
                skipped = queue.shift();
              }
              return;
            }
            const next = queue.shift();
            if (!next) {
              return;
            }
            const batch = [next];
            // Batches never mix rows: a page belongs to one context/viewport pair.
            if (shareWorkerFixtures(next.row)) {
              while (
                batch.length < nonIsolatedBatchSize &&
                queue[0]?.row === next.row
              ) {
                batch.push(queue.shift()!);
              }
            }
            // A row change ends this worker's business with the old browser:
            // its contexts (and any unclaimed pre-warm) close before the lease
            // goes back, and the new lease is acquired after that — releasing
            // before acquiring is what lets a capped pool evict the idle old
            // browser instead of deadlocking on this worker's own lease.
            if (workerSlot && workerSlot.row !== next.row) {
              await finishSlot(run, workerSlot);
              workerSlot = undefined;
            }
            workerSlot ??= {
              row: next.row,
              lease: await launchPool.acquire(next.row.launchKey),
              leaseReleased: false,
              pendingCloses: [],
            };
            await runWorkerFiles(
              run,
              batch,
              workerSlot,
              rawCoverage,
              updateSnapshot,
              shouldPrewarm,
            );
          } finally {
            // The lease must not span a file slot. Settle it before the file
            // slot is released whenever it cannot be reused next round: in a
            // mixed run the limiter can park this worker on the next
            // `acquire()` with the lease still held (file slot first, lease
            // second), and a row change makes the lease unusable regardless.
            if (
              workerSlot &&
              (fileLimiter || queue[0]?.row !== workerSlot.row)
            ) {
              await finishSlot(run, workerSlot);
              workerSlot = undefined;
            }
            releaseFileSlot?.();
          }
        }
      } finally {
        if (workerSlot) {
          await finishSlot(run, workerSlot);
        }
      }
    };

    // Any worker failure (a launch failure included) rejects the cycle: stop
    // the other workers from taking files, wait for them, then rethrow.
    let failure: { error: unknown } | undefined;
    run.done = Promise.allSettled(
      Array.from(
        { length: Math.min(queue.length, Math.max(concurrency, 1)) },
        () =>
          worker().catch(async (error) => {
            failure ??= { error };
            await cancelRun(run, false);
          }),
      ),
    ).then(() => {});

    await run.done;
    runLifecycle.clearIfActive(run);
    if (failure) {
      throw failure.error;
    }
    return rawCoverage;
  };

  // Invalidating the token first makes every late dispatch from the cancelled
  // run a no-op. Cancellation deliberately does not await run.done: the run's
  // own cycle awaits it, so a queued replacement or the session abort's runtime
  // teardown can start at once.
  //
  // This callback never tears down browser contexts. A rebuild trigger reaches
  // it inside the bundler's dev-compile hook; a page still fetching from the dev
  // server that hook is holding up cannot be closed, so the run would never end.
  // Signalling is enough: the run's own teardown closes page and context as it
  // unwinds, and every page operation it can be sitting in is bounded by the
  // driver's own timeout. On session abort, the controller destroys the runtime
  // after this callback returns.
  watchSignals.setInterrupt(async () => {
    const active = runLifecycle.activeSession;
    if (!active || active.cancelled) {
      return;
    }
    runLifecycle.invalidateActiveToken();
    await runLifecycle.cancel(active, { waitForDone: false });
  });

  const testStart = Date.now();
  const rawCoverage = await runFilesWithPool(allTestFiles);
  const testTime = Date.now() - testStart;

  let watchSession: BrowserWatchSession | undefined;
  if (isWatchMode) {
    // A queued scope can go stale before its cycle is dequeued — a later
    // trigger may have rebuilt the file set without one of these files — so a
    // path that no longer resolves is skipped rather than failing the cycle
    // beside its still-valid siblings.
    const runScope = async (
      testPaths: string[],
      updateSnapshot: SnapshotUpdateState,
    ): Promise<unknown[]> => {
      await watchState.awaitFailureScreenshotCleanups?.();
      const pathSet = new Set(
        testPaths.map((testPath) => getTestPathKey(testPath)),
      );
      return runFilesWithPool(
        watchState.lastTestFiles.filter((file) =>
          pathSet.has(getTestPathKey(file.testPath)),
        ),
        updateSnapshot,
      );
    };

    // Each project compiler can trigger a rebuild independently; serialize
    // planning so the drain-once affected set and file-set commit cannot race.
    const dispatchRerunQueue = createSerialTaskQueue();
    watchSignals.setDispatchRerun((updateSnapshot, requestedTestPaths) =>
      dispatchRerunQueue.enqueue(async () => {
        const newProjectEntries = await collectProjectEntries();
        const rerunPlan = planWatchRerun({
          projectEntries: newProjectEntries,
          previousTestFiles: watchState.lastTestFiles,
          affectedTestFiles: drainPendingAffectedTestFiles(watchState),
          requestedTestPaths,
        });

        commitWatchFileSetUpdate(rerunPlan.fileSetUpdate, watchState);
        watchState.removeFailureScreenshots?.(
          rerunPlan.fileSetUpdate?.deletedTestFiles ?? [],
        );
        const failureScreenshotCleanup =
          watchState.awaitFailureScreenshotCleanups?.() ?? Promise.resolve();

        if (rerunPlan.decision.kind === 'idle') {
          void failureScreenshotCleanup.then(() => {
            logger.log(color.cyan(rerunPlan.decision.message));
            logWatchReady();
            if (rerunPlan.deferredTestPaths) {
              watchSignals.queueInvalidationAfter(
                Promise.resolve(),
                rerunPlan.deferredTestPaths,
              );
            }
          });
          return;
        }

        void failureScreenshotCleanup.then(() => {
          logger.log(color.cyan(rerunPlan.decision.message));
        });
        const { cycle } = await watchSignals.signalInvalidation(
          rerunPlan.decision.kind === 'empty'
            ? []
            : rerunPlan.decision.testPaths,
          undefined,
          updateSnapshot,
        );
        if (rerunPlan.deferredTestPaths) {
          watchSignals.queueInvalidationAfter(
            cycle,
            rerunPlan.deferredTestPaths,
          );
        }
      }),
    );

    watchSession = createWatchSession(runScope);
  }

  const closeHeadlessRuntime = !isWatchMode
    ? async () => {
        sessionRegistry.clear();
        await destroyRuntime();
      }
    : undefined;

  return {
    testTime,
    rawCoverage,
    watchSession,
    // `closeHeadlessRuntime` is already `undefined` in watch mode: the watch
    // runtime outlives the cycle and is torn down through `executor.close()`.
    close: closeHeadlessRuntime,
  };
};
