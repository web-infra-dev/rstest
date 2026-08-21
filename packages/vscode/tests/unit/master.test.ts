import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';
import {
  RstestApi,
  runningWorkers,
  WATCHER_CLOSE_TIMEOUT_MS,
} from '../../src/master';
import type { WorkerInitOptions } from '../../src/types';
import { Worker } from '../../src/worker';

// Everything the extension surfaces: notifications the user cannot miss, the
// output channel, and the terminal a "Run in Terminal" would open.
const shownMessages: string[] = [];
const loggedErrors: string[] = [];
const loggedWarnings: string[] = [];
const createdTerminals: string[] = [];
const settings: Record<string, unknown> = {};

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

  const writeCorePackage = (version: string) => {
    const pkgDir = path.join(root, 'node_modules', '@rstest', 'core');
    fs.mkdirSync(pkgDir, { recursive: true });
    packageJsonPath = path.join(pkgDir, 'package.json');
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify({ name: '@rstest/core', version, main: './index.js' }),
    );
    fs.writeFileSync(path.join(pkgDir, 'index.js'), 'module.exports = {};');
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

  it('should reject an automatically discovered old version before starting a worker', async () => {
    const api = createApi(root);

    expect(runningWorkers.size).toBe(0);
    await expect(api.getNormalizedConfig()).rejects.toThrow(
      '@rstest/core >= 0.12.0',
    );
    expect(runningWorkers.size).toBe(0);
    expect(shownMessages).toHaveLength(1);
    expect(shownMessages[0]).toContain('Upgrade @rstest/core to >= 0.12.0');
    expect(shownMessages[0]).toContain(
      'install an older version of the Rstest extension in VS Code',
    );
  });

  it('should allow an automatically discovered supported version', () => {
    writeCorePackage('0.12.0');

    const rstestPath = (createApi(root) as any).resolveRstestPath();

    expect(fs.realpathSync(rstestPath)).toBe(
      fs.realpathSync(
        path.join(root, 'node_modules', '@rstest', 'core', 'index.js'),
      ),
    );
    expect(shownMessages).toEqual([]);
  });

  it('should warn and allow an old version selected by an explicit package path', () => {
    settings.rstestPackagePath = packageJsonPath;
    const api = createApi(root);

    const rstestPath = (api as any).resolveRstestPath();
    (api as any).resolveRstestPath();

    expect(fs.realpathSync(rstestPath)).toBe(
      fs.realpathSync(
        path.join(root, 'node_modules', '@rstest', 'core', 'index.js'),
      ),
    );
    expect(shownMessages).toHaveLength(1);
    expect(shownMessages[0]).toContain('rstest.rstestPackagePath');
    expect(shownMessages[0]).toContain('developer override');
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
    rs.spyOn(api as any, 'resolveRstestPath').mockReturnValue(
      '/rstest/index.js',
    );

    await expect(api.listTests()).rejects.toThrow('Test collection failed.');

    expect(worker.$close).toHaveBeenCalledTimes(1);
    expect(runningWorkers.has(worker as any)).toBe(false);
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

  const mockWorker = (
    api: RstestApi,
    runTest: (data: WorkerInitOptions) => Promise<void>,
  ) => {
    const worker = {
      $close: rs.fn(),
      closeWatcher: rs.fn(async () => {}),
      runTest: rs.fn(runTest),
    };
    rs.spyOn(api, 'createChildProcess').mockResolvedValue(worker as any);
    rs.spyOn(api as any, 'resolveRstestPath').mockReturnValue(
      '/rstest/index.js',
    );
    return worker;
  };

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
          ok: false,
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
          ok: false,
          stats: {
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

  it('surfaces coverage failures without test-level failures', async () => {
    const api = createApi();
    const coreWorker = new Worker();
    rs.spyOn(coreWorker as any, 'init').mockResolvedValue({
      command: 'run',
      fileFilters: undefined,
      rstest: {
        run: async () => ({
          ok: false,
          stats: {
            tests: { total: 1, passed: 1, failed: 0, skipped: 0, todo: 0 },
            files: { total: 1, failed: 0 },
          },
          unhandledErrors: [],
        }),
      },
    });
    const worker = mockWorker(api, (data) => coreWorker.runTest(data));
    const { output, run, token } = createRunContext();

    await expect(api.runTest({ run, token })).resolves.toBeUndefined();
    expect(worker.$close).toHaveBeenCalledTimes(1);
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
