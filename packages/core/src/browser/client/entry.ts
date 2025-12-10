import {
  getTestKeys,
  loadTest,
  projectConfig,
  setupLoaders,
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

const send = (message: BrowserClientMessage): void => {
  // If in iframe, send to parent window (container) which will forward to host
  if (window.parent !== window) {
    window.parent.postMessage(
      { type: '__rstest_dispatch__', payload: message },
      '*',
    );
    return;
  }
  // Otherwise, send directly via binding
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
  return projectRoot + key.slice(1);
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

  // Find the project matching projectConfig
  const project = options.projects.find((p) => p.name === projectConfig.name);
  if (!project) {
    send({
      type: 'fatal',
      payload: {
        message: `Project ${projectConfig.name} not found in options`,
      },
    });
    window.__RSTEST_DONE__ = true;
    return;
  }

  const runtimeConfig = restoreRuntimeConfig(project.runtimeConfig);
  ensureProcessEnv(runtimeConfig.env);

  // 1. Load setup files (static imports)
  for (const loadSetup of setupLoaders) {
    await loadSetup();
  }

  // 2. Determine which test files to run
  const targetTestFile = options.testFile;
  let testKeysToRun: string[];

  if (targetTestFile) {
    // Single file mode: convert absolute path to context key
    const key = toContextKey(targetTestFile, projectConfig.projectRoot);
    testKeysToRun = [key];
  } else {
    // Full run mode: get all test keys from context
    testKeysToRun = getTestKeys();
  }

  // 3. Run tests for each file
  for (const key of testKeysToRun) {
    const testPath = toAbsolutePath(key, projectConfig.projectRoot);

    const workerState: WorkerState = {
      project: project.name,
      projectRoot: project.projectRoot,
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
        projectName: project.name,
      },
    });

    try {
      // Load the test file dynamically using context
      await loadTest(key);
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
