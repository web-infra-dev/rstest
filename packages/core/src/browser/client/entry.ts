import { manifest } from '@rstest/browser-manifest';
import { createRstestRuntime } from '../../runtime/api';
import { setRealTimers } from '../../runtime/util';
import type { RunnerHooks, RuntimeConfig, WorkerState } from '../../types';
import type {
  BrowserClientMessage,
  BrowserHostConfig,
  BrowserManifestEntry,
  BrowserProjectRuntime,
} from '../protocol';
import { BrowserSnapshotEnvironment } from './snapshot';

declare global {
  interface Window {
    __RSTEST_BROWSER_OPTIONS__?: BrowserHostConfig;
    __rstest_dispatch__?: (message: BrowserClientMessage) => void;
  }
}

type ManifestEntry = BrowserManifestEntry & {
  load: () => Promise<unknown>;
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

const run = async () => {
  // Wait for configuration if in iframe
  await waitForConfig();
  let options = window.__RSTEST_BROWSER_OPTIONS__;

  // Support reading testFile from URL parameter
  const urlParams = new URLSearchParams(window.location.search);
  const urlTestFile = urlParams.get('testFile');

  if (urlTestFile && options) {
    // Override testFile from URL parameter
    options = {
      ...options,
      testFile: urlTestFile,
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

  const projects = new Map<
    string,
    BrowserProjectRuntime & { runtimeConfig: RuntimeConfig }
  >(
    options.projects.map((project) => [
      project.name,
      {
        ...project,
        runtimeConfig: restoreRuntimeConfig(project.runtimeConfig),
      },
    ]),
  );

  const entries = manifest as unknown as ManifestEntry[];

  // Filter entries based on testFile option if provided
  const targetTestFile = options.testFile;
  const entriesToRun = targetTestFile
    ? entries.filter((entry) => {
        // Include all setup files and only the matching test file
        return entry.type === 'setup' || entry.testPath === targetTestFile;
      })
    : entries;

  for (const entry of entriesToRun) {
    const project = projects.get(entry.projectName);
    if (!project) {
      continue;
    }

    ensureProcessEnv(project.runtimeConfig.env);

    if (entry.type === 'setup') {
      await entry.load();
      continue;
    }

    const workerState: WorkerState = {
      project: project.name,
      projectRoot: project.projectRoot,
      rootPath: options.rootPath,
      runtimeConfig: project.runtimeConfig,
      taskId: 0,
      environment: 'browser',
      testPath: entry.testPath!,
      distPath: entry.testPath!,
      snapshotOptions: {
        updateSnapshot: options.snapshot.updateSnapshot,
        snapshotEnvironment: new BrowserSnapshotEnvironment(),
        snapshotFormat: project.runtimeConfig.snapshotFormat,
      },
    };

    const runtime = createRstestRuntime(workerState);

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
        testPath: entry.testPath!,
        projectName: project.name,
      },
    });

    try {
      await entry.load();
      const result = await runtime.runner.runTests(
        entry.testPath!,
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
