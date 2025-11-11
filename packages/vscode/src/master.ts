import { type ChildProcess, spawn } from 'node:child_process';
import path, { dirname } from 'node:path';
import { createBirpc } from 'birpc';
import vscode from 'vscode';
import { getConfigValue } from './config';
import { logger } from './logger';
import type { LogLevel } from './shared/logger';
import type { WorkerRunTestData } from './types';
import { promiseWithTimeout } from './utils';
import type { Worker } from './worker';

export class RstestApi {
  public worker: Pick<Worker, 'initRstest' | 'runTest'> | null = null;
  private childProcess: ChildProcess | null = null;
  private versionMismatchWarned = false;

  constructor(
    private workspace: vscode.WorkspaceFolder,
    private cwd: string,
    private configFilePath: string,
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

      if (
        coreVersion &&
        extensionVersion &&
        coreVersion !== extensionVersion &&
        !this.versionMismatchWarned
      ) {
        this.versionMismatchWarned = true;
        vscode.window.showWarningMessage(
          `Rstest extension v${extensionVersion} does not match local @rstest/core v${coreVersion}. We're still stabilizing, so please upgrade Rstest or install an extension version that matches @rstest/core. We'll relax this requirement once things are stable.`,
        );
      }

      return nodeExport;
    } catch (e) {
      vscode.window.showErrorMessage((e as any).toString());
      throw e;
    }
  }

  public async runTest(item: vscode.TestItem) {
    if (this.worker) {
      const data: WorkerRunTestData = {
        id: item.id,
        fileFilters: [item.uri!.fsPath],
        testNamePattern: item.label,
      };

      return promiseWithTimeout(
        this.worker.runTest(data),
        10_000,
        new Error(`Test execution timed out for ${item.label}`),
      ); // 10 seconds timeout
    }
  }

  public async runFileTests(fileItem: vscode.TestItem) {
    if (this.worker) {
      const fileId = `file_${fileItem.id}`;
      const data: WorkerRunTestData = {
        id: fileId,
        fileFilters: [fileItem.uri!.fsPath],
        testNamePattern: '', // Empty pattern to run all tests in the file
      };

      return promiseWithTimeout(
        this.worker.runTest(data),
        30_000,
        new Error(`File test execution timed out for ${fileItem.uri!.fsPath}`),
      ); // 30 seconds timeout for file-level tests
    }
  }

  public async createChildProcess() {
    const rstestPath = this.resolveRstestPath();
    if (!rstestPath) {
      logger.error('Failed to resolve rstest path');
      return;
    }
    const execArgv: string[] = [];
    const workerPath = path.resolve(__dirname, 'worker.js');
    logger.debug('Spawning worker process', {
      workerPath,
    });
    const rstestProcess = spawn('node', [...execArgv, workerPath], {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      serialization: 'advanced',
      env: {
        ...process.env,
        TEST: 'true',
      },
    });
    this.childProcess = rstestProcess;

    rstestProcess.stdout?.on('data', (d) => {
      const content = d.toString();
      logger.debug('[worker stdout]', content.trimEnd());
    });

    rstestProcess.stderr?.on('data', (d) => {
      const content = d.toString();
      logger.error('[worker stderr]', content.trimEnd());
    });

    this.worker = createBirpc<Worker, RstestApi>(this, {
      // use this.childProcess to catch post is called after process killed
      post: (data) => this.childProcess?.send(data),
      on: (fn) => rstestProcess.on('message', fn),
      bind: 'functions',
    });

    await this.worker.initRstest({
      root: this.cwd,
      rstestPath,
      configFilePath: this.configFilePath,
    });
    logger.debug('Sent init payload to worker', {
      root: this.cwd,
      rstestPath,
      configFilePath: this.configFilePath,
    });

    rstestProcess.on('exit', (code, signal) => {
      logger.debug('Worker process exited', { code, signal });
    });
  }

  async log(level: LogLevel, message: string) {
    logger[level](message);
  }

  public dispose() {
    this.childProcess?.kill();
    this.childProcess = null;
  }
}
