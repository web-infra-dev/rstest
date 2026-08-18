import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import path, { dirname } from 'node:path';
import type { FileFilterMode } from '@rstest/core/api';
import { type BirpcReturn, createBirpc } from 'birpc';
import regexpEscape from 'core-js-pure/actual/regexp/escape';
import vscode from 'vscode';
import { getConfigValue } from './config';
import {
  formatConfiguredCoreNotFoundMessage,
  formatCoreNotFoundMessage,
  isModuleNotFoundError,
  isPackagePathNotExportedError,
} from './coreResolution';
import type { RstestDiagnostics } from './diagnostics';
import type { TestErrorStore } from './errorStore';
import { logger } from './logger';
import type { Project } from './project';
import { runInTerminal as sendToTerminal, shellQuote } from './terminal';
import { TestRunReporter } from './testRunReporter';
import type { WorkerInitOptions } from './types';
import { toErrorMessage } from './utils';
import { formatUnsupportedCoreVersionMessage } from './versionCheck';
import type { Worker } from './worker';

type WorkerRpc = BirpcReturn<Worker, TestRunReporter>;
type RstestPaths = Pick<
  WorkerInitOptions,
  'apiPath' | 'coreVersion' | 'rstestPath'
>;

export const runningWorkers = new Set<WorkerRpc>();
export const WATCHER_CLOSE_TIMEOUT_MS = 30_000;
const forceKilledWorkers = new WeakSet<WorkerRpc>();
const workerClosePromises = new WeakMap<WorkerRpc, Promise<void>>();

export const closeWorkerGracefully = (worker: WorkerRpc): Promise<void> => {
  if (worker.$closed) {
    return Promise.resolve();
  }
  const pendingClose = workerClosePromises.get(worker);
  if (pendingClose) {
    return pendingClose;
  }

  const closePromise = (async () => {
    let timer: NodeJS.Timeout | undefined;
    let closeTimedOut = false;
    try {
      await Promise.race([
        Promise.resolve()
          .then(() => worker.closeWatcher())
          .catch((error) => {
            logger.warn('Failed to close the continuous test watcher', error);
          }),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            closeTimedOut = true;
            resolve();
          }, WATCHER_CLOSE_TIMEOUT_MS);
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      if (closeTimedOut) {
        forceKilledWorkers.add(worker);
        logger.warn(
          'Timed out waiting for the continuous test watcher to close; terminating the worker. Watcher teardown was skipped.',
        );
      }
      if (!worker.$closed) {
        worker.$close();
      }
    }
  })();
  workerClosePromises.set(worker, closePromise);
  return closePromise;
};

// Default host for a fixed debug port. The spawn (`--inspect-wait`), the port
// preflight, and the attach config must all use the same host: on a dual-stack
// machine `localhost` can resolve to `::1` while the worker listens on IPv4, so
// the debugger would attach to the wrong endpoint. Prefer an explicit IPv4
// literal over `localhost` so both ends agree.
const DEFAULT_DEBUG_HOST = '127.0.0.1';

// The specifier used when `rstestPackagePath` is unset.
const CORE_PACKAGE_JSON = '@rstest/core/package.json';

// Probe whether a fixed inspector port can be bound. `--inspect-wait=host:port`
// does not fall back when the port is taken: Node reports address-in-use and
// runs the worker without the inspector, and attaching by that port could hit an
// unrelated process. Preflight so we fail with a clear message instead.
const isPortAvailable = (port: number, host?: string): Promise<boolean> =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, host ?? DEFAULT_DEBUG_HOST);
  });

export class RstestApi {
  private workers = new Set<WorkerRpc>();
  private disposed = false;
  private disposePromise?: Promise<void>;

  constructor(
    private workspace: vscode.WorkspaceFolder,
    private cwd: string,
    private configFilePath: string,
    private project: Project,
  ) {}

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error('Rstest API is disposed.');
    }
  }

  private expandWorkspaceFolder(value: string): string {
    return value.replaceAll('${workspaceFolder}', this.workspace.uri.fsPath);
  }

  // Regex source that selects a single reported case by its name path. Shared by
  // the worker run (wrapped in RegExp) and the terminal `-t` argument so both
  // select the same case.
  private buildTestNamePattern(
    testCaseNamePath: string[],
    isSuite?: boolean,
  ): string {
    return `^${regexpEscape(testCaseNamePath.join(' '))}${isSuite ? ' ' : '$'}`;
  }

  // The node executable + exec args used to run a worker or the CLI, honoring
  // the `nodeExecutable` / `nodeExecArgs` settings (`${workspaceFolder}`
  // expanded).
  private resolveNodeCommand(): {
    nodeExecutable: string;
    nodeExecArgs: string[];
  } {
    const configuredExecutable = getConfigValue(
      'nodeExecutable',
      this.workspace,
    );
    return {
      nodeExecutable: configuredExecutable
        ? this.expandWorkspaceFolder(configuredExecutable)
        : 'node',
      nodeExecArgs: getConfigValue('nodeExecArgs', this.workspace).map((arg) =>
        this.expandWorkspaceFolder(arg),
      ),
    };
  }

  // The validated absolute path to the package.json a `rstestPackagePath`
  // setting points at, or `undefined` when the setting is unset and the bare
  // `CORE_PACKAGE_JSON` specifier applies. Shared by the worker resolution and
  // the terminal CLI resolution, which both also report the configured path.
  private resolveConfiguredPackageJson(): string | undefined {
    // TODO: support Yarn PnP
    let configuredPackagePath = getConfigValue(
      'rstestPackagePath',
      this.workspace,
    );
    if (!configuredPackagePath) {
      return undefined;
    }
    configuredPackagePath = this.expandWorkspaceFolder(configuredPackagePath);
    if (!configuredPackagePath.endsWith('package.json')) {
      throw new Error(
        `"rstest.rstestPackagePath" must point to a package.json file, instead got: ${configuredPackagePath}`,
      );
    }
    return path.isAbsolute(configuredPackagePath)
      ? configuredPackagePath
      : path.resolve(this.workspace.uri.fsPath, configuredPackagePath);
  }

  // Resolve `specifier` from the config file's directory, or from the selected
  // package when `rstestPackagePath` is set. `undefined` means `@rstest/core`
  // is not installed at all — the normal state of a repository whose
  // dependencies are not installed yet, so it is written to the output channel
  // and never raised as a notification. A configured path that does not resolve
  // is a setting the user got wrong, so it is rethrown for the caller to report.
  private resolveFromCwd(
    specifier: string,
    configuredPackagePath?: string,
  ): string | undefined {
    try {
      return configuredPackagePath
        ? createRequire(configuredPackagePath).resolve(specifier)
        : require.resolve(specifier, { paths: [this.cwd] });
    } catch (e) {
      if (!isModuleNotFoundError(e, specifier)) throw e;
      if (configuredPackagePath) {
        throw new Error(
          formatConfiguredCoreNotFoundMessage(configuredPackagePath),
        );
      }
      logger.error(formatCoreNotFoundMessage(this.cwd));
      return undefined;
    }
  }

  // Returns undefined when resolution failed. Every such branch has already
  // reported itself — silently for a missing core, with a notification
  // otherwise — so callers must fail quietly rather than report again.
  private resolveRstestPaths(): RstestPaths | undefined {
    try {
      const configured = this.resolveConfiguredPackageJson();
      const packageJson = configured ?? CORE_PACKAGE_JSON;
      if (configured) {
        logger.debug('Using configured rstestPackagePath:', configured);
      }

      // `dirname` turns either package.json specifier into its package entry.
      const nodeExport = this.resolveFromCwd(dirname(packageJson), configured);
      if (!nodeExport) return undefined;

      let corePackageJsonPath: string;
      try {
        corePackageJsonPath = require.resolve(packageJson, {
          paths: [this.cwd],
        });
      } catch (e) {
        vscode.window.showErrorMessage(
          'Failed to resolve @rstest/core/package.json. Please upgrade @rstest/core to the latest version.',
        );
        logger.error('Failed to resolve @rstest/core/package.json', e);
        return undefined;
      }
      const corePackageJson = require(corePackageJsonPath) as {
        version?: string;
      };
      const extension = vscode.extensions.getExtension('rstack.rstest');
      const extensionVersion = extension?.packageJSON?.version as
        string | undefined;
      const coreVersion = corePackageJson.version;

      if (coreVersion && extensionVersion && coreVersion !== extensionVersion) {
        logger.debug('Local @rstest/core version differs from extension', {
          coreVersion,
          extensionVersion,
        });
      }

      let apiPath: string | undefined;
      try {
        apiPath = this.resolveFromCwd('@rstest/core/api', configured);
      } catch (error) {
        if (isPackagePathNotExportedError(error)) {
          throw new Error(formatUnsupportedCoreVersionMessage(coreVersion));
        }
        throw error;
      }
      if (!apiPath) return undefined;

      return { apiPath, coreVersion, rstestPath: nodeExport };
    } catch (e) {
      vscode.window.showErrorMessage(toErrorMessage(e));
      throw e;
    }
  }

  private requireRstestPaths(): RstestPaths {
    const paths = this.resolveRstestPaths();
    if (!paths) {
      throw new Error('Failed to resolve rstest path');
    }
    return paths;
  }

  private showUnsupportedCoreError(
    error: unknown,
    coreVersion?: string,
  ): boolean {
    const message = toErrorMessage(error);
    if (message !== formatUnsupportedCoreVersionMessage(coreVersion)) {
      return false;
    }
    vscode.window.showErrorMessage(message);
    return true;
  }

  // Resolve the rstest CLI executable (its package `bin`) for the terminal run
  // mode, honoring a configured `rstestPackagePath` the same way as the worker
  // resolution above.
  private resolveRstestBin(): string | undefined {
    const configured = this.resolveConfiguredPackageJson();
    const pkgJsonPath = this.resolveFromCwd(
      configured ?? CORE_PACKAGE_JSON,
      configured,
    );
    if (!pkgJsonPath) return undefined;
    const pkg = require(pkgJsonPath) as {
      bin?: string | Record<string, string>;
    };
    const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.rstest;
    if (!binRel) {
      throw new Error('Could not resolve the rstest CLI binary');
    }
    return path.join(path.dirname(pkgJsonPath), binRel);
  }

  public async getNormalizedConfig() {
    this.assertNotDisposed();
    const paths = this.requireRstestPaths();
    const worker = await this.createChildProcess();
    try {
      return await worker.getNormalizedConfig({
        ...paths,
        configFilePath: this.configFilePath,
      });
    } catch (error) {
      this.showUnsupportedCoreError(error, paths.coreVersion);
      throw error;
    } finally {
      worker.$close();
    }
  }

  public async listTests(fileFilters?: string[]) {
    this.assertNotDisposed();
    const paths = this.requireRstestPaths();
    const worker = await this.createChildProcess();
    try {
      return await worker.listTests({
        ...paths,
        configFilePath: this.configFilePath,
        // Runtime discovery filters always target concrete files.
        fileFilterMode: fileFilters ? 'exact' : undefined,
        fileFilters,
        includeTaskLocation: true,
      });
    } catch (error) {
      this.showUnsupportedCoreError(error, paths.coreVersion);
      throw error;
    } finally {
      worker.$close();
    }
  }

  public async runTest({
    run,
    token,
    updateSnapshot,
    fileFilter,
    fileFilterMode,
    testCaseNamePath,
    isSuite,
    kind,
    continuous,
    diagnostics,
    errorStore,
    createTestRun,
  }: {
    run: vscode.TestRun;
    token: vscode.CancellationToken;
    updateSnapshot?: boolean;
    fileFilter?: string;
    fileFilterMode?: FileFilterMode;
    testCaseNamePath?: string[];
    isSuite?: boolean;
    kind?: vscode.TestRunProfileKind;
    continuous?: boolean;
    diagnostics?: RstestDiagnostics;
    errorStore?: TestErrorStore;
    createTestRun?: () => vscode.TestRun;
  }) {
    let onFinish!: () => void;
    let finished = false;
    const promise = new Promise<void>((resolve) => {
      onFinish = () => {
        if (finished) return;
        finished = true;
        resolve();
      };
    });
    const coverageEnabled = kind === vscode.TestRunProfileKind.Coverage;
    const applyDiagnostic = getConfigValue('applyDiagnostic', this.workspace);
    if (!applyDiagnostic) {
      diagnostics?.clearForProject(this.configFilePath);
    }

    const testRunReporter = new TestRunReporter(
      run,
      this.project,
      testCaseNamePath,
      coverageEnabled,
      // The worker RPC settles after post-report checks for one-shot runs and
      // after the initial watch session is established for continuous runs. It
      // also settles on startup failures that emit no reporter end event.
      undefined,
      createTestRun,
      this.configFilePath,
      applyDiagnostic ? diagnostics : undefined,
      errorStore,
    );

    this.assertNotDisposed();
    const paths = this.requireRstestPaths();
    const worker = await this.createChildProcess(
      testRunReporter,
      kind === vscode.TestRunProfileKind.Debug,
      run,
    );
    token.onCancellationRequested(() => {
      void closeWorkerGracefully(worker).finally(onFinish);
    });

    let workerRun: Promise<void>;
    try {
      workerRun = worker.runTest({
        command: continuous ? 'watch' : 'run',
        fileFilterMode,
        fileFilters: fileFilter ? [fileFilter] : undefined,
        testNamePattern: testCaseNamePath
          ? new RegExp(this.buildTestNamePattern(testCaseNamePath, isSuite))
          : undefined,
        update: updateSnapshot,
        configFilePath: this.configFilePath,
        ...paths,
        coverage: coverageEnabled ? { enabled: true } : undefined,
        includeTaskLocation: true,
      });
    } catch (error) {
      worker.$close();
      this.showUnsupportedCoreError(error, paths.coreVersion);
      throw error;
    }

    void workerRun
      .then(onFinish)
      .catch((error) => {
        if (!token.isCancellationRequested) {
          const message = toErrorMessage(error);
          logger.error('Failed to run tests', error);
          run.appendOutput(`\n[rstest] ${message}\n`.replaceAll('\n', '\r\n'));
          if (!this.showUnsupportedCoreError(error, paths.coreVersion)) {
            vscode.window.showErrorMessage(
              `Rstest test run failed: ${message}`,
            );
          }
        }

        if (continuous) {
          worker.$close();
        }
        onFinish();
      })
      .finally(() => {
        if (!continuous) worker.$close();
      });

    await promise;
  }

  private buildCliCommand(
    rstestBin: string,
    {
      fileFilter,
      testCaseNamePath,
      isSuite,
    }: {
      fileFilter?: string;
      testCaseNamePath?: string[];
      isSuite?: boolean;
    },
  ): string {
    const { nodeExecutable, nodeExecArgs } = this.resolveNodeCommand();

    // Prefer a path relative to the run cwd for readability; fall back to the
    // absolute path when the target is outside the cwd.
    const relativeToCwd = (target: string) => {
      const rel = path.relative(this.cwd, target);
      return rel && !rel.startsWith('..') ? rel : target;
    };

    const args = ['run'];
    if (fileFilter) {
      // Keep the positional file filter absolute: Core matches it against the
      // resolved config `root`, which can differ from the run cwd (the config
      // file's directory) when a config sets a custom `root`. A cwd-relative
      // path would then miss the discovered test files.
      args.push(fileFilter);
    }
    if (testCaseNamePath?.length) {
      // Terminal run selects the same case as the in-editor run.
      args.push('-t', this.buildTestNamePattern(testCaseNamePath, isSuite));
    }
    // `-c` is resolved relative to the process cwd, which is `this.cwd`.
    args.push('-c', relativeToCwd(this.configFilePath));

    return [nodeExecutable, ...nodeExecArgs, rstestBin, ...args]
      .map(shellQuote)
      .join(' ');
  }

  public runInTerminal(options: {
    fileFilter?: string;
    testCaseNamePath?: string[];
    isSuite?: boolean;
  }): void {
    let command: string;
    try {
      const rstestBin = this.resolveRstestBin();
      if (!rstestBin) return;
      command = this.buildCliCommand(rstestBin, options);
    } catch (error) {
      vscode.window.showErrorMessage(`Rstest: ${toErrorMessage(error)}`);
      return;
    }
    sendToTerminal(command, {
      cwd: this.cwd,
      shellPath: getConfigValue('terminalShellPath', this.workspace),
      shellArgs: getConfigValue('terminalShellArgs', this.workspace),
    });
  }

  public async createChildProcess(
    testRunReporter = new TestRunReporter(),
    startDebugging?: boolean,
    testRun?: vscode.TestRun,
  ) {
    this.assertNotDisposed();
    const { apiPath, rstestPath } = this.requireRstestPaths();
    const debuggerPort = getConfigValue('debuggerPort', this.workspace);
    const debuggerAddress = getConfigValue('debuggerAddress', this.workspace);
    if (startDebugging && debuggerPort) {
      const portAvailable = await isPortAvailable(
        debuggerPort,
        debuggerAddress,
      );
      this.assertNotDisposed();
      if (!portAvailable) {
        const at = `${debuggerAddress ?? DEFAULT_DEBUG_HOST}:${debuggerPort}`;
        const message = `Rstest debug port ${at} is already in use. Set a free "rstest.debuggerPort" or free the port.`;
        vscode.window.showErrorMessage(message);
        throw new Error(message);
      }
    }
    const execArgv: string[] = [];
    if (startDebugging) {
      execArgv.push(
        debuggerPort
          ? `--inspect-wait=${debuggerAddress ?? DEFAULT_DEBUG_HOST}:${debuggerPort}`
          : '--inspect-wait',
      );
    }
    const workerPath = path.resolve(__dirname, 'worker.js');
    const { nodeExecutable, nodeExecArgs } = this.resolveNodeCommand();
    const nodeEnv = getConfigValue('nodeEnv', this.workspace);
    const debugNodeEnv = startDebugging
      ? getConfigValue('debugNodeEnv', this.workspace)
      : undefined;
    logger.debug('Spawning worker process', {
      workerPath,
      nodeExecutable,
      nodeExecArgs,
    });
    const rstestProcess = spawn(
      nodeExecutable,
      [...nodeExecArgs, ...execArgv, workerPath],
      {
        cwd: this.cwd,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        serialization: 'advanced',
        env: {
          // same as packages/core/src/cli/prepare.ts
          // if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test'
          NODE_ENV: 'test',
          ...process.env,
          ...nodeEnv,
          ...debugNodeEnv,
          // process.env.RSTEST = 'true';
          RSTEST: 'true',
          FORCE_COLOR: '1',
        },
      },
    );

    rstestProcess.stdout?.on('data', (d) => {
      const content = d.toString();
      logger.debug('[worker stdout]', content.trimEnd());
    });

    rstestProcess.stderr?.on('data', (d) => {
      const content = d.toString();
      logger.error('[worker stderr]', content.trimEnd());
    });

    const worker = createBirpc<Worker, TestRunReporter>(testRunReporter, {
      // Target the local process rather than the shared field, which is
      // reassigned on every spawn; skip once the IPC channel is gone.
      post: (data) => {
        if (rstestProcess.connected) rstestProcess.send(data);
      },
      on: (fn) => rstestProcess.on('message', fn),
      bind: 'functions',
      timeout: 600_000,
      off: () => {
        rstestProcess.kill(
          forceKilledWorkers.has(worker) ? 'SIGKILL' : 'SIGTERM',
        );
        this.workers.delete(worker);
        runningWorkers.delete(worker);
      },
    });

    this.workers.add(worker);
    runningWorkers.add(worker);

    logger.debug('Sent init payload to worker', {
      root: this.cwd,
      apiPath,
      rstestPath,
      configFilePath: this.configFilePath,
    });

    rstestProcess.on('error', (error) => {
      logger.error('Worker process error', error);
      vscode.window.showErrorMessage(
        `Rstest worker process failed: ${error.message}`,
      );
      // Reject any in-flight birpc calls instead of letting them hang; $close
      // runs the `off` handler, which removes the process from the Set.
      if (!worker.$closed) worker.$close();
    });

    rstestProcess.on('exit', (code, signal) => {
      logger.debug('Worker process exited', { code, signal });
      // Unblock pending calls when the worker exits before we closed it.
      if (!worker.$closed) worker.$close();
    });

    // Attach the debugger only after the error/exit handlers are wired, so a
    // spawn failure (e.g. a misconfigured `nodeExecutable`) during this await is
    // handled instead of throwing uncaught in the extension host.
    if (startDebugging) {
      const debugOutFiles = getConfigValue('debugOutFiles', this.workspace);
      try {
        const startedDebugging = await vscode.debug.startDebugging(
          this.workspace,
          {
            type: 'node',
            name: 'Rstest Debug',
            request: 'attach',
            skipFiles: getConfigValue('debugExclude', this.workspace),
            ...(debugOutFiles.length ? { outFiles: debugOutFiles } : {}),
            ...(debuggerPort
              ? {
                  port: debuggerPort,
                  address: debuggerAddress ?? DEFAULT_DEBUG_HOST,
                }
              : { processId: rstestProcess.pid }),
          },
          { testRun },
        );
        this.assertNotDisposed();
        if (!startedDebugging) {
          throw new Error(
            `Failed to attach debugger to test worker process (PID: ${rstestProcess.pid})`,
          );
        }
      } catch (error) {
        if (!worker.$closed) {
          worker.$close();
        }
        throw error;
      }
    }

    return worker;
  }

  public dispose(): Promise<void> {
    // VS Code does not always await project disposal during refresh or host
    // shutdown. Starting every close eagerly still gives teardown its best
    // chance, while explicit callers and deactivate() can await the same work.
    this.disposed = true;
    this.disposePromise ??= Promise.all(
      Array.from(this.workers, closeWorkerGracefully),
    ).then(() => undefined);
    return this.disposePromise;
  }
}
