import {
  type ManifestProjectConfig,
  type ManifestTestContext,
  // Multi-project APIs
  projects,
  projectSetupLoaders,
  projectTestContexts,
} from '@rstest/browser-manifest';
import { createRstestRuntime } from '../../runtime/api';
import { setRealTimers } from '../../runtime/util';
import type { RunnerHooks, RuntimeConfig, WorkerState } from '../../types';
import { globalApis } from '../../utils/constants';
import type {
  BrowserClientMessage,
  BrowserHostConfig,
  BrowserProjectRuntime,
} from '../protocol';
import { BrowserSnapshotEnvironment } from './snapshot';

declare global {
  interface Window {
    __RSTEST_BROWSER_OPTIONS__?: BrowserHostConfig;
    __rstest_dispatch__?: (message: BrowserClientMessage) => void;
  }
}

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
    // Skip: Error, getConsoleTrace, createLogger wrapper, console.log call
    return stack?.split('\n').slice(4).join('\n');
  };

  const createLogger = (level: 'log' | 'warn' | 'error' | 'info' | 'debug') => {
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

  console.log = createLogger('log');
  console.warn = createLogger('warn');
  console.error = createLogger('error');
  console.info = createLogger('info');
  console.debug = createLogger('debug');

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

// Wait for configuration if in iframe
const waitForConfig = (): Promise<void> => {
  // If not in iframe or already has config, resolve immediately
  if (window.parent === window || window.__RSTEST_BROWSER_OPTIONS__) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'RSTEST_CONFIG') {
        window.__RSTEST_BROWSER_OPTIONS__ = event.data.payload;
        console.log(
          '[Runner] Received config from container:',
          event.data.payload,
        );
        window.removeEventListener('message', handleMessage);
        resolve();
      }
    };

    window.addEventListener('message', handleMessage);

    // Timeout after 5 seconds
    setTimeout(() => {
      window.removeEventListener('message', handleMessage);
      resolve();
    }, 5000);
  });
};

/**
 * Convert absolute path to context key (relative path)
 * e.g., '/project/src/foo.test.ts' -> './src/foo.test.ts'
 */
const toContextKey = (absolutePath: string, projectRoot: string): string => {
  let relative = absolutePath;
  if (absolutePath.startsWith(projectRoot)) {
    relative = absolutePath.slice(projectRoot.length);
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
  const normalizedRoot = projectRoot.endsWith('/')
    ? projectRoot.slice(0, -1)
    : projectRoot;
  return normalizedRoot + key.slice(1);
};

/**
 * Find the project that contains the given test file.
 * Matches by checking if the testFile path starts with the project root.
 */
const findProjectForTestFile = (
  testFile: string,
  allProjects: ManifestProjectConfig[],
): ManifestProjectConfig | undefined => {
  // Sort projects by root path length (longest first) for most specific match
  const sorted = [...allProjects].sort(
    (a, b) => b.projectRoot.length - a.projectRoot.length,
  );

  for (const proj of sorted) {
    if (testFile.startsWith(proj.projectRoot)) {
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

    const runtime = createRstestRuntime(workerState);

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
      // Load the test file dynamically using this project's context
      await currentTestContext.loadTest(key);
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
