import {
  type ManifestProjectConfig,
  type ManifestTestContext,
  projectSetupLoaders,
  // Multi-project APIs
  projects,
  projectTestContexts,
} from '@rstest/browser-manifest';
import type {
  RunnerHooks,
  RuntimeConfig,
  WorkerState,
} from '@rstest/core/browser-runtime';
import {
  createRstestRuntime,
  globalApis,
  setRealTimers,
} from '@rstest/core/browser-runtime';
import { normalize } from 'pathe';
import type {
  BrowserClientMessage,
  BrowserHostConfig,
  BrowserProjectRuntime,
} from '../protocol';
import { BrowserSnapshotEnvironment } from './snapshot';
import {
  findNewScriptUrl,
  getScriptUrls,
  preloadRunnerSourceMap,
  preloadTestFileSourceMap,
} from './sourceMapSupport';

declare global {
  interface Window {
    __RSTEST_BROWSER_OPTIONS__?: BrowserHostConfig;
    __rstest_dispatch__?: (message: BrowserClientMessage) => void;
  }
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

type GlobalWithProcess = typeof globalThis & {
  global?: typeof globalThis;
  process?: NodeJS.Process;
};

const REGEXP_FLAG_PREFIX = 'RSTEST_REGEXP:';

const unwrapRegex = (value: string): string | RegExp => {
  if (value.startsWith(REGEXP_FLAG_PREFIX)) {
    const raw = value.slice(REGEXP_FLAG_PREFIX.length);
    const match = raw.match(/^\/(.+)\/([gimuy]*)$/);
    if (match) {
      const [, pattern, flags] = match;
      return new RegExp(pattern!, flags);
    }
  }
  return value;
};

const restoreRuntimeConfig = (
  config: BrowserProjectRuntime['runtimeConfig'],
): RuntimeConfig => {
  const { testNamePattern } = config as RuntimeConfig;
  return {
    ...config,
    testNamePattern:
      typeof testNamePattern === 'string'
        ? unwrapRegex(testNamePattern)
        : testNamePattern,
  };
};

const ensureProcessEnv = (env: RuntimeConfig['env'] | undefined): void => {
  const globalRef = globalThis as GlobalWithProcess;
  if (!globalRef.global) {
    globalRef.global = globalRef;
  }

  if (!globalRef.process) {
    const processShim: Partial<NodeJS.Process> & {
      env: Record<string, string | undefined>;
    } = {
      env: {},
      argv: [],
      version: 'browser',
      cwd: () => '/',
      platform: 'linux',
      nextTick: (cb: (...args: unknown[]) => void, ...args: unknown[]) =>
        queueMicrotask(() => cb(...args)),
    };

    globalRef.process = processShim as unknown as NodeJS.Process;
  }

  globalRef.process.env ??= {};

  if (env) {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) {
        delete globalRef.process.env[key];
      } else {
        globalRef.process.env[key] = value;
      }
    }
  }
};

/**
 * Format an argument for console output.
 */
const formatArg = (arg: unknown): string => {
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  if (typeof arg === 'string') return arg;
  if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
  if (arg instanceof Error) {
    return arg.stack || `${arg.name}: ${arg.message}`;
  }
  try {
    return JSON.stringify(arg, null, 2);
  } catch {
    return String(arg);
  }
};

/**
 * Intercept console methods and forward to host via send().
 * Returns a restore function to revert console to original.
 */
const interceptConsole = (
  testPath: string,
  printConsoleTrace: boolean,
  disableConsoleIntercept: boolean,
): (() => void) => {
  if (disableConsoleIntercept) {
    return () => {};
  }

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

      // Format message
      const content = args.map(formatArg).join(' ');

      // Send to host
      send({
        type: 'log',
        payload: {
          level,
          content,
          testPath,
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
  // If in iframe, send to parent window (container) which will forward to host via RPC
  if (window.parent !== window) {
    window.parent.postMessage(
      { type: '__rstest_dispatch__', payload: message },
      '*',
    );
    return;
  }
  // Fallback: direct call if running outside iframe (not typical)
  // Note: This binding may not exist if not using Playwright
  window.__rstest_dispatch__?.(message);
};

/** Timeout for waiting for browser config from container (30 seconds) */
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
      if (event.data?.type === 'RSTEST_CONFIG') {
        window.__RSTEST_BROWSER_OPTIONS__ = event.data.payload;
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

  let relative = normalizedAbsolute;
  if (normalizedAbsolute.startsWith(normalizedRoot)) {
    relative = normalizedAbsolute.slice(normalizedRoot.length);
  }
  return relative.startsWith('/') ? `.${relative}` : `./${relative}`;
};

/**
 * Convert context key to absolute path
 * e.g., './src/foo.test.ts' -> '/project/src/foo.test.ts'
 */
const toAbsolutePath = (key: string, projectRoot: string): string => {
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

  // Preload runner.js sourcemap for inline snapshot support.
  // The snapshot code runs in runner.js, so we need its sourcemap
  // to map stack traces back to original source files.
  await preloadRunnerSourceMap();

  // Find the project for this test file
  const targetTestFile = options.testFile;
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
  ensureProcessEnv(runtimeConfig.env);

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

  // 1. Load setup files for this project
  for (const loadSetup of currentSetupLoaders) {
    await loadSetup();
  }

  // 2. Determine which test files to run
  let testKeysToRun: string[];

  if (targetTestFile) {
    // Single file mode: convert absolute path to context key
    const key = toContextKey(targetTestFile, currentProject.projectRoot);
    testKeysToRun = [key];
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

      const runtime = await createRstestRuntime(workerState);

      // Register global APIs if globals config is enabled
      if (runtimeConfig.globals) {
        for (const apiKey of globalApis) {
          (globalThis as any)[apiKey] = (runtime.api as any)[apiKey];
        }
      }

      try {
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

  // 3. Run tests for each file
  for (const key of testKeysToRun) {
    const testPath = toAbsolutePath(key, currentProject.projectRoot);

    // Intercept console methods to forward logs to host
    const restoreConsole = interceptConsole(
      testPath,
      runtimeConfig.printConsoleTrace ?? false,
      runtimeConfig.disableConsoleIntercept ?? false,
    );

    const workerState: WorkerState = {
      project: projectRuntime.name,
      projectRoot: projectRuntime.projectRoot,
      rootPath: options.rootPath,
      runtimeConfig,
      taskId: 0,
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

    const runtime = await createRstestRuntime(workerState);

    // Register global APIs if globals config is enabled
    if (runtimeConfig.globals) {
      for (const apiKey of globalApis) {
        (globalThis as any)[apiKey] = (runtime.api as any)[apiKey];
      }
    }

    let failedTestsCount = 0;

    const runnerHooks: RunnerHooks = {
      onTestCaseResult: async (result) => {
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

    try {
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

      send({
        type: 'file-complete',
        payload: result,
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
    } finally {
      // Restore original console methods
      restoreConsole();
    }
  }

  send({ type: 'complete' });
  window.__RSTEST_DONE__ = true;
};

void run().catch((error) => {
  const err = error instanceof Error ? error : new Error(String(error));
  send({
    type: 'fatal',
    payload: {
      message: err.message,
      stack: err.stack,
    },
  });
  window.__RSTEST_DONE__ = true;
});
