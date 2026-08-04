import fs from 'node:fs/promises';
import {
  type BrowserTestRunOptions,
  type BrowserTestRunResult,
  buildBrowserCoverageMap,
  type ExecutorCycleOutcome,
  type ExecutorInvalidationCallback,
  FATAL_SIGNALS,
  type ListBrowserTestsOptions,
  color,
  createCoverageProvider,
  createRunnerEventSink,
  createSilentConsoleController,
  DEFAULT_TEST_TIMEOUT,
  type FormattedError,
  getPrettyConsoleName,
  hasUserRstestConfigPlugins,
  isDebug,
  isTTY,
  type ListCommandResult,
  logger,
  logWatchReadyMessage,
  projectRuntimeConfig,
  PhaseTracker,
  type ProjectContext,
  type Reporter,
  type RunnerEventSink,
  type RstestContext,
  resolveSnapshotPathDefault,
  serializableConfig,
  type Test,
  type TestFileResult,
  type TestResult,
  type UserConsoleLog,
} from '@rstest/core/internal/browser';
import { type BirpcReturn, createBirpc } from 'birpc';
import { dirname, join, normalize, relative } from 'pathe';
import { type WebSocket, WebSocketServer } from 'ws';
import { getHeadlessConcurrency } from './concurrency';
import {
  createHostDispatchRouter,
  type HostDispatchRouterOptions,
} from './dispatchCapabilities';
import {
  collectProjectEntries,
  createBrowserRuntime,
  destroyBrowserRuntime,
  drainPendingAffectedTestFiles,
  drainPendingBuildTime,
  getBrowserProjects,
  mapViewportByProject,
  type BrowserProjectServer,
  type BrowserProviderProject,
  resolveContainerDist,
  resolveProjectEntries,
  serializeForInlineScript,
  type BrowserRuntime,
} from './browserRsbuild';
import { createHeadedSerialTaskQueue } from './headedSerialTaskQueue';
import { attachHeadlessRunnerTransport } from './headlessTransport';
import type {
  BrowserClientMessage,
  BrowserDispatchRequest,
  BrowserDispatchResponse,
  BrowserHostConfig,
  BrowserLogPayload,
  BrowserProjectRuntime,
  BrowserRpcRequest,
  SnapshotRpcRequest,
  TestFileInfo,
} from './protocol';
import {
  DISPATCH_MESSAGE_TYPE,
  DISPATCH_NAMESPACE_BROWSER,
  DISPATCH_NAMESPACE_RUNNER,
  validateBrowserRpcRequest,
} from './protocol';
import {
  type BrowserProvider,
  type BrowserProviderContext,
  type BrowserProviderImplementation,
  type BrowserProviderPage,
  getBrowserProviderImplementation,
} from './providers';
import {
  createRunSession,
  type RunSession,
  RunSessionLifecycle,
} from './runSession';
import { RunnerSessionRegistry } from './sessionRegistry';
import {
  loadSourceMapWithCache,
  normalizeJavaScriptUrl,
  type SourceMapPayload,
} from './sourceMap/sourceMapLoader';
import { collectWatchTestFiles, planWatchRerun } from './watchRerunPlanner';

/**
 * Monotonic counter for synthetic per-file Perfetto `pid` values in `--trace`
 * mode. Browser host runs every test file inside the same Node process, so
 * without an override every file would emit events under the same `pid` and
 * share a single track labelled `worker <hostPid>`. Giving each file its own
 * synthetic `pid` makes the track title surface the file path instead,
 * matching node mode's default `isolate: true` behavior. The 1_000_000_000
 * base keeps each synthetic `pid` well clear of real OS `pid` values in
 * mixed-mode traces.
 */
let nextBrowserFilePid = 1_000_000_000;

// ============================================================================

/** Payload for test file start event */
type TestFileStartPayload = {
  testPath: string;
  projectName: string;
};

/** Payload for log event — single-sourced from the wire protocol. */
type LogPayload = BrowserLogPayload;

/** Payload for fatal error event */
type FatalPayload = {
  message: string;
  stack?: string;
};

type ReporterHookArg<THook extends keyof Reporter> =
  NonNullable<Reporter[THook]> extends (...args: infer TArgs) => unknown
    ? TArgs[0]
    : never;

type TestFileReadyPayload = ReporterHookArg<'onTestFileReady'>;
type TestSuiteStartPayload = ReporterHookArg<'onTestSuiteStart'>;
type TestSuiteResultPayload = ReporterHookArg<'onTestSuiteResult'>;
type TestCaseStartPayload = ReporterHookArg<'onTestCaseStart'>;
type ReloadTestFileAck = {
  runId: string;
};
type HeadedTestFileCompletePayload = TestFileResult & {
  runId?: string;
};

type DeferredPromise<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

const getFileTaskId = (testPath: string): string => {
  return `file:${testPath}`;
};

const createDeferredPromise = <T>(): DeferredPromise<T> => {
  let resolve!: DeferredPromise<T>['resolve'];
  let reject!: DeferredPromise<T>['reject'];
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve,
    reject,
  };
};

/** RPC methods exposed by the host (server) to the container (client) */
type HostRpcMethods = {
  rerunTest: (testFile: string, testNamePattern?: string) => Promise<void>;
  getTestFiles: () => Promise<TestFileInfo[]>;
  onRunnerFramesReady: (testFiles: string[]) => Promise<void>;
  // Test result callbacks from container
  onTestFileStart: (payload: TestFileStartPayload) => Promise<void>;
  onTestCaseResult: (payload: TestResult) => Promise<void>;
  onTestFileComplete: (payload: HeadedTestFileCompletePayload) => Promise<void>;
  onLog: (payload: LogPayload) => Promise<void>;
  onFatal: (payload: FatalPayload) => Promise<void>;
  // Generic dispatch endpoint used by runner RPC requests.
  dispatch: (
    request: BrowserDispatchRequest,
  ) => Promise<BrowserDispatchResponse>;
};

/** RPC methods exposed by the container (client) to the host (server) */
type ContainerRpcMethods = {
  onTestFileUpdate: (testFiles: TestFileInfo[]) => Promise<void>;
  reloadTestFile: (
    testFile: string,
    testNamePattern?: string,
  ) => Promise<ReloadTestFileAck>;
  /**
   * Replace the container's copy of the host config so runner iframes loaded
   * from now on receive fresh values (e.g. the 'u' shortcut flipping
   * `snapshot.updateSnapshot` between watch reruns).
   */
  onHostConfigUpdate: (config: BrowserHostConfig) => Promise<void>;
};

type ContainerRpc = BirpcReturn<ContainerRpcMethods, HostRpcMethods>;

// ============================================================================
// RPC Manager - Encapsulates WebSocket and birpc management
// ============================================================================

/**
 * Manages the WebSocket connection and birpc communication with the container UI.
 * Provides a clean interface for sending RPC calls and handling connections.
 */
export class ContainerRpcManager {
  private wss: WebSocketServer;
  private ws: WebSocket | null = null;
  private rpc: ContainerRpc | null = null;
  private methods: HostRpcMethods;
  private onDisconnect?: (error: Error) => void;
  private detachActiveSocketListeners: (() => void) | null = null;

  constructor(
    wss: WebSocketServer,
    methods: HostRpcMethods,
    onDisconnect?: (error: Error) => void,
  ) {
    this.wss = wss;
    this.methods = methods;
    this.onDisconnect = onDisconnect;
    this.setupConnectionHandler();
  }

  /** Update the RPC methods (used when starting a new test run) */
  updateMethods(
    methods: HostRpcMethods,
    onDisconnect?: (error: Error) => void,
  ): void {
    this.methods = methods;
    this.onDisconnect = onDisconnect;
    // Re-create birpc with new methods if already connected
    if (this.ws && this.ws.readyState === this.ws.OPEN) {
      this.attachWebSocket(this.ws);
    }
  }

  private setupConnectionHandler(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      logger.debug('[Browser UI] Container WebSocket connected');
      logger.debug(
        `[Browser UI] Current ws: ${this.ws ? 'exists' : 'null'}, new ws: ${ws ? 'exists' : 'null'}`,
      );
      this.attachWebSocket(ws);
    });
  }

  private attachWebSocket(ws: WebSocket): void {
    this.detachActiveSocketListeners?.();
    if (this.rpc && !this.rpc.$closed) {
      this.rpc.$close(new Error('Container RPC transport reattached'));
    }
    this.ws = ws;
    const messageHandlers = new WeakMap<
      (data: any) => void,
      (message: any) => void
    >();

    this.rpc = createBirpc<ContainerRpcMethods, HostRpcMethods>(this.methods, {
      timeout: -1,
      post: (data) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify(data));
        }
      },
      on: (fn) => {
        const handler = (message: any) => {
          try {
            const data = JSON.parse(message.toString());
            fn(data);
          } catch {
            // ignore invalid messages
          }
        };
        messageHandlers.set(fn, handler);
        ws.on('message', handler);
      },
      off: (fn) => {
        const handler = messageHandlers.get(fn);
        if (!handler) {
          return;
        }
        ws.off('message', handler);
        messageHandlers.delete(fn);
      },
    });

    const handleClose = () => {
      // Only clear if this is still the active connection
      // This prevents a race condition when a new connection is established
      // before the old one's close event fires
      if (this.ws === ws) {
        this.ws = null;
      }
      this.detachActiveSocketListeners?.();
      this.detachActiveSocketListeners = null;
      if (this.rpc && !this.rpc.$closed) {
        const disconnectError = new Error(
          'Browser UI WebSocket disconnected before reload completed',
        );
        this.rpc.$close(disconnectError);
        this.onDisconnect?.(disconnectError);
      }
      this.rpc = null;
    };

    ws.on('close', handleClose);
    this.detachActiveSocketListeners = () => {
      ws.off('close', handleClose);
    };
  }

  /** Check if a container is currently connected */
  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === this.ws.OPEN;
  }

  /** Get the current WebSocket instance (for reuse in watch mode) */
  get currentWebSocket(): WebSocket | null {
    return this.ws;
  }

  /** Reattach an existing WebSocket (for watch mode reuse) */
  reattach(ws: WebSocket): void {
    this.attachWebSocket(ws);
  }

  /** Notify container of test file changes */
  async notifyTestFileUpdate(files: TestFileInfo[]): Promise<void> {
    await this.rpc?.onTestFileUpdate(files);
  }

  /** Push a refreshed host config to the container (watch reruns) */
  async updateHostConfig(config: BrowserHostConfig): Promise<void> {
    await this.rpc?.onHostConfigUpdate(config);
  }

  /** Request container to reload a specific test file */
  async reloadTestFile(
    testFile: string,
    testNamePattern?: string,
  ): Promise<ReloadTestFileAck> {
    logger.debug(
      `[Browser UI] reloadTestFile called, rpc: ${this.rpc ? 'exists' : 'null'}, ws: ${this.ws ? 'exists' : 'null'}`,
    );
    if (!this.rpc) {
      throw new Error('Browser UI RPC not available for reloadTestFile');
    }
    logger.debug(`[Browser UI] Calling reloadTestFile: ${testFile}`);
    return this.rpc.reloadTestFile(testFile, testNamePattern);
  }
}

// ============================================================================
// Browser Runtime - Core runtime state
// ============================================================================

// ============================================================================
// Watch Mode Context - Process-lifecycle watch state
// ============================================================================

// Only process-wide concerns stay module-level: the runtime handle reused
// across controller re-entry (config-change restarts), and the signal/exit
// cleanup that must run once per process. Diff/rerun state lives on
// `BrowserRuntime.watchState`.
type WatchContext = {
  runtime: BrowserRuntime | null;
  cleanupRegistered: boolean;
  cleanupPromise: Promise<void> | null;
};

const watchContext: WatchContext = {
  runtime: null,
  cleanupRegistered: false,
  cleanupPromise: null,
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * The exit code a launch that found no test files at all must leave behind.
 *
 * Core's `reportNoTestFiles` owns the message and the no-test reporter
 * lifecycle for such a launch, but in watch mode its report deliberately leaves
 * the exit code alone — a rerun matching nothing is not a failure. Such a launch
 * opened no session, so no later cycle can raise the code either. That makes
 * this the host's only write to `process.exitCode`: a boot failure looks like a
 * second launch-path exception but is not one, because it rides the outcome out
 * of `failWithError` and core raises the code from there. One-shot runs keep
 * going through the cycle, and a caller that passed `allowEmptyRun` — today only
 * the config-hook discovery boot — reads the outcome instead of the process.
 */
const resolveEmptyLaunchExitCode = (
  current: number | string | undefined,
  {
    allowEmptyRun,
    isWatchMode,
    passWithNoTests,
  }: {
    allowEmptyRun: boolean;
    isWatchMode: boolean;
    passWithNoTests: boolean;
  },
): number | string | undefined => {
  if (allowEmptyRun || !isWatchMode || passWithNoTests) {
    return current;
  }
  // Never downgrade: a code already raised by an earlier failure stands.
  return current === undefined || current === 0 ? 1 : current;
};

const getMaxTestTimeoutForRpc = (projects: ProjectContext[]): number =>
  Math.max(
    ...projects.map(
      (p) => p.normalizedConfig.testTimeout ?? DEFAULT_TEST_TIMEOUT,
    ),
  );

const resolveProviderForTestPath = ({
  testPath,
  browserProjects,
}: {
  testPath: string;
  browserProjects: BrowserProviderProject[];
}): BrowserProvider => {
  const normalizedTestPath = normalize(testPath);
  const sortedProjects = [...browserProjects].sort(
    (a, b) => b.rootPath.length - a.rootPath.length,
  );

  for (const project of sortedProjects) {
    if (normalizedTestPath.startsWith(project.rootPath)) {
      return project.provider;
    }
  }

  throw new Error(
    `Cannot resolve browser provider for test path: ${JSON.stringify(testPath)}. ` +
      `Known project roots: ${JSON.stringify(sortedProjects.map((p) => p.rootPath))}`,
  );
};

/**
 * Tear down the persistent watch runtime (dev servers, provider, browser,
 * WebSocket server). Idempotent, and the single teardown the browser executor's
 * `close` and the process-exit nets both go through.
 */
export const runWatchRuntimeTeardown = <T>(
  state: { runtime: T | null; cleanupPromise: Promise<void> | null },
  destroy: (runtime: T) => Promise<void>,
): Promise<void> => {
  if (state.cleanupPromise) {
    return state.cleanupPromise;
  }

  state.cleanupPromise = (async () => {
    if (!state.runtime) {
      return;
    }

    await destroy(state.runtime);
    state.runtime = null;
  })();

  // The memo is released once this teardown settles, because the state outlives
  // the session: a config-file change restarts the run against a fresh runtime,
  // and a memo left resolved from the previous session would make every later
  // teardown a no-op — leaving the session after that to reuse a runtime built
  // from the pre-restart config. Idempotency only has to hold within a runtime.
  return state.cleanupPromise.finally(() => {
    state.cleanupPromise = null;
  });
};

export const cleanupWatchRuntime = (): Promise<void> =>
  // `cleanupRegistered` is deliberately not re-armed alongside the memo: the
  // signal nets it installs read `watchContext.runtime` live, so they stay
  // correct across a restart, and re-registering would stack a fresh set of
  // listeners on every one.
  runWatchRuntimeTeardown(watchContext, destroyBrowserRuntime);

const registerWatchCleanup = (embedded: boolean): void => {
  if (watchContext.cleanupRegistered) {
    return;
  }
  watchContext.cleanupRegistered = true;

  // Embedded (programmatic) hosts own the process lifecycle; they tear the
  // session down through the browser executor's `close` instead of signals.
  if (embedded) {
    return;
  }

  // Cleanup-only nets: core's watch loop owns the signal → exit-code path and
  // awaits the same idempotent `cleanupWatchRuntime` promise through the
  // browser executor's `close`.
  for (const signal of FATAL_SIGNALS) {
    process.once(signal, () => {
      void cleanupWatchRuntime();
    });
  }

  process.once('exit', () => {
    void cleanupWatchRuntime();
  });
};

// ============================================================================

/**
 * The watch-session control surface a watch-mode controller run hands back with
 * its initial cycle. Every rerun trigger the host owns (dev rebuild, HMR, the
 * in-page rerun button) resolves its own scope and then signals core's
 * invalidation subscriber; core resets the cycle state and calls back into
 * {@link BrowserWatchSession.runCycle} to execute it. A trigger that resolves to
 * no work never signals, so a scope matching none of this host's files produces
 * no cycle and no cycle output.
 */
export type BrowserWatchSession = {
  /** Execute the scope the last trigger resolved, as one cycle outcome. */
  runCycle: (testPaths: string[]) => Promise<ExecutorCycleOutcome>;
  /** Explicit path-scoped rerun request (a CLI shortcut's browser fanout). */
  requestRerun: (testPaths?: string[]) => Promise<void>;
};

export type BrowserControllerOptions = BrowserTestRunOptions & {
  /**
   * Watch only: core's watch-cycle driver (see `TestExecutor.onInvalidate`).
   * Its promise settles when the cycle it queued has finalized, which only an
   * explicit request may wait for (see `signalInvalidation`).
   */
  onInvalidate?: ExecutorInvalidationCallback;
};

export type BrowserControllerResult = BrowserTestRunResult & {
  watchSession?: BrowserWatchSession;
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

export const runBrowserController = async (
  context: RstestContext,
  options?: BrowserControllerOptions,
): Promise<BrowserControllerResult | void> => {
  const {
    allowEmptyRun = false,
    filesOnly = false,
    onTraceEvents,
    env,
    onInvalidate,
  } = options ?? {};
  const buildStart = Date.now();
  // Watch mode changes what this controller *owns*, never who finalizes: core's
  // `finalizeRunCycle` reduces every cycle on both commands. What watch adds is
  // a persistent runtime (reused across controller re-entry), the rerun
  // triggers, and HMR — so the initial run returns a live watch session instead
  // of a deferred `close`.
  const isWatchMode = context.command === 'watch';

  // Per-file PhaseTrackers, populated only when `--trace` is on (caller
  // passes `onTraceEvents`). The browser host shares one Node process across
  // every test file, so each tracker is assigned a synthetic per-file pid
  // (`nextBrowserFilePid`) that lets Perfetto render each file as its own
  // process track with the file path as the title. Keyed by project + path so
  // concurrent projects running the same file keep separate trackers.
  const phaseTrackers = onTraceEvents
    ? new Map<string, PhaseTracker>()
    : undefined;
  const trackerKey = (project: string, testPath: string) =>
    `${project}\u0000${testPath}`;
  // Explicit projects input (plan output) replaces re-deriving `browser.enabled`
  // projects from `context`, whose `projects` array is mutated during planning.
  // Falls back to re-derivation only when the caller passes no list at all —
  // an explicit empty subset must stay empty, not widen to every project.
  const browserProjects = options?.projects ?? getBrowserProjects(context);
  const useHeadlessDirect = browserProjects.every(
    (project) => project.normalizedConfig.browser.headless,
  );

  const browserSourceMapCache = new Map<string, SourceMapPayload | null>();

  const isHttpLikeFile = (file: string): boolean => /^https?:\/\//.test(file);

  const resolveBrowserSourcemap = async (sourcePath: string) => {
    if (!isHttpLikeFile(sourcePath)) {
      return {
        handled: false,
        sourcemap: null,
      };
    }

    const normalizedUrl = normalizeJavaScriptUrl(sourcePath);
    if (!normalizedUrl) {
      return {
        handled: true,
        sourcemap: null,
      };
    }

    if (browserSourceMapCache.has(normalizedUrl)) {
      return {
        handled: true,
        sourcemap: browserSourceMapCache.get(normalizedUrl) ?? null,
      };
    }

    return {
      handled: true,
      sourcemap: await loadSourceMapWithCache({
        jsUrl: normalizedUrl,
        cache: browserSourceMapCache,
      }),
    };
  };

  const getBrowserSourcemap = async (
    sourcePath: string,
  ): Promise<SourceMapPayload | null> => {
    const result = await resolveBrowserSourcemap(sourcePath);
    return result.handled ? result.sourcemap : null;
  };

  /**
   * Build an error BrowserTestRunResult and call onTestRunEnd if needed.
   * Used for early-exit error paths to ensure errors reach the summary report.
   */
  const buildErrorResult = (
    error: Error,
    close?: () => Promise<void>,
  ): BrowserTestRunResult => {
    const elapsed = Math.max(0, Date.now() - buildStart);
    return {
      results: [],
      testResults: [],
      duration: { totalTime: elapsed, buildTime: elapsed, testTime: 0 },
      hasFailure: true,
      unhandledErrors: [error],
      getSourcemap: getBrowserSourcemap,
      resolveSourcemap: resolveBrowserSourcemap,
      close,
    };
  };

  const toError = (error: unknown): Error => {
    return error instanceof Error ? error : new Error(String(error));
  };

  const failWithError = async (
    error: unknown,
    cleanup?: () => Promise<void>,
  ): Promise<BrowserTestRunResult> => {
    // The error rides the returned result into the cycle outcome, and core's
    // `finalizeRunCycle` raises the exit code from it — on both commands.
    const normalizedError = toError(error);

    if (cleanup && !isWatchMode) {
      return buildErrorResult(normalizedError, cleanup);
    }

    try {
      return buildErrorResult(normalizedError);
    } finally {
      await cleanup?.();
    }
  };

  const collectDeletedTestPaths = (
    previous: TestFileInfo[],
    current: TestFileInfo[],
  ): string[] => {
    const currentPathSet = new Set(current.map((file) => file.testPath));
    return previous
      .map((file) => file.testPath)
      .filter((testPath) => !currentPathSet.has(testPath));
  };

  const coverageConfig = browserProjects.find(
    (project) => project.normalizedConfig.coverage?.enabled,
  )?.normalizedConfig.coverage;
  const coverageProvider = coverageConfig?.enabled
    ? await createCoverageProvider(coverageConfig, context.rootPath)
    : null;

  const containerDevServerEnv = process.env.RSTEST_CONTAINER_DEV_SERVER;
  let containerDevServer: string | undefined;
  let containerDistPath: string | undefined;

  if (!useHeadlessDirect) {
    if (containerDevServerEnv) {
      try {
        containerDevServer = new URL(containerDevServerEnv).toString();
        logger.debug(
          `[Browser UI] Using dev server for container: ${containerDevServer}`,
        );
      } catch (error) {
        const originalError = toError(error);
        originalError.message = `Invalid RSTEST_CONTAINER_DEV_SERVER value: ${originalError.message}`;
        return failWithError(originalError);
      }
    }

    if (!containerDevServer) {
      try {
        containerDistPath = resolveContainerDist();
      } catch (error) {
        return failWithError(error);
      }
    }
  }

  let projectEntries = await resolveProjectEntries(
    context,
    options?.shardedEntries,
    browserProjects,
  );
  let totalTests = projectEntries.reduce(
    (total, item) => total + item.testFiles.length,
    0,
  );
  const shouldInitializeEmptyBrowserHooks =
    totalTests === 0 && hasUserRstestConfigPlugins(browserProjects);

  const createEmptyRunResult = (): BrowserTestRunResult => {
    const elapsed = Math.max(0, Date.now() - buildStart);
    return {
      results: [],
      testResults: [],
      duration: {
        totalTime: elapsed,
        buildTime: elapsed,
        testTime: 0,
      },
      hasFailure: false,
      getSourcemap: getBrowserSourcemap,
      resolveSourcemap: resolveBrowserSourcemap,
    };
  };

  const writeEmptyLaunchExitCode = (): void => {
    process.exitCode = resolveEmptyLaunchExitCode(process.exitCode, {
      allowEmptyRun,
      isWatchMode,
      passWithNoTests: context.normalizedConfig.passWithNoTests,
    });
  };

  if (totalTests === 0 && !shouldInitializeEmptyBrowserHooks) {
    writeEmptyLaunchExitCode();
    return allowEmptyRun ? createEmptyRunResult() : undefined;
  }

  const enableCliShortcuts = isWatchMode && isTTY('stdin');
  const browserTempOutputRoot = context.normalizedConfig.output.distPath.root;
  const tempDir =
    isWatchMode && watchContext.runtime
      ? watchContext.runtime.tempDir
      : isWatchMode
        ? join(context.rootPath, browserTempOutputRoot, 'browser', 'watch')
        : join(
            context.rootPath,
            browserTempOutputRoot,
            'browser',
            Date.now().toString(),
          );

  let runtime = isWatchMode ? watchContext.runtime : null;

  // The transport-owned rerun trigger, installed by whichever run branch
  // (headless/headed) executes below: resolve this rebuild's scope, then hand
  // it to core's invalidation subscriber. Populated after the initial cycle.
  let dispatchRerun: (() => Promise<void>) | undefined;

  if (!runtime) {
    try {
      runtime = await createBrowserRuntime({
        context,
        projectEntries,
        browserProjects,
        shardedEntries: options?.shardedEntries,
        freezeShardedEntries: options?.freezeShardedEntries,
        tempDir,
        isWatchMode,
        onTriggerRerun: isWatchMode
          ? async () => {
              await dispatchRerun?.();
            }
          : undefined,
        containerDistPath,
        containerDevServer,
        skipProviderLaunch: filesOnly,
        appliedModifyRstestConfigEnvironments:
          options?.appliedModifyRstestConfigEnvironments,
      });
    } catch (error) {
      return failWithError(error, async () => {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      });
    }

    // `filesOnly` is the config-hook discovery boot, which destroys its runtime
    // through the returned `close`. Caching it here would leave the real watch
    // session re-entering on a destroyed runtime.
    if (isWatchMode && !filesOnly) {
      watchContext.runtime = runtime;
      registerWatchCleanup(context.embedded);
    }
  }

  const watchState = runtime.watchState;

  // Track initial test files for watch mode (from this controller's freshly
  // collected entries, before adopting the runtime's entry snapshot below).
  if (isWatchMode) {
    watchState.lastTestFiles = collectWatchTestFiles(projectEntries);
  }

  // Mark files as pending-affected so the next trigger reruns them through the
  // normal plan/cycle pipeline (used by explicit rerun requests; omitted paths
  // = all current files). Returns the number of seeded files so a path-scoped
  // request matching no browser test file can skip the rerun entirely (mixed
  // watch 'u' with node-only snapshot updates must produce no browser cycle).
  const seedPendingRerun = (testPaths?: string[]): number => {
    const wanted = testPaths
      ? new Set(testPaths.map((testPath) => normalize(testPath)))
      : null;
    let seeded = 0;
    for (const file of watchState.lastTestFiles) {
      if (wanted && !wanted.has(file.testPath)) {
        continue;
      }
      const pending =
        watchState.pendingAffectedTestFiles.get(file.projectName) ??
        new Set<string>();
      pending.add(file.testPath);
      watchState.pendingAffectedTestFiles.set(file.projectName, pending);
      seeded += 1;
    }
    return seeded;
  };

  /**
   * Fold one watch rerun into the `ExecutorCycleOutcome` core's
   * `finalizeRunCycle` reduces. `context.reporterResults` is the cross-cycle
   * accumulator, so filtering it by the rerun's paths is what makes the outcome
   * cycle-scoped. `buildTime` is the drained duration of the change-triggered
   * compile(s) (zero for a shortcut-driven rerun, which compiles nothing).
   */
  const buildRerunOutcome = ({
    rerunTestPaths,
    testTime,
    unhandledErrors,
  }: {
    rerunTestPaths: string[];
    testTime: number;
    unhandledErrors?: Error[];
  }): ExecutorCycleOutcome => {
    const rerunPathSet = new Set(rerunTestPaths);
    const rerunResults = context.reporterResults.results.filter((result) =>
      rerunPathSet.has(result.testPath),
    );
    // Watch coverage is per-cycle on both transports: only the files this
    // rerun executed are reported.
    const coverageMap = buildBrowserCoverageMap(rerunResults, coverageProvider);

    return {
      results: rerunResults,
      testResults: context.reporterResults.testResults.filter((result) =>
        rerunPathSet.has(result.testPath),
      ),
      errors: unhandledErrors ?? [],
      testPaths: rerunTestPaths,
      duration: {
        buildTime: drainPendingBuildTime(watchState),
        testTime,
      },
      coverage: coverageMap?.files().length
        ? { map: coverageMap.toJSON() }
        : undefined,
      resolveSourcemap: resolveBrowserSourcemap,
    };
  };

  /**
   * Latest-wins interrupt, installed by the run branch whose in-flight run can
   * be cut short (headless). Core serializes cycles, so a trigger arriving
   * mid-cycle would otherwise wait out a run the user has already superseded.
   */
  let interruptInFlightRun: (() => Promise<void>) | undefined;

  /**
   * The cycle core is running for the scope last signalled. Only an explicit
   * request awaits it, right after it dispatched: a CLI shortcut's
   * `updateSnapshot` stays flipped only until `requestRerun` resolves, and the
   * in-page rerun button answers its RPC when the rerun is done. A rejection is
   * reported here rather than left to an awaiting caller, because compile-driven
   * triggers have no caller — and a failed cycle must not end the session.
   */
  let signalledCycle: Promise<void> | undefined;

  /**
   * Hand the scope this trigger resolved to core, which resets the cycle state,
   * calls back into the session's `runCycle`, and finalizes.
   *
   * The cycle is deliberately *not* awaited here. Rebuild triggers reach this
   * from inside the bundler's dev-compile hook, and the bundler keeps no
   * watcher attached while that hook is pending: anything created or deleted in
   * that window is never seen, so it never rebuilds and never reruns. Holding
   * the hook for a whole cycle widens that blind window to the cycle's full
   * duration, which loses test files added or removed mid-run for good. Core
   * serializes the cycles itself, so nothing here has to.
   *
   * The in-flight run is cut short here rather than at the trigger, because only
   * this point knows a replacement cycle is actually coming: a trigger that
   * resolves to no affected files must leave the running cycle alone, or it
   * finalizes on results it never produced.
   */
  const signalInvalidation = async (
    fileFilters: string[],
    /**
     * Run state this trigger binds to its own paths, taken in the same turn as
     * the handover — after any interrupt, so no queued cycle can be dequeued in
     * between and read it. The headed rerun's per-file test-name pattern is the
     * one such state; core's cycle options cannot carry it, so the only thing
     * that makes it the property of one cycle is claiming it here.
     */
    claimScope?: () => void,
  ): Promise<void> => {
    await interruptInFlightRun?.();
    claimScope?.();
    signalledCycle = Promise.resolve(
      onInvalidate?.({ isFirstBuild: false, fileFilters }),
    ).catch((error) => {
      logger.error(color.red('Browser Mode watch cycle failed:'), error);
    });
  };

  /**
   * The watch session both transports hand back. Only `execute` differs — the
   * cycle's timing, its fatal-error capture window, and the error-to-outcome
   * precedence are one contract with core, so they live in one place.
   *
   * `execute`'s synchronous prefix runs before `runCycle` ever suspends, which
   * is what lets the headed transport claim its cycle scope inside it.
   */
  const createWatchSession = (
    execute: (testPaths: string[]) => Promise<void>,
  ): BrowserWatchSession => ({
    runCycle: async (testPaths) => {
      const rerunStartTime = Date.now();
      const fatalErrorBeforeRun = fatalError;
      let rerunError: Error | undefined;

      try {
        await execute(testPaths);
      } catch (error) {
        // Surfaced through the outcome rather than thrown: core finalizes this
        // cycle either way, and its results belong in the report even when the
        // run that produced them ended badly.
        rerunError = toError(error);
      }

      const rerunFatalError =
        fatalError && fatalError !== fatalErrorBeforeRun
          ? fatalError
          : undefined;
      return buildRerunOutcome({
        rerunTestPaths: testPaths,
        testTime: Math.max(0, Date.now() - rerunStartTime),
        unhandledErrors: rerunError
          ? [rerunError]
          : rerunFatalError
            ? [rerunFatalError]
            : undefined,
      });
    },
    requestRerun: async (testPaths) => {
      const seeded = seedPendingRerun(testPaths);
      if (testPaths && seeded === 0) {
        return;
      }
      await dispatchRerun?.();
      await signalledCycle;
    },
  });

  projectEntries = runtime.projectEntries;
  totalTests = projectEntries.reduce(
    (total, item) => total + item.testFiles.length,
    0,
  );

  const buildTime = Date.now() - buildStart;

  if (filesOnly) {
    return {
      results: [],
      testResults: [],
      duration: {
        totalTime: buildTime,
        buildTime,
        testTime: 0,
      },
      hasFailure: false,
      getSourcemap: getBrowserSourcemap,
      resolveSourcemap: resolveBrowserSourcemap,
      close: () => destroyBrowserRuntime(runtime),
    };
  }

  if (totalTests === 0) {
    writeEmptyLaunchExitCode();
    await destroyBrowserRuntime(runtime);
    return allowEmptyRun ? createEmptyRunResult() : undefined;
  }

  const { browser, browserLaunchOptions, wsPort, wss } = runtime;

  // Collect all test files from project entries with project info
  // Normalize paths to posix format for cross-platform compatibility
  const allTestFiles: TestFileInfo[] = projectEntries.flatMap((entry) =>
    entry.testFiles.map((testPath) => ({
      testPath: normalize(testPath),
      projectName: entry.project.name,
    })),
  );

  // Only include browser mode projects in runtime configs
  // Normalize projectRoot to posix format for cross-platform compatibility
  const projectRuntimeConfigs: BrowserProjectRuntime[] = browserProjects.map(
    (project: ProjectContext) => ({
      name: project.name,
      environmentName: project.environmentName,
      projectRoot: normalize(project.rootPath),
      runtimeConfig: serializableConfig(
        // `env` is the post-globalSetup change-set from the core pre-cycle
        // stage; the projection layers it between the static base and the
        // user `test.env` config.
        projectRuntimeConfig(project, { envMode: 'static', envOverlay: env }),
      ),
      viewport: project.normalizedConfig.browser.viewport,
    }),
  );

  const maxTestTimeoutForRpc = getMaxTestTimeoutForRpc(browserProjects);

  const projectRunnerUrls = Object.fromEntries(
    [...runtime.projectServers].map(([name, server]) => [
      name,
      `http://localhost:${server.port}`,
    ]),
  );

  const hostOptions: BrowserHostConfig = {
    rootPath: normalize(context.rootPath),
    projects: projectRuntimeConfigs,
    snapshot: {
      updateSnapshot:
        options?.updateSnapshot ??
        context.snapshotManager.options.updateSnapshot,
    },
    // Container origin (fallback). Per-project runner origins below.
    runnerUrl: `http://localhost:${runtime.containerServer.port}`,
    projectRunnerUrls,
    wsPort,
    debug: isDebug(),
    rpcTimeout: maxTestTimeoutForRpc,
  };

  const browserProviderProjects: BrowserProviderProject[] = browserProjects.map(
    (project) => ({
      rootPath: normalize(project.rootPath),
      provider: project.normalizedConfig.browser.provider,
    }),
  );
  const implementationByProvider = new Map<
    BrowserProvider,
    BrowserProviderImplementation
  >();
  for (const browserProject of browserProviderProjects) {
    if (!implementationByProvider.has(browserProject.provider)) {
      implementationByProvider.set(
        browserProject.provider,
        getBrowserProviderImplementation(browserProject.provider),
      );
    }
  }

  let activeContainerPage: BrowserProviderPage | null = null;
  let getHeadlessRunnerPageBySessionId:
    ((sessionId: string) => BrowserProviderPage | undefined) | undefined;

  const dispatchBrowserRpcRequest = async ({
    request,
    target,
  }: {
    request: BrowserRpcRequest;
    target?: BrowserDispatchRequest['target'];
  }): Promise<unknown> => {
    const timeoutFallbackMs = maxTestTimeoutForRpc;
    const provider = resolveProviderForTestPath({
      testPath: request.testPath,
      browserProjects: browserProviderProjects,
    });
    const implementation = implementationByProvider.get(provider);
    if (!implementation) {
      throw new Error(`Browser provider implementation not found: ${provider}`);
    }

    const runnerPage = target?.sessionId
      ? getHeadlessRunnerPageBySessionId?.(target.sessionId)
      : undefined;

    if (target?.sessionId && !runnerPage) {
      throw new Error(
        `Runner page session not found for browser dispatch: ${target.sessionId}`,
      );
    }

    if (!runnerPage && !activeContainerPage) {
      throw new Error('Browser container page is not initialized');
    }

    try {
      return await implementation.dispatchRpc({
        containerPage: runnerPage
          ? undefined
          : (activeContainerPage ?? undefined),
        runnerPage,
        request,
        timeoutFallbackMs,
      });
    } catch (error) {
      // birpc serializes thrown Errors as `{}` over JSON; throw a string instead.
      if (error instanceof Error) {
        throw error.message;
      }
      throw String(error);
    }
  };

  runtime.dispatchHandlers.set(
    DISPATCH_NAMESPACE_BROWSER,
    async (dispatchRequest) => {
      const request = validateBrowserRpcRequest(dispatchRequest.args);
      return dispatchBrowserRpcRequest({
        request,
        target: dispatchRequest.target,
      });
    },
  );

  runtime.setContainerOptions(hostOptions);

  // Track test results from browser runners
  const reporterResults: TestFileResult[] = [];
  const caseResults: TestResult[] = [];
  let fatalError: Error | null = null;

  // Runner lifecycle events flow through the shared RunnerEventSink (the same
  // pump the node pool uses), so browser mode feeds stateManager and fans out to
  // reporters via one implementation. One sink is bound per browser project up
  // front from the executor's own project plan (`browserProjects`) — never from
  // `context.projects`, which planning mutates to also contain node projects. The
  // previous lazy resolver fell back to `context.projects[0]`, so a browser event
  // could be attributed to a *node* project's config; binding per browser project
  // here removes that fallback and keeps per-project `onConsoleLog` filtering and
  // `resolveSnapshotPath` correct across browser projects that share a relative
  // test path.
  const runnerSinks = new Map<string, RunnerEventSink>(
    browserProjects.map((project) => [
      project.name,
      createRunnerEventSink(context, project.normalizedConfig),
    ]),
  );
  // Every per-file wire payload carries its owning project name, so routing
  // never derives a project from a test path — concurrent projects can run the
  // same file, and a path-keyed lookup would attribute events to the wrong one.
  // The client resolves its project from the host's own manifest, so a miss is
  // a protocol bug; fail loudly rather than route through another project's
  // config.
  const sinkForProjectName = (projectName: string): RunnerEventSink => {
    const sink = runnerSinks.get(projectName);
    if (!sink) {
      throw new Error(`No runner event sink for project "${projectName}"`);
    }
    return sink;
  };

  // Silent-console buffering runs through the shared controller — the same
  // engine the node worker uses — so `silent: 'passed-only'` buffers logs and
  // replays only the failing tasks'. Intercepted replays route through the
  // owning project's sink, so they honor per-project `onConsoleLog` and
  // `disableConsoleIntercept` (the browser host previously flushed straight to
  // reporters, bypassing both). `writeOriginalLog` is a host-side no-op: page
  // logs have no host "original stream" — the page console and headed terminal
  // forwarding already show them, so re-emitting here would double-print.
  const silentConsoleController = createSilentConsoleController({
    runtimeConfig: {
      silent: context.normalizedConfig.silent,
      disableConsoleIntercept: context.normalizedConfig.disableConsoleIntercept,
    },
    emitInterceptedLog: (log) =>
      sinkForProjectName(log.project).onConsoleLog(log),
    writeOriginalLog: () => {},
  });

  const snapshotRpcMethods = {
    async resolveSnapshotPath(testPath: string): Promise<string> {
      return resolveSnapshotPathDefault(
        testPath,
        context.normalizedConfig.resolveSnapshotPath,
      );
    },
    async readSnapshotFile(filepath: string): Promise<string | null> {
      try {
        return await fs.readFile(filepath, 'utf-8');
      } catch {
        return null;
      }
    },
    async saveSnapshotFile(filepath: string, content: string): Promise<void> {
      const dir = dirname(filepath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filepath, content, 'utf-8');
    },
    async removeSnapshotFile(filepath: string): Promise<void> {
      try {
        await fs.unlink(filepath);
      } catch {
        // ignore if file doesn't exist
      }
    },
  };

  const handleTestFileStart = async (
    payload: TestFileStartPayload,
  ): Promise<void> => {
    if (phaseTrackers) {
      const tracker = new PhaseTracker({
        trace: {
          testPath: payload.testPath,
          project: payload.projectName,
        },
        pid: nextBrowserFilePid++,
      });
      tracker.transition('prepare');
      phaseTrackers.set(
        trackerKey(payload.projectName, payload.testPath),
        tracker,
      );
    }
    // The client sends `{ testPath, projectName }`; the sink adapter builds the
    // `TestFileInfo` the reporters and stateManager expect.
    await sinkForProjectName(payload.projectName).onTestFileStart({
      testId: getFileTaskId(payload.testPath),
      testPath: payload.testPath,
      project: payload.projectName,
      tests: [],
    });
  };

  const handleTestFileReady = async (
    payload: TestFileReadyPayload,
  ): Promise<void> => {
    phaseTrackers
      ?.get(trackerKey(payload.project, payload.testPath))
      ?.transition('tests');
    await sinkForProjectName(payload.project).onTestFileReady(payload);
  };

  const handleTestSuiteStart = async (
    payload: TestSuiteStartPayload,
  ): Promise<void> => {
    phaseTrackers
      ?.get(trackerKey(payload.project, payload.testPath))
      ?.recordSuiteStart(payload);
    await sinkForProjectName(payload.project).onTestSuiteStart(payload);
  };

  const handleTestSuiteResult = async (
    payload: TestSuiteResultPayload,
  ): Promise<void> => {
    phaseTrackers
      ?.get(trackerKey(payload.project, payload.testPath))
      ?.recordSuiteResult(payload);
    await sinkForProjectName(payload.project).onTestSuiteResult(payload);

    if (context.normalizedConfig.silent === 'passed-only') {
      silentConsoleController.flushBufferedLogsForTask({
        taskId: payload.testId,
        status: payload.status,
        taskParentNames: payload.parentNames,
        taskType: 'suite',
        testPath: payload.testPath,
      });
    }
  };

  const handleTestCaseStart = async (
    payload: TestCaseStartPayload,
  ): Promise<void> => {
    phaseTrackers
      ?.get(trackerKey(payload.project, payload.testPath))
      ?.recordCaseStart(payload);
    // Fire-and-forget on both transports (the sink does not await case-start).
    sinkForProjectName(payload.project).onTestCaseStart(payload);
  };

  const handleTestCaseResult = async (payload: TestResult): Promise<void> => {
    caseResults.push(payload);
    phaseTrackers
      ?.get(trackerKey(payload.project, payload.testPath))
      ?.recordCaseResult(payload);
    await sinkForProjectName(payload.project).onTestCaseResult(payload);

    if (context.normalizedConfig.silent === 'passed-only') {
      silentConsoleController.flushBufferedLogsForTask({
        taskId: payload.testId,
        status: payload.status,
        taskParentNames: payload.parentNames,
        taskType: 'case',
        testPath: payload.testPath,
      });
    }
  };

  const handleTestFileComplete = async (
    payload: TestFileResult,
  ): Promise<void> => {
    reporterResults.push(payload);
    context.updateReporterResultState([payload], payload.results);

    if (phaseTrackers) {
      const key = trackerKey(payload.project, payload.testPath);
      const tracker = phaseTrackers.get(key);
      if (tracker) {
        tracker.end();
        const events = tracker.getTraceEvents();
        if (events) onTraceEvents?.(events);
        phaseTrackers.delete(key);
      }
    }

    if (context.normalizedConfig.silent === 'passed-only') {
      silentConsoleController.flushBufferedLogsForTask({
        taskId: payload.testId,
        status: payload.status,
        taskParentNames: payload.parentNames,
        taskType: 'file',
        testPath: payload.testPath,
      });
    }

    // Feeds stateManager, fans out onTestFileResult to reporters, and ingests
    // payload.snapshotResult (the snapshotManager.add moved into the sink).
    await sinkForProjectName(payload.project).onTestFileResult(payload);
  };

  const handleLog = async (payload: LogPayload): Promise<void> => {
    const log: UserConsoleLog = {
      content: payload.content,
      // Same colored level label as the node worker's CustomConsole.
      name: getPrettyConsoleName(payload.level),
      taskId: payload.taskId,
      taskName: payload.taskName,
      taskParentNames: payload.taskParentNames,
      taskType: payload.taskType,
      testPath: payload.testPath,
      project: payload.projectName,
      type: payload.type,
      trace: payload.trace,
    };
    silentConsoleController.onConsoleLog(log);
  };

  // Every failing file and every fatal error reaches core through the cycle
  // outcome on both commands, so the exit code keeps a single writer:
  // `finalizeRunCycle`.
  const handleFatal = async (payload: FatalPayload): Promise<void> => {
    const error = new Error(payload.message);
    error.stack = payload.stack;
    fatalError = error;
  };

  const runSnapshotRpc = async (
    request: SnapshotRpcRequest,
  ): Promise<unknown> => {
    switch (request.method) {
      case 'resolveSnapshotPath':
        return snapshotRpcMethods.resolveSnapshotPath(request.args.testPath);
      case 'readSnapshotFile':
        return snapshotRpcMethods.readSnapshotFile(request.args.filepath);
      case 'saveSnapshotFile':
        return snapshotRpcMethods.saveSnapshotFile(
          request.args.filepath,
          request.args.content,
        );
      case 'removeSnapshotFile':
        return snapshotRpcMethods.removeSnapshotFile(request.args.filepath);
      default: {
        // Exhaustiveness guard: a new SnapshotRpcRequest method without a case
        // here fails to compile rather than silently returning undefined.
        const _exhaustive: never = request;
        return _exhaustive;
      }
    }
  };

  const createDispatchRouter = (options?: HostDispatchRouterOptions) => {
    return createHostDispatchRouter({
      routerOptions: options,
      runnerCallbacks: {
        onTestFileStart: handleTestFileStart,
        onTestFileReady: handleTestFileReady,
        onTestSuiteStart: handleTestSuiteStart,
        onTestSuiteResult: handleTestSuiteResult,
        onTestCaseStart: handleTestCaseStart,
        onTestCaseResult: handleTestCaseResult,
        onTestFileComplete: handleTestFileComplete,
        onLog: handleLog,
        onFatal: handleFatal,
      },
      runSnapshotRpc,
      extensionHandlers: runtime.dispatchHandlers,
      onDuplicateNamespace: (namespace) => {
        logger.debug(
          `[Dispatch] Skip registering dispatch namespace "${namespace}" because it is already reserved`,
        );
      },
    });
  };

  if (useHeadlessDirect) {
    // Session-based scheduling path: lifecycle + session index + dispatch routing.
    type ActiveHeadlessRun = RunSession & {
      contexts: Set<BrowserProviderContext>;
    };

    const viewportByProject = mapViewportByProject(projectRuntimeConfigs);
    const runLifecycle = new RunSessionLifecycle<ActiveHeadlessRun>();
    const sessionRegistry = new RunnerSessionRegistry();
    getHeadlessRunnerPageBySessionId = (sessionId) => {
      return sessionRegistry.getById(sessionId)?.page;
    };
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
      let settled = false;
      let resolveDone: (() => void) | null = null;

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
        if (
          settled ||
          run.cancelled ||
          !runLifecycle.isTokenActive(run.token)
        ) {
          return;
        }
        settled = true;
        crashDeferred.resolve(reason);
      };

      try {
        page = await browserContext.newPage();
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

        await attachHeadlessRunnerTransport(page, {
          onDispatchMessage: async (message) => {
            try {
              await dispatchRunnerMessage(run, file, session.id, message);
              if (
                message.type === 'file-complete' ||
                message.type === 'complete'
              ) {
                markDone();
              } else if (message.type === 'fatal') {
                markDone();
                await cancelRun(run, false);
              }
            } catch (error) {
              const formatted = toError(error);
              await handleFatal({
                message: formatted.message,
                stack: formatted.stack,
              });
              markDone();
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

        const projectServer = runtime.projectServers.get(file.projectName);
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
          await handleFatal({ message: state.reason });
          await cancelRun(run, false);
        }
      } catch (error) {
        if (runLifecycle.isTokenActive(run.token) && !run.cancelled) {
          const formatted = toError(error);
          await handleFatal({
            message: formatted.message,
            stack: formatted.stack,
          });
          await cancelRun(run, false);
        }
      } finally {
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

    const runFilesWithPool = async (files: TestFileInfo[]): Promise<void> => {
      if (files.length === 0) {
        return;
      }

      const previous = runLifecycle.activeSession;
      if (previous) {
        await cancelRun(previous);
      }

      const run = runLifecycle.createSession((token) => ({
        ...createRunSession(token),
        contexts: new Set<BrowserProviderContext>(),
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
          await runSingleFile(run, next);
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
    };

    const testStart = Date.now();
    await runFilesWithPool(allTestFiles);
    const testTime = Date.now() - testStart;

    let watchSession: BrowserWatchSession | undefined;
    if (isWatchMode) {
      // A queued scope can go stale before its cycle is dequeued — a later
      // trigger may have rebuilt the file set without one of these files — so a
      // path that no longer resolves is skipped rather than failing the cycle
      // beside its still-valid siblings.
      const runScope = async (testPaths: string[]): Promise<void> => {
        const pathSet = new Set(
          testPaths.map((testPath) => normalize(testPath)),
        );
        await runFilesWithPool(
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
      interruptInFlightRun = async () => {
        const active = runLifecycle.activeSession;
        if (!active || active.cancelled) {
          return;
        }
        runLifecycle.invalidateActiveToken();
        await runLifecycle.cancel(active, { waitForDone: false });
      };

      dispatchRerun = async () => {
        const newProjectEntries = await collectProjectEntries(context);
        const rerunPlan = planWatchRerun({
          projectEntries: newProjectEntries,
          previousTestFiles: watchState.lastTestFiles,
          affectedTestFiles: drainPendingAffectedTestFiles(watchState),
        });

        if (rerunPlan.filesChanged) {
          const deletedTestPaths = collectDeletedTestPaths(
            watchState.lastTestFiles,
            rerunPlan.currentTestFiles,
          );
          if (deletedTestPaths.length > 0) {
            context.updateReporterResultState([], [], deletedTestPaths);
          }
          watchState.lastTestFiles = rerunPlan.currentTestFiles;
          if (rerunPlan.currentTestFiles.length === 0) {
            logger.log(
              color.cyan('No browser test files remain after update.\n'),
            );
            // Still one cycle: core's finalize reports the emptied run.
            await signalInvalidation([]);
            return;
          }

          logger.log(
            color.cyan(
              `Test file set changed, re-running ${rerunPlan.currentTestFiles.length} file(s)...\n`,
            ),
          );
          await signalInvalidation([
            ...new Set(rerunPlan.currentTestFiles.map((file) => file.testPath)),
          ]);
          return;
        }

        if (rerunPlan.affectedTestFiles.length === 0) {
          logger.log(
            color.cyan(
              'No affected browser test files detected, skipping re-run.\n',
            ),
          );
          logWatchReadyMessage(context, enableCliShortcuts);
          return;
        }

        logger.log(
          color.cyan(
            `Re-running ${rerunPlan.affectedTestFiles.length} affected test file(s)...\n`,
          ),
        );
        await signalInvalidation([
          ...new Set(rerunPlan.affectedTestFiles.map((file) => file.testPath)),
        ]);
      };

      watchSession = createWatchSession(runScope);
    }

    const closeHeadlessRuntime = !isWatchMode
      ? async () => {
          sessionRegistry.clear();
          await destroyBrowserRuntime(runtime);
        }
      : undefined;

    if (fatalError) {
      return failWithError(fatalError, closeHeadlessRuntime);
    }

    const duration = {
      totalTime: buildTime + testTime,
      buildTime,
      testTime,
    };

    context.updateReporterResultState(reporterResults, caseResults);

    // Enable the compile hooks only after the initial cycle, so the first build
    // never triggers a duplicate run.
    watchState.hooksEnabled = isWatchMode;

    return {
      results: reporterResults,
      testResults: caseResults,
      duration,
      hasFailure: reporterResults.some(
        (result: TestFileResult) => result.status === 'fail',
      ),
      getSourcemap: getBrowserSourcemap,
      resolveSourcemap: resolveBrowserSourcemap,
      // `closeHeadlessRuntime` is already `undefined` in watch mode: the watch
      // runtime outlives the cycle and is torn down through `executor.close()`.
      close: closeHeadlessRuntime,
      watchSession,
    };
  }

  let currentTestFiles = allTestFiles;
  // Coincidentally equal to the runner-side CONFIG_WAIT_TIMEOUT_MS and
  // DEFAULT_RPC_TIMEOUT_MS (client/entry.ts, client/dispatchTransport.ts) but
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

  if (isWatchMode && runtime.containerPage && runtime.containerContext) {
    containerContext = runtime.containerContext;
    containerPage = runtime.containerPage;
    logger.log(color.gray('\n[Watch] Reusing existing container page\n'));
  } else {
    isNewPage = true;
    containerContext = await browser.newContext({
      providerOptions: browserLaunchOptions.providerOptions,
      viewport: null,
    });
    containerPage = await containerContext.newPage();

    // Prevent popup windows from being created
    containerPage.on('popup', async (popup: BrowserProviderPage) => {
      await popup.close().catch(() => {});
    });

    containerContext.on('page', async (page: BrowserProviderPage) => {
      if (page !== containerPage) {
        await page.close().catch(() => {});
      }
    });

    if (isWatchMode) {
      runtime.containerPage = containerPage;
      runtime.containerContext = containerContext;
    }

    // Forward browser console to terminal
    containerPage.on('console', (msg) => {
      const text = msg.text();
      if (text.startsWith('[Container]') || text.startsWith('[Runner]')) {
        logger.log(color.gray(`[Browser Console] ${text}`));
      }
    });
  }

  activeContainerPage = containerPage;

  const dispatchRouter = createDispatchRouter();
  const headedReloadQueue = createHeadedSerialTaskQueue();
  const pendingHeadedReloads = new Map<
    string,
    {
      runId: string;
      deferred: DeferredPromise<void>;
    }
  >();
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
    pendingHeadedReloads.delete(testPath);
    pending.deferred.reject(error);
  };

  const rejectAllPendingHeadedReloads = (error: Error): void => {
    for (const [testPath, pending] of pendingHeadedReloads) {
      pendingHeadedReloads.delete(testPath);
      pending.deferred.reject(error);
    }
  };

  const registerPendingHeadedReload = (
    testPath: string,
    runId: string,
  ): Promise<void> => {
    const previousPending = pendingHeadedReloads.get(testPath);
    if (previousPending) {
      previousPending.deferred.reject(
        new Error(
          `Reload for "${testPath}" was superseded by a newer request.`,
        ),
      );
      pendingHeadedReloads.delete(testPath);
    }

    const deferred = createDeferredPromise<void>();
    pendingHeadedReloads.set(testPath, {
      runId,
      deferred,
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
    pendingHeadedReloads.delete(testPath);
    pending.deferred.resolve();
  };

  // No execution-duration watchdog: per-test/hook timeouts are enforced inside
  // the runner, and a dead container is caught event-driven by the WebSocket
  // `close` handler, which rejects every pending reload via `onDisconnect`.
  const reloadTestFileAndWait = async (
    file: TestFileInfo,
    testNamePattern?: string,
  ): Promise<void> => {
    let reloadAck: ReloadTestFileAck | undefined;

    try {
      reloadAck = await rpcManager.reloadTestFile(
        file.testPath,
        testNamePattern,
      );
      await registerPendingHeadedReload(file.testPath, reloadAck.runId);
    } catch (error) {
      if (reloadAck?.runId) {
        rejectPendingHeadedReload(
          file.testPath,
          toError(error),
          reloadAck.runId,
        );
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
      try {
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
    const pagePath = '/';
    const containerPort = runtime.containerServer.port;
    await containerPage.goto(`http://localhost:${containerPort}${pagePath}`, {
      waitUntil: 'load',
    });

    logger.log(
      color.cyan(
        `\nBrowser mode opened at http://localhost:${containerPort}${pagePath}\n`,
      ),
    );
  }

  enqueueHeadedReload = async (
    file: TestFileInfo,
    testNamePattern?: string,
  ): Promise<void> => {
    return headedReloadQueue.enqueue(async () => {
      if (fatalError) {
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
        if (fatalError) {
          break;
        }
      }
    } catch (error) {
      // The fatal error rides the returned result into the cycle outcome, and
      // core's `finalizeRunCycle` raises the exit code from it.
      fatalError = fatalError ?? toError(error);
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

    const runScope = async (testPaths: string[]): Promise<void> => {
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

    dispatchRerun = async () => {
      // Independent: config push to the container vs. local entry collection.
      const [, newProjectEntries] = await Promise.all([
        refreshHostConfig(),
        collectProjectEntries(context),
      ]);
      const rerunPlan = planWatchRerun({
        projectEntries: newProjectEntries,
        previousTestFiles: watchState.lastTestFiles,
        affectedTestFiles: drainPendingAffectedTestFiles(watchState),
      });

      if (rerunPlan.filesChanged) {
        const deletedTestPaths = collectDeletedTestPaths(
          watchState.lastTestFiles,
          rerunPlan.currentTestFiles,
        );
        if (deletedTestPaths.length > 0) {
          context.updateReporterResultState([], [], deletedTestPaths);
        }
        watchState.lastTestFiles = rerunPlan.currentTestFiles;
        currentTestFiles = rerunPlan.currentTestFiles;
        await rpcManager.notifyTestFileUpdate(currentTestFiles);
        if (currentTestFiles.length === 0) {
          logger.log(
            color.cyan('No browser test files remain after update.\n'),
          );
          logWatchReadyMessage(context, enableCliShortcuts);
          return;
        }
        await waitForRunnerFramesReady(
          currentTestFiles.map((file) => file.testPath),
        );
      }

      if (rerunPlan.normalizedAffectedTestFiles.length > 0) {
        logger.log(
          color.cyan(
            `Re-running ${rerunPlan.normalizedAffectedTestFiles.length} affected test file(s)...\n`,
          ),
        );
        await signalInvalidation(rerunPlan.normalizedAffectedTestFiles);
        return;
      }

      if (!rerunPlan.filesChanged) {
        logger.log(color.cyan('Tests will be re-executed automatically\n'));
      }
      logWatchReadyMessage(context, enableCliShortcuts);
    };

    runUiRequestedRerun = async (file, testNamePattern) => {
      await refreshHostConfig();
      await signalInvalidation([file.testPath], () => {
        if (testNamePattern === undefined) {
          pendingTestNamePatterns.delete(normalize(file.testPath));
        } else {
          pendingTestNamePatterns.set(
            normalize(file.testPath),
            testNamePattern,
          );
        }
      });
      await signalledCycle;
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
        await destroyBrowserRuntime(runtime);
      }
    : undefined;

  if (fatalError) {
    return failWithError(fatalError, closeContainerRuntime);
  }

  const duration = {
    totalTime: buildTime + testTime,
    buildTime,
    testTime,
  };

  context.updateReporterResultState(reporterResults, caseResults);

  // Enable the compile hooks only after the initial cycle, so the first build
  // never triggers a duplicate run.
  watchState.hooksEnabled = isWatchMode;

  return {
    results: reporterResults,
    testResults: caseResults,
    duration,
    hasFailure: reporterResults.some(
      (result: TestFileResult) => result.status === 'fail',
    ),
    getSourcemap: getBrowserSourcemap,
    resolveSourcemap: resolveBrowserSourcemap,
    // `closeContainerRuntime` is already `undefined` in watch mode: the watch
    // runtime outlives the cycle and is torn down through `executor.close()`.
    close: closeContainerRuntime,
    watchSession,
  };
};

// ============================================================================
// List Browser Tests
// ============================================================================

/**
 * Result from collecting browser tests.
 * This is the return type for listBrowserTests, designed for future extraction
 * to a separate browser package.
 */
export type ListBrowserTestsResult = {
  list: ListCommandResult[];
  close: () => Promise<void>;
};

/**
 * Collect test metadata from browser mode projects without running them.
 * This function creates a headless browser runtime, loads test files,
 * and collects their test structure (describe/test declarations).
 */
export const listBrowserTests = async (
  context: RstestContext,
  options?: ListBrowserTestsOptions,
): Promise<ListBrowserTestsResult> => {
  const browserProjects = options?.projects ?? getBrowserProjects(context);
  const projectEntries = await resolveProjectEntries(
    context,
    options?.shardedEntries,
    browserProjects,
  );
  const totalTests = projectEntries.reduce(
    (total, item) => total + item.testFiles.length,
    0,
  );

  if (totalTests === 0 && !hasUserRstestConfigPlugins(browserProjects)) {
    return {
      list: [],
      close: async () => {},
    };
  }

  const tempDir = join(
    context.rootPath,
    context.normalizedConfig.output.distPath.root,
    'browser',
    `list-${Date.now()}`,
  );

  // Create a simplified browser runtime for collect mode
  let runtime: BrowserRuntime;
  try {
    runtime = await createBrowserRuntime({
      context,
      projectEntries,
      browserProjects,
      shardedEntries: options?.shardedEntries,
      freezeShardedEntries: options?.freezeShardedEntries,
      tempDir,
      isWatchMode: false,
      containerDistPath: undefined,
      containerDevServer: undefined,
      forceHeadless: true, // Always use headless for list command
      skipProviderLaunch: options?.filesOnly,
      appliedModifyRstestConfigEnvironments:
        options?.appliedModifyRstestConfigEnvironments,
    });
  } catch (error) {
    const providers = [
      ...new Set(
        browserProjects.map((p) => p.normalizedConfig.browser.provider),
      ),
    ];
    logger.error(
      color.red(
        `Failed to initialize browser provider runtime (${providers.join(', ')}).`,
      ),
      error,
    );
    throw error;
  }

  if (options?.filesOnly) {
    const list = runtime.projectEntries.flatMap((entry) =>
      entry.testFiles.map((testPath) => ({
        testPath,
        project: entry.project.name,
        tests: [],
      })),
    );
    await destroyBrowserRuntime(runtime);
    return {
      list,
      close: async () => {},
    };
  }

  if (!runtime.projectEntries.some((entry) => entry.testFiles.length > 0)) {
    await destroyBrowserRuntime(runtime);
    return {
      list: [],
      close: async () => {},
    };
  }

  const { browser, browserLaunchOptions } = runtime;

  // Get browser projects for runtime config
  // Normalize projectRoot to posix format for cross-platform compatibility
  const projectRuntimeConfigs: BrowserProjectRuntime[] = browserProjects.map(
    (project: ProjectContext) => ({
      name: project.name,
      environmentName: project.environmentName,
      projectRoot: normalize(project.rootPath),
      runtimeConfig: serializableConfig(
        projectRuntimeConfig(project, {
          envMode: 'static',
          envOverlay: options?.env,
        }),
      ),
      viewport: project.normalizedConfig.browser.viewport,
    }),
  );

  const maxTestTimeoutForRpc = getMaxTestTimeoutForRpc(browserProjects);

  const hostOptions: BrowserHostConfig = {
    rootPath: normalize(context.rootPath),
    projects: projectRuntimeConfigs,
    snapshot: {
      updateSnapshot: context.snapshotManager.options.updateSnapshot,
    },
    mode: 'collect', // Use collect mode
    debug: isDebug(),
    rpcTimeout: maxTestTimeoutForRpc,
  };

  runtime.setContainerOptions(hostOptions);

  // Collect results across every project's isolated dev server. Each server
  // serves only its own project's manifest, so collection navigates one page
  // per project; each page returns its own results, aggregated afterwards.
  const browserContext = await browser.newContext({
    providerOptions: browserLaunchOptions.providerOptions,
    viewport: null,
  });

  const serializedOptions = serializeForInlineScript(hostOptions);

  // Per-page collect watchdog: a test file whose module evaluation stalls must
  // not hang `rstest list` forever.
  const collectTimeoutMs = 30_000;

  const collectFromServer = async (
    server: BrowserProjectServer,
  ): Promise<{ results: ListCommandResult[]; error: Error | null }> => {
    const results: ListCommandResult[] = [];
    let error: Error | null = null;
    let collectCompleted = false;
    let resolveCollect: (() => void) | undefined;
    const collectPromise = new Promise<void>((resolve) => {
      resolveCollect = resolve;
    });

    const page = await browserContext.newPage();

    // Expose dispatch function for browser client to send messages
    await page.exposeFunction(
      DISPATCH_MESSAGE_TYPE,
      (message: { type: string; payload?: unknown }) => {
        switch (message.type) {
          case 'collect-result': {
            const payload = message.payload as {
              testPath: string;
              project: string;
              tests: Test[];
            };
            results.push({
              testPath: payload.testPath,
              project: payload.project,
              tests: payload.tests,
            });
            break;
          }
          case 'collect-complete':
            collectCompleted = true;
            resolveCollect?.();
            break;
          case 'fatal': {
            const payload = message.payload as {
              message: string;
              stack?: string;
            };
            error = new Error(payload.message);
            error.stack = payload.stack;
            resolveCollect?.();
            break;
          }
          case 'ready':
          case 'log':
            // Ignore these messages during collection
            break;
          default:
            // Log unexpected messages for debugging
            logger.debug(`[List] Unexpected message: ${message.type}`);
        }
      },
    );

    // Inject host options before navigation so the runner can access them
    await page.addInitScript(
      `window.__RSTEST_BROWSER_OPTIONS__ = ${serializedOptions};`,
    );

    // Navigate to this project's runner page
    await page.goto(`http://localhost:${server.port}/runner.html`, {
      waitUntil: 'load',
    });

    // Wait for collection to complete with the shared collect timeout.
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<void>((resolve) => {
      timeoutId = setTimeout(() => {
        if (!collectCompleted) {
          logger.warn(
            color.yellow(
              `[List] Browser test collection timed out after ${collectTimeoutMs}ms`,
            ),
          );
        }
        resolve();
      }, collectTimeoutMs);
    });

    await Promise.race([collectPromise, timeoutPromise]);

    // Clear timeout to prevent Node.js from waiting for it
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    await page.close().catch(() => {});
    return { results, error };
  };

  // Collect every project concurrently — each navigates its own page against
  // its own dev server and returns its own results.
  const collected = await Promise.all(
    [...runtime.projectServers.values()].map((server) =>
      collectFromServer(server),
    ),
  );
  const collectResults = collected.flatMap((entry) => entry.results);
  const fatalError = collected.find((entry) => entry.error)?.error ?? null;

  // Cleanup
  const cleanup = async () => {
    try {
      await browserContext.close();
    } catch {
      // ignore
    }
    await destroyBrowserRuntime(runtime);
  };

  if (fatalError) {
    await cleanup();
    // Return error in the result format instead of throwing
    const errorResult: ListCommandResult = {
      testPath: '',
      project: '',
      tests: [],
      errors: [
        {
          name: 'BrowserCollectError',
          message: fatalError.message,
          stack: fatalError.stack,
        } as FormattedError,
      ],
    };
    return {
      list: [errorResult],
      close: async () => {},
    };
  }

  return {
    list: collectResults,
    close: cleanup,
  };
};
