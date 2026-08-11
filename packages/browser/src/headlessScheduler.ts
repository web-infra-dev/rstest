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
import { normalize } from 'pathe';
import {
  type BrowserRuntime,
  drainPendingAffectedTestFiles,
  mapViewportByProject,
  serializeForInlineScript,
} from './browserRsbuild';
import { getHeadlessConcurrency } from './concurrency';
import type { HostDispatchRouterOptions } from './dispatchCapabilities';
import type { HostDispatchRouter } from './dispatchRouter';
import { attachHeadlessRunnerTransport } from './headlessTransport';
import {
  createDeferredPromise,
  getFileTaskId,
  type FatalPayload,
  toError,
} from './hostPayloads';
import type {
  BrowserClientMessage,
  BrowserHostConfig,
  BrowserProjectRuntime,
  FileCleanupDispatchPayload,
  TestFileInfo,
} from './protocol';
import {
  DISPATCH_NAMESPACE_FILE_CLEANUP,
  DISPATCH_NAMESPACE_RUNNER,
} from './protocol';
import type {
  BrowserProviderBrowser,
  BrowserProviderContext,
  BrowserProviderPage,
} from './providers';
import {
  createRunSession,
  type RunSession,
  RunSessionLifecycle,
} from './runSession';
import { RunnerSessionRegistry } from './sessionRegistry';
import { commitWatchFileSetUpdate, planWatchRerun } from './watchRerunPlanner';
import type {
  BrowserV8CoverageRuntime,
  BrowserWatchSession,
  DispatchPageResolver,
  SchedulerRunResult,
} from './schedulerSeam';
import type { WatchSignals } from './watchSignals';

type HeadlessSchedulerContext = Pick<
  RstestContext,
  | 'command'
  | 'rootPath'
  | 'snapshotManager'
  | 'stateManager'
  | 'updateReporterResultState'
> & {
  normalizedConfig: Pick<RstestContext['normalizedConfig'], 'bail' | 'pool'>;
};

type HeadlessSchedulerDeps = {
  context: HeadlessSchedulerContext;
  browser: BrowserProviderBrowser;
  browserLaunchOptions: BrowserRuntime['browserLaunchOptions'];
  projectServers: BrowserRuntime['projectServers'];
  v8Coverage?: BrowserV8CoverageRuntime;
  allTestFiles: TestFileInfo[];
  projectRuntimeConfigs: BrowserProjectRuntime[];
  hostOptions: BrowserHostConfig;
  watchState: BrowserRuntime['watchState'];
  isWatchMode: boolean;
  createDispatchRouter: (
    options?: HostDispatchRouterOptions,
  ) => HostDispatchRouter;
  handlers: {
    handleFatal: (payload: FatalPayload) => Promise<void>;
    handleTestFileComplete: (payload: TestFileResult) => Promise<void>;
  };
  watchSignals: Pick<
    WatchSignals,
    'setDispatchRerun' | 'setInterrupt' | 'signalInvalidation'
  >;
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

export const createHeadlessScheduler = async ({
  context,
  browser,
  browserLaunchOptions,
  projectServers,
  v8Coverage,
  allTestFiles,
  projectRuntimeConfigs,
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

  const viewportByProject = mapViewportByProject(projectRuntimeConfigs);
  const projectRootByName = new Map(
    projectRuntimeConfigs.map((project) => [project.name, project.projectRoot]),
  );
  const runLifecycle = new RunSessionLifecycle<ActiveHeadlessRun>();
  const sessionRegistry = new RunnerSessionRegistry();
  setDispatchPageResolver((target) => ({
    runnerPage: target?.sessionId
      ? sessionRegistry.getById(target.sessionId)?.page
      : undefined,
  }));
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
      end: () => void;
      start: (result?: TestFileResult) => void;
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
      handler.start(payload.result);
    } else if (request.method === 'end') {
      handler.end();
    }
  });

  const dispatchRunnerMessage = async (
    run: ActiveHeadlessRun,
    file: TestFileInfo,
    sessionId: string,
    message: BrowserClientMessage,
  ): Promise<void> => {
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

  const runSingleFile = async (
    run: ActiveHeadlessRun,
    file: TestFileInfo,
    rawCoverage: unknown[],
  ): Promise<void> => {
    if (run.cancelled || runLifecycle.isTokenStale(run.token)) {
      return;
    }

    const viewport = viewportByProject.get(file.projectName);
    const browserContext = await browser.newContext({
      providerOptions: browserLaunchOptions.providerOptions,
      viewport: viewport ?? null,
    });
    run.contexts.add(browserContext);

    let page: BrowserProviderPage | null = null;
    let sessionId: string | null = null;
    let coverageCollection: Promise<void> | undefined;
    let settled = false;
    let resolveDone: (() => void) | null = null;
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    let fileCleanupFinished = false;
    let provisionalResult: TestFileResult | undefined;

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

    const collectCoverage = async (): Promise<void> => {
      if (!page || !v8Coverage) {
        return;
      }
      if (!coverageCollection) {
        coverageCollection = (async () => {
          const coverage = await v8Coverage.take(
            page,
            projectRootByName.get(file.projectName) ?? context.rootPath,
            file.projectName,
          );
          if (coverage) {
            rawCoverage.push(coverage);
          }
        })();
      }
      await coverageCollection;
    };
    try {
      page = await browserContext.newPage();
      await v8Coverage?.start(page);
      run.coverageCollectors.add(collectCoverage);
      page.on('crash', () =>
        onPageDead(`Browser page crashed while running ${file.testPath}.`),
      );
      page.on('close', () =>
        onPageDead(
          `Browser page closed unexpectedly while running ${file.testPath}.`,
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

      const clearFileCleanupTimeout = (): void => {
        if (cleanupTimer) {
          clearTimeout(cleanupTimer);
          cleanupTimer = undefined;
        }
      };
      const finishFileCleanup = (): void => {
        fileCleanupFinished = true;
        clearFileCleanupTimeout();
      };
      fileCleanupHandlers.set(session.id, {
        end: finishFileCleanup,
        start: (result) => {
          if (fileCleanupFinished) {
            return;
          }
          provisionalResult = result;
          clearFileCleanupTimeout();
          cleanupTimer = setTimeout(() => {
            void (async () => {
              if (settled) {
                return;
              }
              settled = true;
              const message = `File fixture cleanup did not finish within ${FIXTURE_CLEANUP_TIMEOUT_MS}ms`;
              try {
                await collectCoverage();
                await handleTestFileComplete(
                  createFileCleanupTimeoutResult({
                    message,
                    projectName: file.projectName,
                    result: provisionalResult,
                    testPath: file.testPath,
                  }),
                );
              } catch (error) {
                const formatted = toError(error);
                await handleFatal({
                  message: formatted.message,
                  stack: formatted.stack,
                });
                await collectRunCoverage(run);
                await cancelRun(run, false);
              } finally {
                resolveDone?.();
              }
            })();
          }, FIXTURE_CLEANUP_TIMEOUT_MS);
        },
      });

      await attachHeadlessRunnerTransport(page, {
        onDispatchMessage: async (message) => {
          try {
            if (settled) {
              return;
            }
            if (message.type === 'file-complete' || message.type === 'fatal') {
              await collectCoverage();
            }
            await dispatchRunnerMessage(run, file, session.id, message);
            if (message.type === 'file-complete') {
              markDone();
            } else if (message.type === 'fatal') {
              markDone();
              await collectRunCoverage(run);
              await cancelRun(run, false);
            }
          } catch (error) {
            const formatted = toError(error);
            await handleFatal({
              message: formatted.message,
              stack: formatted.stack,
            });
            markDone();
            await collectRunCoverage(run);
            await cancelRun(run, false);
          }
        },
        onDispatchRpc: async (request) => {
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
        },
      });

      const inlineOptions: BrowserHostConfig = {
        ...hostOptions,
        // Read live per page load, not from the construction-time
        // `hostOptions` value: the 'u' shortcut flips
        // `snapshotManager.options` between reruns.
        snapshot: {
          updateSnapshot: context.snapshotManager.options.updateSnapshot,
        },
        testFile: file.testPath,
        runId: `${run.token}:${session.id}`,
      };
      const serializedOptions = serializeForInlineScript(inlineOptions);
      await page.addInitScript(
        `window.__RSTEST_BROWSER_OPTIONS__ = ${serializedOptions};`,
      );

      const projectServer = projectServers.get(file.projectName);
      if (!projectServer) {
        throw new Error(
          `No browser dev server for project "${file.projectName}" (test file: ${file.testPath}).`,
        );
      }
      await page.goto(`http://localhost:${projectServer.port}/runner.html`, {
        waitUntil: 'load',
      });

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
      if (cleanupTimer) {
        clearTimeout(cleanupTimer);
      }
      if (sessionId) {
        fileCleanupHandlers.delete(sessionId);
      }
      run.coverageCollectors.delete(collectCoverage);
      // A superseded run can hold a renderer that will never answer again:
      // its test file may have been deleted mid-flight, leaving the page
      // waiting on a chunk the bundler will never produce, and closing such a
      // page blocks for as long as the renderer stays wedged. The cycle waits
      // on this teardown, so for an abandoned run it is detached — its
      // results are already discarded, and the replacement cycle must not be
      // held up by a page nobody is reading. A run that ends normally closes
      // in band, which is what keeps the open-context count at the
      // concurrency limit.
      const abandoned = run.cancelled || runLifecycle.isTokenStale(run.token);
      const teardown = async (): Promise<void> => {
        if (page) {
          try {
            await page.close();
          } catch {
            // ignore
          }
        }
        await closeContextSafely(browserContext);
      };
      if (sessionId) {
        sessionRegistry.deleteById(sessionId);
      }
      run.contexts.delete(browserContext);
      if (abandoned) {
        void teardown();
      } else {
        await teardown();
      }
    }
  };

  // Bailed files never run, so they carry no case results — mirror the node
  // pool's skip result (`runInPool.ts`) so the summary reports them as skipped
  // rather than dropping them silently.
  const makeSkippedFileResult = (file: TestFileInfo): TestFileResult => ({
    testId: getFileTaskId(file.testPath),
    status: 'skip',
    name: '',
    testPath: file.testPath,
    project: file.projectName,
    results: [],
  });

  const runFilesWithPool = async (
    files: TestFileInfo[],
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

    const queue = [...files];
    const concurrency = getHeadlessConcurrency(context, queue.length);
    const bail = context.normalizedConfig.bail;

    const worker = async (): Promise<void> => {
      while (
        queue.length > 0 &&
        !run.cancelled &&
        runLifecycle.isTokenActive(run.token)
      ) {
        // Cross-file bail gate (parity with the node pool's pickup-time skip
        // at `runInPool.ts`): once the cycle-wide failed count reaches `bail`,
        // drain the remaining files as skipped instead of running them. The
        // count is cycle-scoped because core clears `stateManager` ahead of
        // every cycle, a watch session's first one included — so a mixed
        // launch cannot drain this queue on the node initial cycle's
        // failures.
        if (bail && context.stateManager.getCountOfFailedTests() >= bail) {
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
        await runSingleFile(run, next, rawCoverage);
      }
    };

    run.done = Promise.all(
      Array.from(
        { length: Math.min(queue.length, Math.max(concurrency, 1)) },
        () => worker(),
      ),
    ).then(() => {});

    await run.done;
    runLifecycle.clearIfActive(run);
    return rawCoverage;
  };

  const testStart = Date.now();
  const rawCoverage = await runFilesWithPool(allTestFiles);
  const testTime = Date.now() - testStart;

  let watchSession: BrowserWatchSession | undefined;
  if (isWatchMode) {
    // A queued scope can go stale before its cycle is dequeued — a later
    // trigger may have rebuilt the file set without one of these files — so a
    // path that no longer resolves is skipped rather than failing the cycle
    // beside its still-valid siblings.
    const runScope = async (testPaths: string[]): Promise<unknown[]> => {
      const pathSet = new Set(testPaths.map((testPath) => normalize(testPath)));
      return runFilesWithPool(
        watchState.lastTestFiles.filter((file) => pathSet.has(file.testPath)),
      );
    };

    // Cutting the in-flight run short lets its cycle finalize with what it had
    // and the queued replacement start immediately; invalidating the token
    // first makes every late dispatch from it a no-op. Deliberately not
    // awaiting `run.done` — the cancelled run's own cycle is what awaits it.
    //
    // Unlike every other cancel this one does not tear the run's browser
    // contexts down, because a rebuild trigger reaches it from inside the
    // bundler's dev-compile hook: a page still fetching from the dev server
    // that same hook is holding up cannot be closed, and the run it belongs
    // to then never ends. Signalling the cancel is enough — the run's own
    // teardown closes page and context as soon as it unwinds, and every page
    // operation it can be sitting in is bounded by the driver's own timeout.
    watchSignals.setInterrupt(async () => {
      const active = runLifecycle.activeSession;
      if (!active || active.cancelled) {
        return;
      }
      runLifecycle.invalidateActiveToken();
      await runLifecycle.cancel(active, { waitForDone: false });
    });

    watchSignals.setDispatchRerun(async () => {
      const newProjectEntries = await collectProjectEntries();
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

      logger.log(color.cyan(rerunPlan.decision.message));
      if (rerunPlan.decision.kind === 'idle') {
        logWatchReady();
        return;
      }

      await watchSignals.signalInvalidation(
        rerunPlan.decision.kind === 'empty' ? [] : rerunPlan.decision.testPaths,
      );
    });

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
