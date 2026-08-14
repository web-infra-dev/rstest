import {
  type ManifestProjectConfig,
  type ManifestTestContext,
  projectSetupLoaders,
  // Multi-project APIs
  projects,
  projectTestContexts,
} from '__rstest_virtual_browser_manifest__';
import type {
  CoverageMapData,
  CurrentTaskInfo,
  FileCleanupHooks,
  RunnerHooks,
  RuntimeConfig,
  WorkerState,
} from '@rstest/core/internal/browser-runtime';
import {
  createBrowserTaskContext,
  createRstestRuntime,
  cleanupWorkerFixtures as cleanupWorkerFixtureInstances,
  FIXTURE_CLEANUP_TIMEOUT_MS,
  formatConsoleArgs,
  globalApis,
  getRealTimers,
  RSTEST_API_GLOBAL_KEY,
  RSTEST_ENV_SYMBOL_KEY,
  RSTEST_IMPORT_META_GLOBAL_KEY,
  setRealTimers,
  unwrapRegex,
} from '@rstest/core/internal/browser-runtime';
import { normalize } from 'pathe';
import type {
  BrowserClientMessage,
  BrowserProjectRuntime,
  FileCleanupDispatchMethod,
  FileCleanupDispatchPayload,
  RunnerEnvelope,
  RunnerLifecycleMethod,
} from '../protocol';
import {
  DISPATCH_MESSAGE_TYPE,
  DISPATCH_NAMESPACE_FILE_CLEANUP,
  RSTEST_BROWSER_CACHE_CLEANERS_KEY,
  RSTEST_CONFIG_MESSAGE_TYPE,
} from '../protocol';
import {
  createRequestId,
  createRunnerLifecycleRequest,
  dispatchRpc,
  disposeDispatchTransport,
  getRpcTimeout,
  setRpcPhase,
  sendDispatchRequest,
} from './dispatchTransport';
import { adoptRunIdentity, getRunIdentity } from './runIdentity';
import { BrowserSnapshotEnvironment } from './snapshot';
import {
  findNewScriptUrl,
  getScriptUrls,
  preloadRunnerSourceMap,
  preloadTestFileSourceMap,
} from './sourceMapSupport';

declare global {
  // eslint-disable-next-line no-var
  var __coverage__: Record<string, unknown> | undefined;
}

/**
 * Debug logger for browser client.
 * Only logs when debug mode is enabled (DEBUG=rstest on server side).
 */
const debugLog = (...args: unknown[]): void => {
  if (window.__RSTEST_BROWSER_OPTIONS__?.debug) {
    console.log(...args);
  }
};

const cloneCoverage = (coverage: CoverageMapData): CoverageMapData =>
  JSON.parse(JSON.stringify(coverage)) as CoverageMapData;

const subtractCounters = (
  current: Record<string, number>,
  previous?: Record<string, number>,
): Record<string, number> =>
  Object.fromEntries(
    Object.entries(current).map(([key, value]) => [
      key,
      value - (previous?.[key] ?? 0),
    ]),
  );

const getCoverageDelta = (
  current: CoverageMapData,
  previous?: CoverageMapData,
): CoverageMapData =>
  Object.fromEntries(
    Object.entries(current).map(([path, file]) => {
      const previousFile = previous?.[path];
      return [
        path,
        {
          ...file,
          s: subtractCounters(file.s, previousFile?.s),
          f: subtractCounters(file.f, previousFile?.f),
          b: Object.fromEntries(
            Object.entries(file.b).map(([key, values]) => [
              key,
              values.map(
                (value, index) => value - (previousFile?.b[key]?.[index] ?? 0),
              ),
            ]),
          ),
        },
      ];
    }),
  );

const cleanupWorkerFixturesWithTimeout = async (): Promise<void> => {
  const realTimers = getRealTimers();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      cleanupWorkerFixtureInstances(),
      new Promise<never>((_, reject) => {
        timer = realTimers.setTimeout?.(() => {
          reject(
            new Error(
              `Worker fixture cleanup did not finish within ${FIXTURE_CLEANUP_TIMEOUT_MS}ms`,
            ),
          );
        }, FIXTURE_CLEANUP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) {
      realTimers.clearTimeout?.(timer);
    }
  }
};

type RuntimeEnvStore = Record<string, string | undefined>;
const RSTEST_ENV_SYMBOL = Symbol.for(RSTEST_ENV_SYMBOL_KEY);

/**
 * Publish the runtime API on the globals test modules read: the
 * `@rstest/core` external and the `import.meta.rstest` define (node parity:
 * `global['@rstest/core']` in runInPool), plus the `globals: true` API names.
 */
const installRuntimeGlobals = (
  runtime: Awaited<ReturnType<typeof createRstestRuntime>>,
  runtimeConfig: RuntimeConfig,
): void => {
  Object.assign(globalThis, {
    [RSTEST_API_GLOBAL_KEY]: runtime.api,
    [RSTEST_IMPORT_META_GLOBAL_KEY]: runtime.resolveImportMetaRstest,
  });
  if (runtimeConfig.globals) {
    for (const apiKey of globalApis) {
      (globalThis as any)[apiKey] = (runtime.api as any)[apiKey];
    }
  }
};

const clearBrowserTestEntryCache = (testEntryPath: string): void => {
  const cleaners = (
    globalThis as typeof globalThis &
      Record<
        typeof RSTEST_BROWSER_CACHE_CLEANERS_KEY,
        Set<(testEntryPath: string) => void> | undefined
      >
  )[RSTEST_BROWSER_CACHE_CLEANERS_KEY];
  cleaners?.forEach((clean) => clean(testEntryPath));
};

type GlobalWithRuntimeEnv = typeof globalThis &
  Record<symbol, unknown> & {
    global?: typeof globalThis;
  };

const restoreRuntimeConfig = (
  config: BrowserProjectRuntime['runtimeConfig'],
): RuntimeConfig => {
  const { testNamePattern } = config;
  // The browser wire (BrowserRuntimeConfig) omits node-only fields
  // (testEnvironment / coverage / logHeapUsage / detectAsyncLeaks) that the
  // browser runtime never reads. The shared WorkerState / runner types require
  // the full RuntimeConfig shape and runner heap sampling is guarded against
  // the absent logHeapUsage, so widening back here is sound.
  return {
    ...config,
    testNamePattern:
      typeof testNamePattern === 'string'
        ? unwrapRegex(testNamePattern)
        : testNamePattern,
  } as RuntimeConfig;
};

const ensureRuntimeEnv = (env: RuntimeConfig['env'] | undefined): void => {
  const globalRef = globalThis as GlobalWithRuntimeEnv;
  if (!globalRef.global) {
    globalRef.global = globalRef;
  }

  const existingEnv = globalRef[RSTEST_ENV_SYMBOL];
  let runtimeEnv: RuntimeEnvStore;
  if (existingEnv && typeof existingEnv === 'object') {
    runtimeEnv = existingEnv as RuntimeEnvStore;
  } else {
    runtimeEnv = {};
    globalRef[RSTEST_ENV_SYMBOL] = runtimeEnv;
  }

  if (env) {
    for (const [key, value] of Object.entries(env)) {
      const normalizedValue =
        typeof value === 'string'
          ? value
          : value == null
            ? undefined
            : String(value);

      if (normalizedValue === undefined) {
        delete runtimeEnv[key];
      } else {
        runtimeEnv[key] = normalizedValue;
      }
    }
  }
};

const getFileTaskId = (testPath: string): string => {
  return `file:${testPath}`;
};

/**
 * Intercept console methods and forward to host via send().
 * Returns a restore function to revert console to original.
 */
const interceptConsole = (
  projectName: string,
  getCurrentTask: () => CurrentTaskInfo | undefined,
  printConsoleTrace: boolean,
): (() => void) => {
  const originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
  };

  const getConsoleTrace = (): string | undefined => {
    if (!printConsoleTrace) return undefined;
    const stack = new Error('STACK_TRACE').stack;
    // Skip: Error, getConsoleTrace, createConsoleInterceptor wrapper, console.log call
    return stack?.split('\n').slice(4).join('\n');
  };

  const createConsoleInterceptor = (
    level: 'log' | 'warn' | 'error' | 'info' | 'debug',
  ) => {
    return (...args: unknown[]) => {
      // Call original for browser DevTools
      originalConsole[level](...args);

      const content = formatConsoleArgs(args);
      const currentTask = getCurrentTask();

      // Send to host
      send({
        type: 'log',
        payload: {
          level,
          content,
          projectName,
          taskId: currentTask?.taskId,
          taskName: currentTask?.taskName,
          taskParentNames: currentTask?.taskParentNames,
          taskType: currentTask?.taskType,
          testPath: currentTask?.testPath ?? '',
          type: level === 'error' || level === 'warn' ? 'stderr' : 'stdout',
          trace: getConsoleTrace(),
        },
      });
    };
  };

  console.log = createConsoleInterceptor('log');
  console.warn = createConsoleInterceptor('warn');
  console.error = createConsoleInterceptor('error');
  console.info = createConsoleInterceptor('info');
  console.debug = createConsoleInterceptor('debug');

  return () => {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.info = originalConsole.info;
    console.debug = originalConsole.debug;
  };
};

const send = (message: BrowserClientMessage): void => {
  const envelope: RunnerEnvelope = { runId: getRunIdentity(), message };
  // If in iframe, send to parent window (container) which will forward to host via RPC
  if (window.parent !== window) {
    window.parent.postMessage(
      { type: DISPATCH_MESSAGE_TYPE, payload: envelope },
      '*',
    );
    return;
  }
  // Fallback: direct call if running outside iframe (not typical)
  // Note: This binding may not exist if not using Playwright
  window[DISPATCH_MESSAGE_TYPE]?.(envelope);
};

const dispatchRunnerLifecycle = (
  method: RunnerLifecycleMethod,
  payload: unknown,
): void => {
  sendDispatchRequest(
    createRunnerLifecycleRequest(method, payload),
    (error: unknown) => {
      debugLog('[Runner] Failed to dispatch lifecycle method:', method, error);
    },
  );
};

/**
 * Timeout for waiting for browser config from container (30 seconds).
 *
 * Coincidentally equal to the RPC default (client/dispatchTransport.ts) and the
 * host's RUNNER_FRAMES_READY_TIMEOUT_MS (hostController.ts), but semantically
 * distinct and in a different runtime, so deliberately not shared. Implicit
 * invariant: this must not exceed the host's frames-ready timeout, or the host
 * declares the runner un-ready before it can even receive its config.
 */
const CONFIG_WAIT_TIMEOUT_MS = 30_000;

/**
 * Wait for configuration from container if running in iframe.
 * This is a prerequisite for test execution - without config, tests cannot run.
 */
const waitForConfig = (): Promise<void> => {
  // If not in iframe or already has config, resolve immediately
  if (window.parent === window || window.__RSTEST_BROWSER_OPTIONS__) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const handleMessage = (event: MessageEvent) => {
      const payload = event.data?.payload;
      if (
        event.data?.type === RSTEST_CONFIG_MESSAGE_TYPE &&
        typeof payload?.runId === 'string'
      ) {
        window.__RSTEST_BROWSER_OPTIONS__ = payload;
        debugLog(
          '[Runner] Received config from container:',
          event.data.payload,
        );
        window.removeEventListener('message', handleMessage);
        resolve();
      }
    };

    window.addEventListener('message', handleMessage);

    setTimeout(() => {
      window.removeEventListener('message', handleMessage);
      reject(
        new Error(
          `[Rstest] Failed to receive browser config within ${CONFIG_WAIT_TIMEOUT_MS / 1000}s. ` +
            'This may indicate a connection issue between the runner iframe and container.',
        ),
      );
    }, CONFIG_WAIT_TIMEOUT_MS);
  });
};

/**
 * Convert absolute path to context key (relative path)
 * e.g., '/project/src/foo.test.ts' -> './src/foo.test.ts'
 *       'D:/project/src/foo.test.ts' -> './src/foo.test.ts'
 *
 * Uses pathe's normalize to handle cross-platform path separators.
 */
const toContextKey = (absolutePath: string, projectRoot: string): string => {
  // Normalize both paths to use forward slashes for cross-platform compatibility
  const normalizedAbsolute = normalize(absolutePath);
  const normalizedRoot = normalize(projectRoot);

  // Only strip the root at a path boundary: a bare `startsWith` would mangle a
  // sibling like `/repo/pkg-extra/a.test.ts` under root `/repo/pkg`. Must stay
  // in sync with the host `toContextKey` (hostController.ts) so the non-watch
  // import-map keys resolve.
  const withinRoot =
    normalizedAbsolute === normalizedRoot ||
    normalizedAbsolute.startsWith(`${normalizedRoot}/`);
  if (!withinRoot) {
    // Test file outside the project root: keep the absolute path as the key so
    // `toAbsolutePath` round-trips it instead of re-rooting under projectRoot.
    return normalizedAbsolute;
  }
  const relative = normalizedAbsolute.slice(normalizedRoot.length);
  return relative.startsWith('/') ? `.${relative}` : `./${relative}`;
};

/**
 * Convert context key to absolute path
 * e.g., './src/foo.test.ts' -> '/project/src/foo.test.ts'
 */
const toAbsolutePath = (key: string, projectRoot: string): string => {
  // An absolute key (test file outside the project root, see `toContextKey`)
  // round-trips as-is; only `./`-prefixed relative keys are re-rooted.
  if (!key.startsWith('.')) {
    return key;
  }
  // key format: ./src/foo.test.ts
  // Ensure no double slashes by removing trailing slash from projectRoot
  const normalizedRoot = normalize(projectRoot).replace(/\/$/, '');
  return normalizedRoot + key.slice(1);
};

/**
 * Find the project that contains the given test file.
 * Matches by checking if the testFile path starts with the project root.
 *
 * Uses pathe's normalize to handle cross-platform path separators.
 */
const findProjectForTestFile = (
  testFile: string,
  allProjects: ManifestProjectConfig[],
): ManifestProjectConfig | undefined => {
  // Normalize the test file path for cross-platform compatibility
  const normalizedTestFile = normalize(testFile);

  // Sort projects by root path length (longest first) for most specific match
  const sorted = [...allProjects].sort(
    (a, b) => b.projectRoot.length - a.projectRoot.length,
  );

  for (const proj of sorted) {
    // projectRoot should already be normalized, but normalize again for safety
    const normalizedRoot = normalize(proj.projectRoot);
    if (normalizedTestFile.startsWith(normalizedRoot)) {
      return proj;
    }
  }

  // Fallback to first project
  return allProjects[0];
};

const run = async () => {
  // Wait for configuration if in iframe
  await waitForConfig();
  let options = window.__RSTEST_BROWSER_OPTIONS__;

  if (options?.runId) {
    adoptRunIdentity(options.runId);
  }

  // Support reading testFile and testNamePattern from URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const urlTestFile = urlParams.get('testFile');
  const urlTestNamePattern = urlParams.get('testNamePattern');

  if (urlTestFile && options) {
    // Override testFile from URL parameter
    options = {
      ...options,
      testFile: urlTestFile,
    };
  }

  // Override testNamePattern from URL parameter if provided
  if (urlTestNamePattern && options) {
    options = {
      ...options,
      projects: options.projects.map((project) => ({
        ...project,
        runtimeConfig: {
          ...project.runtimeConfig,
          testNamePattern: urlTestNamePattern,
        },
      })),
    };
  }

  if (!options) {
    send({
      type: 'fatal',
      payload: {
        message: 'Browser test runtime is not configured.',
      },
    });
    window.__RSTEST_DONE__ = true;
    return;
  }

  send({ type: 'ready' });

  setRealTimers();

  // Snapshot code runs in runner.js, so preload its sourcemap to map stack
  // traces back to original source files.
  await preloadRunnerSourceMap();

  // Find the project for this test file
  const targetTestFile = options.testFile;
  const targetTestFiles = options.testFiles?.length
    ? options.testFiles
    : targetTestFile
      ? [targetTestFile]
      : undefined;
  const currentProject = targetTestFile
    ? findProjectForTestFile(
        targetTestFile,
        projects as ManifestProjectConfig[],
      )
    : (projects as ManifestProjectConfig[])[0];

  if (!currentProject) {
    send({
      type: 'fatal',
      payload: {
        message: 'No project found for test file',
      },
    });
    window.__RSTEST_DONE__ = true;
    return;
  }

  // Find the runtime config for this project
  const projectRuntime = options.projects.find(
    (p) => p.name === currentProject.name,
  );
  if (!projectRuntime) {
    send({
      type: 'fatal',
      payload: {
        message: `Project ${currentProject.name} not found in runtime options`,
      },
    });
    window.__RSTEST_DONE__ = true;
    return;
  }

  const runtimeConfig = restoreRuntimeConfig(projectRuntime.runtimeConfig);
  ensureRuntimeEnv(runtimeConfig.env);

  // Get this project's setup loaders and test context
  const currentSetupLoaders =
    (projectSetupLoaders as Record<string, Array<() => Promise<unknown>>>)[
      currentProject.name
    ] || [];
  const currentTestContext = (
    projectTestContexts as Record<string, ManifestTestContext>
  )[currentProject.name];

  if (!currentTestContext) {
    send({
      type: 'fatal',
      payload: {
        message: `Test context not found for project ${currentProject.name}`,
      },
    });
    window.__RSTEST_DONE__ = true;
    return;
  }

  const loadSetupFiles = async (): Promise<void> => {
    for (const loadSetup of currentSetupLoaders) {
      await loadSetup();
    }
  };

  // 1. Determine which test files to run
  let testKeysToRun: string[];

  if (targetTestFiles) {
    testKeysToRun = targetTestFiles.map((testFile) =>
      toContextKey(testFile, currentProject.projectRoot),
    );
  } else {
    // Full run mode: get all test keys from context
    testKeysToRun = currentTestContext.getTestKeys();
  }

  // Check execution mode
  const executionMode = options.mode || 'run';

  // Collect mode: only gather test metadata without running
  if (executionMode === 'collect') {
    for (const key of testKeysToRun) {
      const testPath = toAbsolutePath(key, currentProject.projectRoot);

      const workerState: WorkerState = {
        project: projectRuntime.name,
        projectRoot: projectRuntime.projectRoot,
        rootPath: options.rootPath,
        runtimeConfig,
        taskId: 0,
        // The kept-module-cache flush keyed on `buildId` is node worker-pool
        // only (#1373); browser runners never reuse a node worker, so a constant
        // inert id is correct here.
        buildId: 0,
        outputModule: false,
        environment: 'browser',
        testPath,
        distPath: testPath,
        snapshotOptions: {
          updateSnapshot: options.snapshot.updateSnapshot,
          snapshotEnvironment: new BrowserSnapshotEnvironment(),
          snapshotFormat: runtimeConfig.snapshotFormat,
        },
      };

      const runtime = await createRstestRuntime(workerState, {
        taskContext: createBrowserTaskContext(),
      });

      installRuntimeGlobals(runtime, runtimeConfig);

      try {
        setRpcPhase('framework');

        // Load setup files for this project after runtime is ready.
        await loadSetupFiles();

        clearBrowserTestEntryCache(testPath);

        // Load the test file dynamically (registers tests without running)
        await currentTestContext.loadTest(key);

        // Collect tests metadata
        const tests = await runtime.runner.collectTests();

        send({
          type: 'collect-result',
          payload: {
            testPath,
            project: projectRuntime.name,
            tests,
          },
        });
      } catch (_error) {
        const error =
          _error instanceof Error ? _error : new Error(String(_error));
        send({
          type: 'fatal',
          payload: {
            message: error.message,
            stack: error.stack,
          },
        });
        window.__RSTEST_DONE__ = true;
        return;
      }
    }

    send({ type: 'collect-complete' });
    window.__RSTEST_DONE__ = true;
    return;
  }

  // Capture unhandled errors/rejections that escape a test file's execution.
  // Parity with the node worker, which attaches process-level
  // uncaughtException/unhandledRejection to the running file's result and fails
  // the file. `activeUnhandledErrors` points at the currently running file's
  // collector (undefined between files, so stray late events are ignored).
  let activeUnhandledErrors: Error[] | undefined;
  const onWindowError = (event: ErrorEvent): void => {
    activeUnhandledErrors?.push(
      event.error instanceof Error
        ? event.error
        : new Error(event.message || String(event.error)),
    );
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    const { reason } = event;
    activeUnhandledErrors?.push(
      reason instanceof Error ? reason : new Error(String(reason)),
    );
  };
  window.addEventListener('error', onWindowError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);

  // 2. Run tests for each file. A non-isolated browser worker keeps the
  // worker fixture context alive while this page processes its assigned files;
  // isolated execution tears it down after each file.
  const keepWorkerFixtures =
    runtimeConfig.isolate === false && projectRuntime.hasSetupFiles !== true;
  let restoreWorkerConsole: (() => void) | undefined;
  let workerCleanupFailed = false;
  let workerCleanupAttempted = false;
  let setupListeners:
    | ReturnType<
        Awaited<
          ReturnType<typeof createRstestRuntime>
        >['runner']['getRootSuiteListeners']
      >
    | undefined;
  let previousIstanbulCoverage: CoverageMapData | undefined;
  try {
    for (let fileIndex = 0; fileIndex < testKeysToRun.length; fileIndex++) {
      const key = testKeysToRun[fileIndex]!;
      const testPath = toAbsolutePath(key, currentProject.projectRoot);
      options = { ...options, testFile: testPath };
      window.__RSTEST_BROWSER_OPTIONS__ = options;
      const taskStack: CurrentTaskInfo[] = [
        {
          taskId: getFileTaskId(testPath),
          taskType: 'file',
          testPath,
        },
      ];

      // Per-file TaskContext; taskStack supplies the concurrent attribution
      // that the single-slot fallback can't.
      const taskContext = createBrowserTaskContext();

      const shouldInterceptConsole =
        !runtimeConfig.disableConsoleIntercept ||
        runtimeConfig.silent === true ||
        runtimeConfig.silent === 'passed-only';

      // Intercept console methods to forward logs to host
      const restoreConsole = shouldInterceptConsole
        ? interceptConsole(
            projectRuntime.name,
            () => taskContext.getCurrent() ?? taskStack[taskStack.length - 1],
            runtimeConfig.disableConsoleIntercept
              ? false
              : (runtimeConfig.printConsoleTrace ?? false),
          )
        : () => {};

      // Keep a restoration handle in the outer finally before any runtime
      // setup can throw. This covers failures during runtime construction or
      // global installation, which happen before the per-file try/finally.
      if (keepWorkerFixtures) {
        restoreWorkerConsole = restoreConsole;
      }

      const workerState: WorkerState = {
        project: projectRuntime.name,
        projectRoot: projectRuntime.projectRoot,
        rootPath: options.rootPath,
        runtimeConfig,
        taskId: 0,
        // See the `buildId` note above: inert in browser mode.
        buildId: 0,
        outputModule: false,
        environment: 'browser',
        currentTask: taskStack[0],
        testPath,
        distPath: testPath,
        snapshotOptions: {
          updateSnapshot: options.snapshot.updateSnapshot,
          snapshotEnvironment: new BrowserSnapshotEnvironment(),
          snapshotFormat: runtimeConfig.snapshotFormat,
        },
      };

      const syncCurrentTask = (): void => {
        workerState.currentTask = taskStack[taskStack.length - 1];
      };

      const removeTaskFromStack = (taskId: string): void => {
        const taskIndex = taskStack.findLastIndex(
          (task) => task.taskId === taskId,
        );
        if (taskIndex < 0) {
          return;
        }
        taskStack.splice(taskIndex, 1);
        syncCurrentTask();
      };

      let runtime: Awaited<ReturnType<typeof createRstestRuntime>>;
      try {
        runtime = await createRstestRuntime(workerState, {
          taskContext,
        });
        installRuntimeGlobals(runtime, runtimeConfig);
      } catch (error) {
        restoreConsole();
        throw error;
      }

      let failedTestsCount = 0;

      const dispatchFileCleanup = async (
        method: FileCleanupDispatchMethod,
        result?: FileCleanupDispatchPayload['result'],
        waitForAcknowledgement = true,
      ): Promise<void> => {
        const requestId = createRequestId(`file-cleanup-${method}`);
        const request = {
          requestId,
          namespace: DISPATCH_NAMESPACE_FILE_CLEANUP,
          method,
          args: {
            projectName: projectRuntime.name,
            result,
            runId: getRunIdentity(),
            testPath,
          } satisfies FileCleanupDispatchPayload,
        };

        if (!waitForAcknowledgement) {
          sendDispatchRequest(request);
          return;
        }

        await dispatchRpc<void>({
          requestId,
          request,
          timeoutMs: getRpcTimeout('framework'),
          timeoutMessage: `File cleanup ${method} acknowledgement timed out for ${testPath}.`,
          staleMessage: `File cleanup ${method} became stale for ${testPath}.`,
        });
      };

      const cleanupWorkerFixtures = async (
        result?: FileCleanupDispatchPayload['result'],
      ): Promise<void> => {
        await dispatchFileCleanup('worker-start', result);
        try {
          await cleanupWorkerFixturesWithTimeout();
        } finally {
          await dispatchFileCleanup('worker-end');
        }
      };

      const updateIstanbulCoverage = (
        result: Awaited<ReturnType<typeof runtime.runner.runTests>>,
      ): void => {
        if (!globalThis.__coverage__) {
          return;
        }
        const currentCoverage = globalThis.__coverage__ as CoverageMapData;
        result.coverage = getCoverageDelta(
          currentCoverage,
          previousIstanbulCoverage,
        );
        previousIstanbulCoverage = cloneCoverage(currentCoverage);
      };

      const runnerHooks: RunnerHooks & FileCleanupHooks = {
        onFileCleanupStart: async (result) => {
          if (result && globalThis.__coverage__) {
            result.coverage = globalThis.__coverage__ as CoverageMapData;
          }
          await dispatchFileCleanup('start', result, window.parent !== window);
        },
        onFileCleanupEnd: () =>
          dispatchFileCleanup('end', undefined, window.parent !== window),
        onSnapshotSetupStart: async () => {
          setRpcPhase('framework');
        },
        onSnapshotSetupEnd: async () => {
          setRpcPhase('test');
        },
        onSnapshotFinishStart: async () => {
          setRpcPhase('framework');
        },
        onSnapshotFinishEnd: async () => {
          setRpcPhase('test');
        },
        onTestFileReady: async (test) => {
          dispatchRunnerLifecycle('file-ready', test);
        },
        onTestSuiteStart: async (test) => {
          taskStack.push({
            taskId: test.testId,
            taskName: test.name,
            taskParentNames: test.parentNames,
            taskType: 'suite',
            testPath: test.testPath,
          });
          syncCurrentTask();
          dispatchRunnerLifecycle('suite-start', test);
        },
        onTestSuiteResult: async (result) => {
          removeTaskFromStack(result.testId);
          dispatchRunnerLifecycle('suite-result', result);
        },
        onTestCaseStart: async (test) => {
          taskStack.push({
            taskId: test.testId,
            taskName: test.name,
            taskParentNames: test.parentNames,
            taskType: 'case',
            testPath: test.testPath,
          });
          syncCurrentTask();
          dispatchRunnerLifecycle('case-start', test);
        },
        onTestCaseResult: async (result) => {
          removeTaskFromStack(result.testId);
          if (result.status === 'fail') {
            failedTestsCount++;
          }
          send({
            type: 'case-result',
            payload: result,
          });
        },
        getCountOfFailedTests: async () => failedTestsCount,
      };

      send({
        type: 'file-start',
        payload: {
          testPath,
          projectName: projectRuntime.name,
        },
      });

      const unhandledErrors: Error[] = [];
      activeUnhandledErrors = unhandledErrors;

      try {
        setRpcPhase('framework');

        // Setup modules are cached when a non-isolated browser worker runs
        // multiple files. Replay their root hooks on each fresh runtime so
        // setup hooks retain per-file semantics without recreating the worker.
        if (setupListeners) {
          runtime.runner.setRootSuiteListeners(setupListeners);
        }
        await loadSetupFiles();
        setupListeners ??= runtime.runner.getRootSuiteListeners();

        // Record script URLs before loading the test file
        const beforeScripts = getScriptUrls();

        // Load the test file dynamically using this project's context
        await currentTestContext.loadTest(key);

        // Find the newly loaded chunk and preload its source map (for inline snapshots)
        const afterScripts = getScriptUrls();
        const chunkUrl = findNewScriptUrl(beforeScripts, afterScripts);
        if (chunkUrl) {
          await preloadTestFileSourceMap(chunkUrl);
        }

        const result = await runtime.runner.runTests(
          testPath,
          runnerHooks,
          runtime.api,
        );

        // Headed execution and single-file batches are file-like even when the
        // config keeps worker fixtures. Finish that cleanup before publishing
        // file-complete so the host cannot reload the next iframe while the
        // worker scope is still tearing down. A multi-file headless batch must
        // defer worker cleanup until its final file.
        const cleanupBeforeFileComplete =
          !keepWorkerFixtures || fileIndex === testKeysToRun.length - 1;
        if (cleanupBeforeFileComplete) {
          workerCleanupAttempted = true;
          try {
            await cleanupWorkerFixtures(result);
          } catch (cleanupError) {
            const formattedCleanupError =
              cleanupError instanceof Error
                ? cleanupError
                : new Error(String(cleanupError));
            result.status = 'fail';
            result.errors = [
              ...(result.errors ?? []),
              {
                fullStack: true,
                message: `Worker fixture cleanup failed: ${formattedCleanupError.message}`,
                name: formattedCleanupError.name,
                stack: formattedCleanupError.stack,
              },
            ];
          }
        }

        updateIstanbulCoverage(result);

        // The browser dispatches `unhandledrejection` in a task queued at the
        // current task's microtask checkpoint, so a rejection leaked by a
        // synchronous test is not observable yet when `runTests()` resolves.
        // Yield two macrotasks: the first reaches the checkpoint that queues
        // the event task, the second runs after that task regardless of how
        // the browser orders the timer and event task sources.
        for (let i = 0; i < 2; i++) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
          });
        }

        // An unhandled error/rejection that escaped the run fails the file even
        // when every test passed.
        if (unhandledErrors.length > 0) {
          result.status = 'fail';
          result.errors = [
            ...(result.errors ?? []),
            ...unhandledErrors.map((error) => ({
              name: error.name,
              message: error.message,
              stack: error.stack,
            })),
          ];
        }

        send({
          type: 'file-complete',
          payload: result,
        });
      } catch (_error) {
        let error =
          _error instanceof Error ? _error : new Error(String(_error));
        if (!workerCleanupAttempted) {
          try {
            workerCleanupAttempted = true;
            await cleanupWorkerFixtures();
          } catch (cleanupError) {
            const formattedCleanupError =
              cleanupError instanceof Error
                ? cleanupError
                : new Error(String(cleanupError));
            error = new Error(
              `${error.message}\nWorker fixture cleanup failed: ${formattedCleanupError.message}`,
              { cause: error },
            );
          }
        }
        send({
          type: 'fatal',
          payload: {
            message: error.message,
            stack: error.stack,
          },
        });
        window.__RSTEST_DONE__ = true;
        return;
      } finally {
        if (keepWorkerFixtures && fileIndex === testKeysToRun.length - 1) {
          restoreWorkerConsole = restoreConsole;
        } else {
          restoreConsole();
        }
        activeUnhandledErrors = undefined;
      }
    }
  } finally {
    if (keepWorkerFixtures && !workerCleanupAttempted) {
      try {
        await cleanupWorkerFixturesWithTimeout();
      } catch (error) {
        workerCleanupFailed = true;
        const cleanupError =
          error instanceof Error ? error : new Error(String(error));
        send({
          type: 'fatal',
          payload: {
            message: cleanupError.message,
            stack: cleanupError.stack,
          },
        });
      }
    }
    restoreWorkerConsole?.();
  }

  window.removeEventListener('error', onWindowError);
  window.removeEventListener('unhandledrejection', onUnhandledRejection);

  if (workerCleanupFailed) {
    window.__RSTEST_DONE__ = true;
    return;
  }

  send({ type: 'complete' });
  window.__RSTEST_DONE__ = true;
};

void run()
  .catch((error) => {
    const err = error instanceof Error ? error : new Error(String(error));
    send({
      type: 'fatal',
      payload: {
        message: err.message,
        stack: err.stack,
      },
    });
    window.__RSTEST_DONE__ = true;
  })
  .finally(() => {
    disposeDispatchTransport();
  });
