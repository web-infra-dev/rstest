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
  const globalRef: any = globalThis as any;
  if (!globalRef.global) {
    globalRef.global = globalRef;
  }

  if (!globalRef.process) {
    globalRef.process = {
      env: {},
      argv: [],
      version: 'browser',
      cwd: () => '/',
      platform: 'browser',
      nextTick: (cb: (...args: any[]) => void, ...args: any[]) =>
        queueMicrotask(() => cb(...args)),
    };
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
  window.__rstest_dispatch__?.(message);
};

const run = async () => {
  const options = window.__RSTEST_BROWSER_OPTIONS__;
  if (!options) {
    send({
      type: 'fatal',
      payload: {
        message: 'Browser test runtime is not configured.',
      },
    });
    (window as any).__RSTEST_DONE__ = true;
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

    const runnerHooks: RunnerHooks = {
      onTestCaseResult: async (result) => {
        send({
          type: 'case-result',
          payload: result,
        });
      },
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
      (window as any).__RSTEST_DONE__ = true;
      return;
    }
  }

  send({ type: 'complete' });
  (window as any).__RSTEST_DONE__ = true;
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
  (window as any).__RSTEST_DONE__ = true;
});
