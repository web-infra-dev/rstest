import { type ChildProcess, spawn } from 'node:child_process';
import path, { dirname } from 'node:path';
import { type BirpcReturn, createBirpc } from 'birpc';
import regexpEscape from 'core-js-pure/actual/regexp/escape';
import vscode from 'vscode';
import { getConfigValue } from './config';
import { logger } from './logger';
import type { Project } from './project';
import { TestRunReporter } from './testRunReporter';
import {
  formatCoreVersionWarningMessage,
  shouldWarnCoreVersion,
} from './versionCheck';
import type { Worker } from './worker';

export const runningWorkers = new Set<BirpcReturn<Worker, TestRunReporter>>();

export class RstestApi {
  private childProcess: ChildProcess | null = null;
  private coreVersionTooLowWarned = false;

  constructor(
    private workspace: vscode.WorkspaceFolder,
    private cwd: string,
    private configFilePath: string,
    private project: Project,
  ) {}

  private resolveRstestPath(): string {
    // TODO: support Yarn PnP
    try {
      // Check if user configured a custom package path (last resort fix)
      let configuredPackagePath = getConfigValue(
        'rstestPackagePath',
        this.workspace,
      );

      if (configuredPackagePath) {
        // Support ${workspaceFolder} placeholder
        configuredPackagePath = configuredPackagePath.replace(
          // biome-ignore lint: This is a VS Code config placeholder string
          '${workspaceFolder}',
          this.workspace.uri.fsPath,
        );
        // Validate that the path points to package.json
        if (!configuredPackagePath.endsWith('package.json')) {
          const errorMessage = `"rstest.rstestPackagePath" must point to a package.json file, instead got: ${configuredPackagePath}`;
          throw new Error(errorMessage);
        }

        // User provided a custom path to package.json
        configuredPackagePath = path.isAbsolute(configuredPackagePath)
          ? configuredPackagePath
          : path.resolve(this.workspace.uri.fsPath, configuredPackagePath);

        logger.debug(
          'Using configured rstestPackagePath:',
          configuredPackagePath,
        );
      }

      const nodeExport = require.resolve(
        configuredPackagePath ? dirname(configuredPackagePath) : '@rstest/core',
        {
          paths: [this.cwd],
        },
      );

      let corePackageJsonPath: string;
      try {
        corePackageJsonPath = require.resolve(
          configuredPackagePath || '@rstest/core/package.json',
          {
            paths: [this.cwd],
          },
        );
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
        | string
        | undefined;
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
    createTestRun?: () => vscode.TestRun;
  }) {
    let onFinish!: () => void;
    const promise = new Promise((resolve) => {
      onFinish = () => resolve(null);
    });
    const coverageEnabled = kind === vscode.TestRunProfileKind.Coverage;
    const testRunReporter = new TestRunReporter(
      run,
      this.project,
      testCaseNamePath,
      coverageEnabled,
      onFinish,
      createTestRun,
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

    worker
      .runTest({
        command: continuous ? 'watch' : 'run',
        fileFilters: fileFilter ? [fileFilter] : undefined,
        testNamePattern: testCaseNamePath
          ? new RegExp(
              `^${regexpEscape(testCaseNamePath.join(' '))}${isSuite ? ' ' : '$'}`,
            )
          : undefined,
        update: updateSnapshot,
        configFilePath: this.configFilePath,
        rstestPath: this.resolveRstestPath(),
        coverage: coverageEnabled ? { enabled: true } : undefined,
        includeTaskLocation: true,
      })
      .finally(() => {
        if (!continuous) worker.$close();
      });

    await promise;
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
    const execArgv: string[] = [];
    if (startDebugging) {
      execArgv.push('--inspect-wait');
    }
    const workerPath = path.resolve(__dirname, 'worker.js');
    logger.debug('Spawning worker process', {
      workerPath,
    });
    const rstestProcess = spawn('node', [...execArgv, workerPath], {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      serialization: 'advanced',
      env: {
        // same as packages/core/src/cli/prepare.ts
        // if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test'
        NODE_ENV: 'test',
        ...process.env,
        // process.env.RSTEST = 'true';
        RSTEST: 'true',
        FORCE_COLOR: '1',
      },
    });
    this.childProcess = rstestProcess;

    if (startDebugging) {
      const startedDebugging = await vscode.debug.startDebugging(
        this.workspace,
        {
          type: 'node',
          name: 'Rstest Debug',
          request: 'attach',
          processId: rstestProcess.pid,
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

    rstestProcess.stdout?.on('data', (d) => {
      const content = d.toString();
      logger.debug('[worker stdout]', content.trimEnd());
    });

    rstestProcess.stderr?.on('data', (d) => {
      const content = d.toString();
      logger.error('[worker stderr]', content.trimEnd());
    });

    const worker = createBirpc<Worker, TestRunReporter>(testRunReporter, {
      // use this.childProcess to catch post is called after process killed
      post: (data) => this.childProcess?.send(data),
      on: (fn) => rstestProcess.on('message', fn),
      bind: 'functions',
      timeout: 600_000,
      off: () => {
        rstestProcess.kill();
        runningWorkers.delete(worker);
      },
    });

    runningWorkers.add(worker);

    logger.debug('Sent init payload to worker', {
      root: this.cwd,
      rstestPath,
      configFilePath: this.configFilePath,
    });

    rstestProcess.on('exit', (code, signal) => {
      logger.debug('Worker process exited', { code, signal });
    });

    return worker;
  }

  public dispose() {
    this.childProcess?.kill();
    this.childProcess = null;
  }
}
