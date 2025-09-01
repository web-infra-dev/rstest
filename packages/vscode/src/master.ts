import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import * as path from 'node:path';
import { type BirpcReturn, createBirpc } from 'birpc';
import getPort from 'get-port';
import * as vscode from 'vscode';
import type { WebSocket } from 'ws';
import { WebSocketServer } from 'ws';

import type {
  WorkerEvent,
  WorkerEventFinish,
  WorkerInitData,
  WorkerRunTestData,
} from './types';

export class RstestApi {
  public ws: WebSocket | null = null;
  private testPromises: Map<
    string,
    { resolve: (value: any) => void; reject: (reason?: any) => void }
  > = new Map();

  constructor() {}

  public resolveRstestPath(): { cwd: string; rstestPath: string }[] {
    // TODO: support pnp
    try {
      // TODO: use 0 temporarily.
      const workspace = vscode.workspace.workspaceFolders?.[0];
      if (!workspace) {
        vscode.window.showErrorMessage('No workspace found');
        throw new Error('No workspace found');
      }

      const nodeExport = require.resolve('@rstest/core', {
        paths: [workspace.uri.fsPath],
      });

      return [
        {
          cwd: workspace.uri.fsPath,
          rstestPath: nodeExport,
        },
      ];
    } catch (e) {
      vscode.window.showErrorMessage((e as any).toString());
      throw e;
    }
  }

  public async runTest(item: vscode.TestItem) {
    if (this.ws) {
      const data: WorkerRunTestData = {
        type: 'runTest',
        id: item.id,
        fileFilters: [item.uri!.fsPath],
        testNamePattern: item.label,
      };

      // Create a promise that will be resolved when we get a response with the matching ID
      const promise = new Promise<any>((resolve, reject) => {
        this.testPromises.set(item.id, { resolve, reject });

        // Set a timeout to prevent hanging indefinitely
        setTimeout(() => {
          const promiseObj = this.testPromises.get(item.id);
          if (promiseObj) {
            this.testPromises.delete(item.id);
            reject(new Error(`Test execution timed out for ${item.label}`));
          }
        }, 10000); // 10 seconds timeout
      });

      this.ws.send(JSON.stringify(data));
      return promise;
    }
  }

  public async createChildProcess() {
    const execArgv: string[] = [];
    const workerPath = path.resolve(__dirname, 'worker/index.js');
    const port = await getPort();
    const wsAddress = `ws://localhost:${port}`;
    const rstestProcess = spawn('node', [...execArgv, workerPath], {
      stdio: 'pipe',
      env: {
        ...process.env,
        TEST: 'true',
        RSTEST_WS_ADDRESS: wsAddress,
      },
    });

    rstestProcess.stdout?.on('data', (d) => {
      const content = d.toString();
      console.log('🟢', content);
    });

    const server = createServer().listen(port).unref();
    const wss = new WebSocketServer({ server });

    wss.once('connection', (ws) => {
      this.ws = ws;
      const { cwd, rstestPath } = this.resolveRstestPath()[0];
      ws.send(
        JSON.stringify({
          type: 'init',
          rstestPath,
          cwd,
        }),
      );

      ws.on('message', (_data) => {
        const _message = JSON.parse(_data.toString()) as WorkerEvent;
        if (_message.type === 'finish') {
          const message: WorkerEventFinish = _message;
          // Check if we have a pending promise for this test ID
          const promiseObj = this.testPromises.get(message.id);
          if (promiseObj) {
            // Resolve the promise with the message data
            promiseObj.resolve(message);
            // Remove the promise from the map
            this.testPromises.delete(message.id);
          }
        }
      });
    });

    rstestProcess.on('exit', () => {});
  }

  public async createRstestWorker() {}
}
