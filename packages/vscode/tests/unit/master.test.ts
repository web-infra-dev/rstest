import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';
import {
  RstestApi,
  runningWorkers,
  WATCHER_CLOSE_TIMEOUT_MS,
} from '../../src/master';
import type { TestRunReporter } from '../../src/testRunReporter';
import type { WorkerInitOptions } from '../../src/types';
import { formatUnsupportedCoreVersionMessage } from '../../src/versionCheck';
import { Worker } from '../../src/worker';

// Everything the extension surfaces: notifications the user cannot miss, the
// output channel, and the terminal a "Run in Terminal" would open.
const shownMessages: string[] = [];
const loggedErrors: string[] = [];
const loggedWarnings: string[] = [];
const createdTerminals: string[] = [];
const settings: Record<string, unknown> = {};
let startDebugging = async (): Promise<boolean> => true;

class MockRstestProcess extends EventEmitter {
  static nextPid = 10_000;
  connected = true;
  killSignals: (NodeJS.Signals | number | undefined)[] = [];
  pid = MockRstestProcess.nextPid++;
  stderr = new EventEmitter();
  stdout = new EventEmitter();

  send(data: unknown): boolean {
    const request = data as { i?: string; m?: string; t?: string };
    if (request.t === 'q' && request.i && request.m === 'closeWatcher') {
      this.emit('message', { t: 's', i: request.i, r: undefined });
    }
    return true;
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killSignals.push(signal);
    this.connected = false;
    queueMicrotask(() => this.emit('exit', 0, signal));
    return true;
  }
}

const spawnedProcesses: MockRstestProcess[] = [];

rs.mock('node:child_process', () => ({
  spawn: () => {
    const child = new MockRstestProcess();
    spawnedProcesses.push(child);
    return child;
  },
}));

rs.mock('vscode', () => {
  const channel = {
    debug: () => {},
    info: () => {},
    warn: (message: string) => loggedWarnings.push(message),
    error: (message: string) => loggedErrors.push(message),
    show: () => {},
    dispose: () => {},
  };
  const vscode = {
    TestRunProfileKind: { Run: 1, Debug: 2, Coverage: 3 },
    debug: {
      startDebugging: () => startDebugging(),
    },
    FileCoverage: class {},
    Position: class {},
    Range: class {},
    Uri: {
      file: (fsPath: string) => ({
        fsPath,
        toString: () => `file://${fsPath}`,
      }),
    },
    extensions: { getExtension: () => undefined },
    window: {
      createOutputChannel: () => channel,
      createTerminal: (options: { name: string }) => {
        createdTerminals.push(options.name);
        return { show: () => {}, sendText: () => {}, dispose: () => {} };
      },
      onDidCloseTerminal: () => ({ dispose: () => {} }),
      showErrorMessage: (message: string) => shownMessages.push(message),
      showWarningMessage: (message: string) => shownMessages.push(message),
      showInformationMessage: (message: string) => shownMessages.push(message),
    },
    workspace: {
      getConfiguration: () => ({
        get: (key: string) => settings[key],
      }),
      onDidChangeConfiguration: () => ({ dispose: () => {} }),
    },
  };
  return { ...vscode, default: vscode };
});

// A directory outside the repository, so Node's upward resolution cannot reach
// the workspace `node_modules` and `@rstest/core` is genuinely missing.
const noCoreDir = os.tmpdir();

const createApi = (cwd = noCoreDir) => {
  const workspace = { uri: { fsPath: cwd } };
  return new RstestApi(
    workspace as any,
    cwd,
    `${cwd}/rstest.config.ts`,
    {} as any,
  );
};

const mockWorker = (
  api: RstestApi,
  runTest: (data: WorkerInitOptions) => Promise<void> = async () => {},
) => {
  const worker = {
    $close: rs.fn(),
    closeWatcher: rs.fn(async () => {}),
    listTests: rs.fn(async () => []),
    runTest: rs.fn(runTest),
  };
  rs.spyOn(api, 'createChildProcess').mockResolvedValue(worker as any);
  rs.spyOn(api as any, 'resolveRstestPaths').mockReturnValue({
    apiPath: '/rstest/api.js',
    rstestPath: '/rstest/index.js',
  });
  return worker;
};

const createInFlightOneShotWorker = (shouldReject = false) => {
  const order: string[] = [];
  const runStarted = Promise.withResolvers<void>();
  const runFinished = Promise.withResolvers<void>();
  const worker = new Worker();
  rs.spyOn(worker as any, 'init').mockResolvedValue({
    command: 'run',
    fileFilters: undefined,
    rstest: {
      run: async () => {
        runStarted.resolve();
        await runFinished.promise;
        order.push('teardown');
        if (shouldReject) {
          throw new Error('test run failed');
        }
        return { status: 'pass', unhandledErrors: [] };
      },
    },
  });
  return {
    worker,
    order,
    started: runStarted.promise,
    finish: () => runFinished.resolve(),
  };
};

beforeEach(() => {
  spawnedProcesses.length = 0;
  startDebugging = async () => true;
});

describe('RstestApi with a missing @rstest/core', () => {
  beforeEach(() => {
    shownMessages.length = 0;
    loggedErrors.length = 0;
    loggedWarnings.length = 0;
    createdTerminals.length = 0;
    for (const key of Object.keys(settings)) delete settings[key];
  });

  it('should log an actionable message instead of notifying, while discovering projects', async () => {
    await expect(createApi().getNormalizedConfig()).rejects.toThrow(
      'Failed to resolve rstest path',
    );
    expect(shownMessages).toEqual([]);
    const logged = loggedErrors.join('\n');
    expect(logged).toContain(`Cannot find "@rstest/core" from ${noCoreDir}`);
    expect(logged).toContain('Install the project dependencies');
    expect(logged).not.toContain('Require stack');
  });

  it('should stay silent while listing tests', async () => {
    await expect(createApi().listTests()).rejects.toThrow(
      'Failed to resolve rstest path',
    );
    expect(shownMessages).toEqual([]);
  });

  it('should stay silent while running tests', async () => {
    await expect(
      createApi().runTest({ run: {} as any, token: {} as any }),
    ).rejects.toThrow('Failed to resolve rstest path');
    expect(shownMessages).toEqual([]);
  });

  it('should stay silent, and open no terminal, for a terminal run', () => {
    createApi().runInTerminal({});
    expect(shownMessages).toEqual([]);
    expect(createdTerminals).toEqual([]);
  });
});

// Installed but unusable — an interrupted install, or a workspace link that
// has not been built. Advising an install would be wrong, and staying silent
// would hide a broken state the user has to repair.
describe('RstestApi with an unusable @rstest/core', () => {
  let root: string;

  beforeEach(() => {
    shownMessages.length = 0;
    loggedErrors.length = 0;
    loggedWarnings.length = 0;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rstest-vscode-'));
    const pkgDir = path.join(root, 'node_modules', '@rstest', 'core');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      '{"name":"@rstest/core","version":"9.9.9","main":"./gone.js"}',
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('should notify instead of reporting it as not installed', async () => {
    await expect(createApi(root).getNormalizedConfig()).rejects.toThrow();
    expect(shownMessages).toHaveLength(1);
    expect(shownMessages[0]).toContain('gone.js');
    expect(loggedErrors.join('\n')).not.toContain(
      'Install the project dependencies',
    );
  });
});

describe('RstestApi core version compatibility', () => {
  let root: string;
  let packageJsonPath: string;

  const writeCorePackage = (version: string, exposesApi = false) => {
    const pkgDir = path.join(root, 'node_modules', '@rstest', 'core');
    fs.mkdirSync(pkgDir, { recursive: true });
    packageJsonPath = path.join(pkgDir, 'package.json');
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify({
        name: '@rstest/core',
        version,
        exports: {
          '.': './index.js',
          ...(exposesApi ? { './api': './api.js' } : {}),
          './package.json': './package.json',
        },
      }),
    );
    fs.writeFileSync(path.join(pkgDir, 'index.js'), 'module.exports = {};');
    if (exposesApi) {
      fs.writeFileSync(path.join(pkgDir, 'api.js'), 'module.exports = {};');
    }
  };

  beforeEach(() => {
    shownMessages.length = 0;
    delete settings.rstestPackagePath;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rstest-vscode-'));
    writeCorePackage('0.11.9');
  });

  afterEach(() => {
    delete settings.rstestPackagePath;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('should reject a core without the api export before starting a worker', async () => {
    const api = createApi(root);
    const message = formatUnsupportedCoreVersionMessage('0.11.9');

    expect(runningWorkers.size).toBe(0);
    await expect(api.getNormalizedConfig()).rejects.toThrow(message);
    expect(runningWorkers.size).toBe(0);
    expect(shownMessages).toEqual([message]);
  });

  it('should resolve both entries from a core that exports the api', () => {
    writeCorePackage('0.12.0', true);

    const paths = (createApi(root) as any).resolveRstestPaths();

    expect(fs.realpathSync(paths.rstestPath)).toBe(
      fs.realpathSync(
        path.join(root, 'node_modules', '@rstest', 'core', 'index.js'),
      ),
    );
    expect(fs.realpathSync(paths.apiPath)).toBe(
      fs.realpathSync(
        path.join(root, 'node_modules', '@rstest', 'core', 'api.js'),
      ),
    );
    expect(shownMessages).toEqual([]);
  });

  it('should resolve an api exported by an explicit package path', () => {
    writeCorePackage('0.11.9', true);
    settings.rstestPackagePath = packageJsonPath;
    const api = createApi(noCoreDir);

    const paths = (api as any).resolveRstestPaths();

    expect(fs.realpathSync(paths.rstestPath)).toBe(
      fs.realpathSync(
        path.join(root, 'node_modules', '@rstest', 'core', 'index.js'),
      ),
    );
    expect(fs.realpathSync(paths.apiPath)).toBe(
      fs.realpathSync(
        path.join(root, 'node_modules', '@rstest', 'core', 'api.js'),
      ),
    );
    expect(shownMessages).toEqual([]);
  });
});

// A configured `rstestPackagePath` that does not resolve is not the
// "dependencies are not installed yet" state — the user picked that path and
// has to fix it, so silence would strand them.
describe('RstestApi with an unresolvable rstestPackagePath', () => {
  const configured = `${noCoreDir}/vendor/core/package.json`;

  beforeEach(() => {
    shownMessages.length = 0;
    settings.rstestPackagePath = configured;
  });

  it('should notify while discovering projects', async () => {
    await expect(createApi().getNormalizedConfig()).rejects.toThrow();
    expect(shownMessages).toHaveLength(1);
    expect(shownMessages[0]).toContain('rstest.rstestPackagePath');
    expect(shownMessages[0]).toContain(configured);
  });

  it('should notify for a terminal run', () => {
    createApi().runInTerminal({});
    expect(shownMessages).toHaveLength(1);
    expect(shownMessages[0]).toContain('rstest.rstestPackagePath');
    expect(createdTerminals).toEqual([]);
  });
});

describe('RstestApi test listing', () => {
  afterEach(() => {
    rs.restoreAllMocks();
  });

  it('uses exact filters for targeted runtime discovery', async () => {
    const api = createApi();
    const worker = mockWorker(api);

    await api.listTests(['/x/file.test.ts']);

    expect(worker.listTests).toHaveBeenCalledWith(
      expect.objectContaining({
        fileFilterMode: 'exact',
        fileFilters: ['/x/file.test.ts'],
      }),
    );
  });

  it('returns file rows together with declarations for full discovery', async () => {
    const testPath = '/x/empty.test.ts';
    const declaration = {
      fullName: 'case',
      name: 'case',
      parentNames: [],
      project: 'rstest',
      testPath,
      type: 'case',
    } as const;
    const file = { project: 'rstest', testPath, type: 'file' } as const;
    const listTests = rs.fn(async ({ filesOnly }: { filesOnly?: boolean }) =>
      filesOnly ? [file] : [declaration],
    );
    const worker = new Worker();
    rs.spyOn(worker as any, 'init').mockResolvedValue({
      fileFilterMode: undefined,
      fileFilters: undefined,
      rstest: { listTests },
    });

    await expect(worker.listTests({} as WorkerInitOptions)).resolves.toEqual([
      file,
      declaration,
    ]);
    expect(listTests).toHaveBeenCalledWith({
      filesOnly: true,
      filterMode: undefined,
      filters: undefined,
    });
  });

  it('collects declarations only for filtered refreshes', async () => {
    const testPath = '/x/example.test.ts';
    const declaration = {
      fullName: 'case',
      name: 'case',
      parentNames: [],
      project: 'rstest',
      testPath,
      type: 'case',
    } as const;
    const listTests = rs.fn(async () => [declaration]);
    const worker = new Worker();
    rs.spyOn(worker as any, 'init').mockResolvedValue({
      fileFilterMode: 'exact',
      fileFilters: [testPath],
      rstest: { listTests },
    });

    await expect(worker.listTests({} as WorkerInitOptions)).resolves.toEqual([
      declaration,
    ]);
    expect(listTests).toHaveBeenCalledTimes(1);
    expect(listTests).toHaveBeenCalledWith({
      filterMode: 'exact',
      filters: [testPath],
      includeLocation: true,
      includeSuites: true,
    });
  });

  it('closes the worker when test collection rejects', async () => {
    const api = createApi();
    const worker = {
      $close: rs.fn(() => runningWorkers.delete(worker as any)),
      listTests: rs.fn(async () => {
        throw new Error('Test collection failed.');
      }),
    };
    runningWorkers.add(worker as any);
    rs.spyOn(api, 'createChildProcess').mockResolvedValue(worker as any);
    rs.spyOn(api as any, 'resolveRstestPaths').mockReturnValue({
      apiPath: '/rstest/api.js',
      rstestPath: '/rstest/index.js',
    });

    await expect(api.listTests()).rejects.toThrow('Test collection failed.');

    expect(worker.$close).toHaveBeenCalledTimes(1);
    expect(runningWorkers.has(worker as any)).toBe(false);
  });
});

describe('RstestApi configuration loading', () => {
  afterEach(() => {
    rs.restoreAllMocks();
  });

  it('closes the worker when configuration loading rejects', async () => {
    const api = createApi();
    const worker = {
      $close: rs.fn(),
      getNormalizedConfig: rs.fn(async () => {
        throw new Error('Configuration loading failed.');
      }),
    };
    rs.spyOn(api, 'createChildProcess').mockResolvedValue(worker as any);
    rs.spyOn(api as any, 'resolveRstestPaths').mockReturnValue({
      apiPath: '/rstest/api.js',
      rstestPath: '/rstest/index.js',
    });

    await expect(api.getNormalizedConfig()).rejects.toThrow(
      'Configuration loading failed.',
    );
    expect(worker.$close).toHaveBeenCalledTimes(1);
  });

  it('reports a friendly error when the api entry lacks createRstest', async () => {
    shownMessages.length = 0;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rstest-vscode-api-'));
    const rstestPath = path.join(root, 'index.mjs');
    const apiPath = path.join(root, 'api.mjs');
    fs.writeFileSync(
      rstestPath,
      'export const loadConfig = async () => ({ content: {}, filePath: null }); export const mergeRstestConfig = (config) => config;',
    );
    fs.writeFileSync(apiPath, 'export const runRstest = () => {};');

    try {
      const api = createApi();
      const coreWorker = new Worker();
      const worker = {
        $close: rs.fn(),
        getNormalizedConfig: (options: WorkerInitOptions) =>
          coreWorker.getNormalizedConfig(options),
      };
      rs.spyOn(api, 'createChildProcess').mockResolvedValue(worker as any);
      rs.spyOn(api as any, 'resolveRstestPaths').mockReturnValue({
        apiPath,
        coreVersion: '0.11.9',
        rstestPath,
      });
      const message = formatUnsupportedCoreVersionMessage('0.11.9');

      await expect(api.getNormalizedConfig()).rejects.toThrow(message);
      expect(shownMessages).toEqual([message]);
      expect(worker.$close).toHaveBeenCalledTimes(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('RstestApi test-run completion', () => {
  beforeEach(() => {
    shownMessages.length = 0;
    loggedErrors.length = 0;
    loggedWarnings.length = 0;
    for (const key of Object.keys(settings)) delete settings[key];
  });

  afterEach(() => {
    rs.useRealTimers();
    rs.restoreAllMocks();
  });

  const createRunContext = () => {
    const output: string[] = [];
    let cancellationHandler: (() => void) | undefined;
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: (handler: () => void) => {
        cancellationHandler = handler;
        return { dispose: () => {} };
      },
    };
    return {
      output,
      run: {
        appendOutput: (message: string) => output.push(message),
      } as any,
      token: token as any,
      cancel() {
        token.isCancellationRequested = true;
        cancellationHandler?.();
      },
    };
  };

  it.each([
    { filterMode: 'fuzzy' as const, kind: 'folder' },
    { filterMode: 'exact' as const, kind: 'file' },
  ])('forwards a $kind filter in $filterMode mode', async ({ filterMode }) => {
    const api = createApi();
    const engineRun = rs.fn(async () => ({
      status: 'pass',
      unhandledErrors: [],
    }));
    const coreWorker = new Worker();
    rs.spyOn(coreWorker as any, 'init').mockResolvedValue({
      command: 'run',
      fileFilterMode: filterMode,
      fileFilters: ['/x/tests'],
      rstest: { run: engineRun },
    });
    const worker = mockWorker(api, (data) => coreWorker.runTest(data));
    const { run, token } = createRunContext();

    await api.runTest({
      fileFilter: '/x/tests',
      fileFilterMode: filterMode,
      run,
      token,
    });

    expect(worker.runTest).toHaveBeenCalledWith(
      expect.objectContaining({
        fileFilterMode: filterMode,
        fileFilters: ['/x/tests'],
      }),
    );
    expect(engineRun).toHaveBeenCalledWith({
      filterMode,
      filters: ['/x/tests'],
    });
  });

  it('finishes when a worker resolves without a reporter end event', async () => {
    const api = createApi();
    const worker = mockWorker(api, async () => {});
    const { run, token } = createRunContext();

    const outcome = await Promise.race([
      api.runTest({ run, token }).then(() => 'finished'),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve('pending'), 100);
      }),
    ]);
    expect(outcome).toBe('finished');
    expect(worker.$close).toHaveBeenCalledTimes(1);
  });

  it('surfaces every unhandled error from a one-shot run', async () => {
    const api = createApi();
    const coreWorker = new Worker();
    rs.spyOn(coreWorker as any, 'init').mockResolvedValue({
      command: 'run',
      fileFilters: undefined,
      rstest: {
        run: async () => ({
          status: 'error',
          unhandledErrors: [
            { message: 'Build failed', name: 'Error' },
            { message: 'Invalid config', name: 'Error' },
          ],
        }),
      },
    });
    const worker = mockWorker(api, (data) => coreWorker.runTest(data));
    const { output, run, token } = createRunContext();

    await expect(api.runTest({ run, token })).resolves.toBeUndefined();
    expect(worker.$close).toHaveBeenCalledTimes(1);
    expect(output.join('')).toContain('Build failed\r\n\r\nInvalid config');
    expect(shownMessages).toContain(
      'Rstest test run failed: Build failed\n\nInvalid config',
    );
  });

  it('does not surface ordinary test failures as a global run error', async () => {
    const api = createApi();
    const coreWorker = new Worker();
    rs.spyOn(coreWorker as any, 'init').mockResolvedValue({
      command: 'run',
      fileFilters: undefined,
      rstest: {
        run: async () => ({
          status: 'fail',
          summary: {
            tests: { total: 1, passed: 0, failed: 1, skipped: 0, todo: 0 },
            files: { total: 1, failed: 1 },
          },
          unhandledErrors: [],
        }),
      },
    });
    const worker = mockWorker(api, (data) => coreWorker.runTest(data));
    const { output, run, token } = createRunContext();

    await expect(api.runTest({ run, token })).resolves.toBeUndefined();
    expect(worker.$close).toHaveBeenCalledTimes(1);
    expect(output).toEqual([]);
    expect(shownMessages).toEqual([]);
  });

  it('waits for an active one-shot run when cancellation closes the worker', async () => {
    const api = createApi();
    const {
      worker: coreWorker,
      order,
      started,
      finish,
    } = createInFlightOneShotWorker();
    const workerClosed = Promise.withResolvers<void>();
    const worker = mockWorker(api, (data) => coreWorker.runTest(data));
    worker.closeWatcher.mockImplementation(() => coreWorker.closeWatcher());
    let closed = false;
    worker.$close.mockImplementation(() => {
      if (!closed) {
        closed = true;
        (worker as any).$closed = true;
        order.push('kill');
        workerClosed.resolve();
      }
    });
    const { run, token, cancel } = createRunContext();

    const runPromise = api.runTest({ run, token });
    await started;
    cancel();
    await new Promise<void>((resolve) => setTimeout(resolve));
    const closedBeforeRunSettled = worker.$close.mock.calls.length;
    finish();
    await Promise.all([runPromise, workerClosed.promise]);

    expect(closedBeforeRunSettled).toBe(0);
    expect(order).toEqual(['teardown', 'kill']);
  });

  it('surfaces coverage failures without test-level failures', async () => {
    const api = createApi();
    const coreWorker = new Worker();
    const reporterReady = Promise.withResolvers<TestRunReporter>();
    const coverageReported = Promise.withResolvers<void>();
    const thresholdChecked = Promise.withResolvers<void>();
    rs.spyOn(coreWorker as any, 'init').mockResolvedValue({
      command: 'run',
      fileFilters: undefined,
      rstest: {
        run: async () => {
          const reporter = await reporterReady.promise;
          await reporter.onCoverageEnd();
          coverageReported.resolve();
          await thresholdChecked.promise;
          return {
            status: 'fail',
            summary: {
              tests: {
                total: 1,
                passed: 1,
                failed: 0,
                skipped: 0,
                todo: 0,
              },
              files: { total: 1, failed: 0 },
            },
            unhandledErrors: [],
          };
        },
      },
    });
    const worker = {
      $close: rs.fn(),
      closeWatcher: rs.fn(async () => {}),
      runTest: rs.fn((data: WorkerInitOptions) => coreWorker.runTest(data)),
    };
    rs.spyOn(api, 'createChildProcess').mockImplementation(async (reporter) => {
      if (!reporter) {
        throw new Error('Expected a test run reporter.');
      }
      reporterReady.resolve(reporter);
      return worker as any;
    });
    rs.spyOn(api as any, 'resolveRstestPaths').mockReturnValue({
      apiPath: '/rstest/api.js',
      rstestPath: '/rstest/index.js',
    });
    const { output, run, token } = createRunContext();
    const order: string[] = [];
    const originalAppendOutput = run.appendOutput;
    run.appendOutput = (message: string) => {
      order.push('output');
      originalAppendOutput(message);
    };
    run.end = () => order.push('end');

    const hostRun = api.runTest({ run, token }).finally(() => run.end());
    await coverageReported.promise;
    thresholdChecked.resolve();
    await expect(hostRun).resolves.toBeUndefined();

    expect(worker.$close).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['output', 'end']);
    expect(output.join('')).toContain(
      'Rstest run failed without test-level failures',
    );
    expect(shownMessages).toContain(
      'Rstest test run failed: Rstest run failed without test-level failures. Check for operation-level failures such as coverage report errors or unmet coverage thresholds.',
    );
  });

  it('finishes a rejected browser continuous run and surfaces its error', async () => {
    const api = createApi();
    const errorMessage =
      'watch() does not support browser mode yet. Use run() instead.';
    const worker = mockWorker(api, async () => {
      throw new Error(errorMessage);
    });
    const { output, run, token } = createRunContext();

    await expect(
      api.runTest({ run, token, continuous: true }),
    ).resolves.toBeUndefined();
    expect(worker.$close).toHaveBeenCalledTimes(1);
    expect(output.join('')).toContain(errorMessage);
    expect(shownMessages).toContain(`Rstest test run failed: ${errorMessage}`);
  });

  it('waits for continuous worker startup after the first reporter cycle', async () => {
    const api = createApi();
    const startup = Promise.withResolvers<void>();
    let reporter: TestRunReporter | undefined;
    const worker = {
      $close: rs.fn(),
      closeWatcher: rs.fn(async () => {}),
      runTest: rs.fn(() => startup.promise),
    };
    rs.spyOn(api, 'createChildProcess').mockImplementation(
      async (testRunReporter) => {
        reporter = testRunReporter;
        return worker as any;
      },
    );
    rs.spyOn(api as any, 'resolveRstestPaths').mockReturnValue({
      apiPath: '/rstest/api.js',
      rstestPath: '/rstest/index.js',
    });
    const { run, token } = createRunContext();
    const order: string[] = [];
    run.appendOutput = () => order.push('output');
    run.end = () => order.push('end');

    const hostRun = api
      .runTest({ run, token, continuous: true })
      .finally(() => run.end());
    await Promise.resolve();
    expect(reporter).toBeDefined();
    await reporter!.onTestRunEnd();
    reporter!.onOutput('Waiting for file changes...');
    await Promise.resolve();

    expect(order).toEqual(['output']);

    startup.resolve();
    await hostRun;

    expect(order).toEqual(['output', 'end']);
  });

  it('waits for watcher startup before terminating a canceled continuous run', async () => {
    const api = createApi();
    const order: string[] = [];
    const watcherStartup = Promise.withResolvers<{
      close(): Promise<void>;
    }>();
    const watcherStarted = Promise.withResolvers<void>();
    const watcherClosed = Promise.withResolvers<void>();
    const coreWorker = new Worker();
    rs.spyOn(coreWorker as any, 'init').mockResolvedValue({
      command: 'watch',
      fileFilters: undefined,
      rstest: {
        watch: () => {
          watcherStarted.resolve();
          return watcherStartup.promise;
        },
      },
    });
    const worker = mockWorker(api, (data) => coreWorker.runTest(data));
    worker.closeWatcher.mockImplementation(() => coreWorker.closeWatcher());
    worker.$close.mockImplementation(() => {
      order.push('kill');
      watcherClosed.resolve();
    });
    const { run, token, cancel } = createRunContext();

    const runPromise = api.runTest({ run, token, continuous: true });
    await watcherStarted.promise;
    cancel();
    expect(worker.$close).not.toHaveBeenCalled();
    watcherStartup.resolve({
      close: async () => {
        order.push('teardown');
      },
    });
    await watcherClosed.promise;
    await runPromise;

    expect(order).toEqual(['teardown', 'kill']);
  });

  it('terminates the worker when graceful watcher close times out', async () => {
    rs.useFakeTimers();
    const api = createApi();
    const worker = mockWorker(api, async () => {});
    worker.closeWatcher.mockImplementation(() => new Promise<void>(() => {}));
    worker.$close.mockImplementation(() => {
      expect(loggedWarnings).toEqual([
        'Timed out waiting for the continuous test watcher to close; terminating the worker. Watcher teardown was skipped.',
      ]);
    });
    const { run, token, cancel } = createRunContext();

    await api.runTest({ run, token, continuous: true });
    cancel();
    await rs.advanceTimersByTimeAsync(WATCHER_CLOSE_TIMEOUT_MS - 1);

    expect(worker.$close).not.toHaveBeenCalled();
    expect(loggedWarnings).toEqual([]);

    await rs.advanceTimersByTimeAsync(1);

    expect(worker.closeWatcher).toHaveBeenCalledTimes(1);
    expect(worker.$close).toHaveBeenCalledTimes(1);
    expect(loggedWarnings).toEqual([
      'Timed out waiting for the continuous test watcher to close; terminating the worker. Watcher teardown was skipped.',
    ]);
  });
});

describe('RstestApi disposal', () => {
  beforeEach(() => {
    loggedWarnings.length = 0;
  });

  afterEach(() => {
    rs.useRealTimers();
    rs.restoreAllMocks();
  });

  it('waits for watcher teardown before terminating the worker', async () => {
    const api = createApi();
    const order: string[] = [];
    const teardown = Promise.withResolvers<void>();
    const worker = {
      closeWatcher: rs.fn(async () => {
        await teardown.promise;
        order.push('teardown');
      }),
      $close: rs.fn(() => order.push('kill')),
    };
    (api as any).workers = new Set([worker]);

    const disposal = Promise.resolve(api.dispose());
    await Promise.resolve();

    expect(worker.closeWatcher).toHaveBeenCalledTimes(1);
    expect(order).toEqual([]);

    teardown.resolve();
    await disposal;

    expect(order).toEqual(['teardown', 'kill']);
  });

  it('waits for an active one-shot run before disposing the worker', async () => {
    const api = createApi();
    const {
      worker: coreWorker,
      order,
      started,
      finish,
    } = createInFlightOneShotWorker(true);
    const operation = coreWorker.runTest({} as WorkerInitOptions);
    const operationResult = operation.then(
      () => 'resolved',
      () => 'rejected',
    );
    await started;
    const worker = {
      closeWatcher: rs.fn(() => coreWorker.closeWatcher()),
      $close: rs.fn(() => order.push('kill')),
    };
    (api as any).workers = new Set([worker]);

    const disposal = api.dispose();
    await new Promise<void>((resolve) => setTimeout(resolve));
    const closedBeforeRunSettled = worker.$close.mock.calls.length;
    finish();
    const [operationStatus] = await Promise.all([operationResult, disposal]);

    expect(closedBeforeRunSettled).toBe(0);
    expect(operationStatus).toBe('rejected');
    expect(order).toEqual(['teardown', 'kill']);
  });

  it('force-terminates the worker when watcher teardown times out', async () => {
    rs.useFakeTimers();
    const api = createApi();
    const worker = {
      closeWatcher: rs.fn(() => new Promise<void>(() => {})),
      $close: rs.fn(),
    };
    (api as any).workers = new Set([worker]);

    const disposal = Promise.resolve(api.dispose());
    await rs.advanceTimersByTimeAsync(WATCHER_CLOSE_TIMEOUT_MS - 1);

    expect(worker.$close).not.toHaveBeenCalled();
    expect(loggedWarnings).toEqual([]);

    await rs.advanceTimersByTimeAsync(1);
    await disposal;

    expect(worker.closeWatcher).toHaveBeenCalledTimes(1);
    expect(worker.$close).toHaveBeenCalledTimes(1);
    expect(loggedWarnings).toEqual([
      'Timed out waiting for the continuous test watcher to close; terminating the worker. Watcher teardown was skipped.',
    ]);
  });
});

describe('RstestApi worker startup', () => {
  let root: string;

  beforeEach(() => {
    shownMessages.length = 0;
    for (const key of Object.keys(settings)) delete settings[key];
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rstest-vscode-worker-'));
    const pkgDir = path.join(root, 'node_modules', '@rstest', 'core');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({
        name: '@rstest/core',
        version: '0.12.0',
        exports: {
          '.': './index.js',
          './api': './api.js',
          './package.json': './package.json',
        },
      }),
    );
    fs.writeFileSync(path.join(pkgDir, 'index.js'), 'module.exports = {};');
    fs.writeFileSync(path.join(pkgDir, 'api.js'), 'module.exports = {};');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    rs.restoreAllMocks();
  });

  it('closes a spawned worker when debugger attachment rejects', async () => {
    startDebugging = async () => {
      throw new Error('Debugger attachment failed.');
    };
    const api = createApi(root);

    await expect(api.createChildProcess(undefined, true)).rejects.toThrow(
      'Debugger attachment failed.',
    );

    expect(spawnedProcesses).toHaveLength(1);
    expect(spawnedProcesses[0].killSignals).toEqual(['SIGTERM']);
    expect((api as any).workers.size).toBe(0);
    expect(runningWorkers.size).toBe(0);
  });

  it('closes a worker when disposal starts during debugger attachment', async () => {
    const attachment = Promise.withResolvers<boolean>();
    const attachmentStarted = Promise.withResolvers<void>();
    startDebugging = () => {
      attachmentStarted.resolve();
      return attachment.promise;
    };
    const api = createApi(root);
    const starting = api.createChildProcess(undefined, true);
    await attachmentStarted.promise;

    // dispose() sets this flag synchronously before closing its current worker
    // snapshot; isolate the post-attach guard from the close RPC exercised by
    // the disposal tests above.
    (api as any).disposed = true;
    attachment.resolve(true);

    await expect(starting).rejects.toThrow('Rstest API is disposed.');
    expect(spawnedProcesses).toHaveLength(1);
    expect(spawnedProcesses[0].killSignals).toEqual(['SIGTERM']);
    expect((api as any).workers.size).toBe(0);
    expect(runningWorkers.size).toBe(0);
  });

  it('does not spawn workers after disposal', async () => {
    const api = createApi(root);
    await api.dispose();

    await expect(api.createChildProcess()).rejects.toThrow(
      'Rstest API is disposed.',
    );
    expect(spawnedProcesses).toEqual([]);
  });
});
