import { type ChildProcess, spawn } from 'node:child_process';
import net from 'node:net';
import path, { dirname } from 'node:path';
import { type BirpcReturn, createBirpc } from 'birpc';
import regexpEscape from 'core-js-pure/actual/regexp/escape';
import vscode from 'vscode';
import { getConfigValue } from './config';
import type { RstestDiagnostics } from './diagnostics';
import type { TestErrorStore } from './errorStore';
import { logger } from './logger';
import type { Project } from './project';
import { runInTerminal as sendToTerminal, shellQuote } from './terminal';
import { TestRunReporter } from './testRunReporter';
import {
  formatCoreVersionWarningMessage,
  shouldWarnCoreVersion,
} from './versionCheck';
import type { Worker } from './worker';

export const runningWorkers = new Set<BirpcReturn<Worker, TestRunReporter>>();

// Default host for a fixed debug port. The spawn (`--inspect-wait`), the port
// preflight, and the attach config must all use the same host: on a dual-stack
// machine `localhost` can resolve to `::1` while the worker listens on IPv4, so
// the debugger would attach to the wrong endpoint. Prefer an explicit IPv4
// literal over `localhost` so both ends agree.
const DEFAULT_DEBUG_HOST = '127.0.0.1';

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
  private childProcesses = new Set<ChildProcess>();
  private coreVersionTooLowWarned = false;

  constructor(
    private workspace: vscode.WorkspaceFolder,
    private cwd: string,
    private configFilePath: string,
    private project: Project,
  ) {}

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

  // Resolve the `@rstest/core` package.json specifier honoring a configured
  // `rstestPackagePath`: the bare package spec when it is not set, or the
  // validated absolute path to the configured package.json. Shared by the
  // worker resolution and the terminal CLI resolution.
  private resolveConfiguredPackageJson(): string {
    // TODO: support Yarn PnP
    let configuredPackagePath = getConfigValue(
      'rstestPackagePath',
      this.workspace,
    );
    if (!configuredPackagePath) {
      return '@rstest/core/package.json';
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

  private resolveRstestPath(): string {
    try {
      const packageJson = this.resolveConfiguredPackageJson();
      const configured = packageJson !== '@rstest/core/package.json';
      if (configured) {
        logger.debug('Using configured rstestPackagePath:', packageJson);
      }

      const nodeExport = require.resolve(
        configured ? dirname(packageJson) : '@rstest/core',
        {
          paths: [this.cwd],
        },
      );

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
        return '';
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

      if (shouldWarnCoreVersion(coreVersion) && !this.coreVersionTooLowWarned) {
        this.coreVersionTooLowWarned = true;
        vscode.window.showWarningMessage(
          formatCoreVersionWarningMessage(coreVersion),
        );
      }

      return nodeExport;
    } catch (e) {
      vscode.window.showErrorMessage((e as any).toString());
      throw e;
    }
  }

  // Resolve the rstest CLI executable (its package `bin`) for the terminal run
  // mode, honoring a configured `rstestPackagePath` the same way as the worker
  // resolution above.
  private resolveRstestBin(): string {
    const pkgJsonPath = require.resolve(this.resolveConfiguredPackageJson(), {
      paths: [this.cwd],
    });
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
    const worker = await this.createChildProcess();
    const config = await worker.getNormalizedConfig({
      rstestPath: this.resolveRstestPath(),
      configFilePath: this.configFilePath,
    });
    worker.$close();
    return config;
  }

  public async listTests(include?: string[]) {
    const worker = await this.createChildProcess();
    const tests = await worker.listTests({
      rstestPath: this.resolveRstestPath(),
      configFilePath: this.configFilePath,
      include,
      includeTaskLocation: true,
    });
    worker.$close();
    return tests;
  }

  public async runTest({
    run,
    token,
    updateSnapshot,
    fileFilter,
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
      onFinish,
      createTestRun,
      this.configFilePath,
      applyDiagnostic ? diagnostics : undefined,
      errorStore,
    );

    const worker = await this.createChildProcess(
      testRunReporter,
      kind === vscode.TestRunProfileKind.Debug,
      run,
    );
    token.onCancellationRequested(() => {
      worker.$close();
      onFinish();
    });

    void worker
      .runTest({
        command: continuous ? 'watch' : 'run',
        fileFilters: fileFilter ? [fileFilter] : undefined,
        testNamePattern: testCaseNamePath
          ? new RegExp(this.buildTestNamePattern(testCaseNamePath, isSuite))
          : undefined,
        update: updateSnapshot,
        configFilePath: this.configFilePath,
        rstestPath: this.resolveRstestPath(),
        coverage: coverageEnabled ? { enabled: true } : undefined,
        includeTaskLocation: true,
      })
      .catch((error) => {
        if (!token.isCancellationRequested) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error('Failed to run tests', error);
          run.appendOutput(`\n[rstest] ${message}\n`.replaceAll('\n', '\r\n'));
          vscode.window.showErrorMessage(`Rstest test run failed: ${message}`);
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

  private buildCliCommand({
    fileFilter,
    testCaseNamePath,
    isSuite,
  }: {
    fileFilter?: string;
    testCaseNamePath?: string[];
    isSuite?: boolean;
  }): string {
    const { nodeExecutable, nodeExecArgs } = this.resolveNodeCommand();

    // Prefer a path relative to the run cwd for readability; fall back to the
    // absolute path when the target is outside the cwd.
    const relative = (target: string) => {
      const rel = path.relative(this.cwd, target);
      return rel && !rel.startsWith('..') ? rel : target;
    };

    const args = ['run'];
    if (fileFilter) {
      args.push(relative(fileFilter));
    }
    if (testCaseNamePath?.length) {
      // Terminal run selects the same case as the in-editor run.
      args.push('-t', this.buildTestNamePattern(testCaseNamePath, isSuite));
    }
    args.push('-c', relative(this.configFilePath));

    return [nodeExecutable, ...nodeExecArgs, this.resolveRstestBin(), ...args]
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
      command = this.buildCliCommand(options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Rstest: ${message}`);
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
    const rstestPath = this.resolveRstestPath();
    if (!rstestPath) {
      throw new Error('Failed to resolve rstest path');
    }
    const debuggerPort = getConfigValue('debuggerPort', this.workspace);
    const debuggerAddress = getConfigValue('debuggerAddress', this.workspace);
    if (
      startDebugging &&
      debuggerPort &&
      !(await isPortAvailable(debuggerPort, debuggerAddress))
    ) {
      const at = `${debuggerAddress ?? DEFAULT_DEBUG_HOST}:${debuggerPort}`;
      const message = `Rstest debug port ${at} is already in use. Set a free "rstest.debuggerPort" or free the port.`;
      vscode.window.showErrorMessage(message);
      throw new Error(message);
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
    this.childProcesses.add(rstestProcess);

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
        rstestProcess.kill();
        this.childProcesses.delete(rstestProcess);
        runningWorkers.delete(worker);
      },
    });

    runningWorkers.add(worker);

    logger.debug('Sent init payload to worker', {
      root: this.cwd,
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
      if (!startedDebugging) {
        rstestProcess.kill();
        throw new Error(
          `Failed to attach debugger to test worker process (PID: ${rstestProcess.pid})`,
        );
      }
    }

    return worker;
  }

  public dispose() {
    for (const child of this.childProcesses) {
      child.kill();
    }
    this.childProcesses.clear();
  }
}
