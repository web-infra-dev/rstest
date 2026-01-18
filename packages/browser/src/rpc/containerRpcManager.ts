import { logger } from '@rstest/core/browser';
import { createBirpc } from 'birpc';
import type { WebSocket, WebSocketServer } from 'ws';
import type { TestFileInfo } from '../protocol';
import type {
  ContainerRpc,
  ContainerRpcMethods,
  HostRpcMethods,
} from './types';

/**
 * Manages the WebSocket connection and birpc communication with the container UI.
 * Provides a clean interface for sending RPC calls and handling connections.
 */
export class ContainerRpcManager {
  private wss: WebSocketServer;
  private ws: WebSocket | null = null;
  private rpc: ContainerRpc | null = null;
  private methods: HostRpcMethods;

  constructor(wss: WebSocketServer, methods: HostRpcMethods) {
    this.wss = wss;
    this.methods = methods;
    this.setupConnectionHandler();
  }

  /** Update the RPC methods (used when starting a new test run) */
  updateMethods(methods: HostRpcMethods): void {
    this.methods = methods;
    // Re-create birpc with new methods if already connected
    if (this.ws && this.ws.readyState === this.ws.OPEN) {
      this.attachWebSocket(this.ws);
    }
  }

  private setupConnectionHandler(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      logger.debug('[Browser UI] Container WebSocket connected');
      logger.debug(
        `[Browser UI] Current ws: ${this.ws ? 'exists' : 'null'}, new ws: ${ws ? 'exists' : 'null'}`,
      );
      this.attachWebSocket(ws);
    });
  }

  private attachWebSocket(ws: WebSocket): void {
    this.ws = ws;

    this.rpc = createBirpc<ContainerRpcMethods, HostRpcMethods>(this.methods, {
      post: (data) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify(data));
        }
      },
      on: (fn) => {
        ws.on('message', (message) => {
          try {
            const data = JSON.parse(message.toString());
            fn(data);
          } catch {
            // ignore invalid messages
          }
        });
      },
    });

    ws.on('close', () => {
      // Only clear if this is still the active connection
      // This prevents a race condition when a new connection is established
      // before the old one's close event fires
      if (this.ws === ws) {
        this.ws = null;
        this.rpc = null;
      }
    });
  }

  /** Check if a container is currently connected */
  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === this.ws.OPEN;
  }

  /** Get the current WebSocket instance (for reuse in watch mode) */
  get currentWebSocket(): WebSocket | null {
    return this.ws;
  }

  /** Reattach an existing WebSocket (for watch mode reuse) */
  reattach(ws: WebSocket): void {
    this.attachWebSocket(ws);
  }

  /** Notify container of test file changes */
  async notifyTestFileUpdate(files: TestFileInfo[]): Promise<void> {
    await this.rpc?.onTestFileUpdate(files);
  }

  /** Request container to reload a specific test file */
  async reloadTestFile(
    testFile: string,
    testNamePattern?: string,
  ): Promise<void> {
    logger.debug(
      `[Browser UI] reloadTestFile called, rpc: ${this.rpc ? 'exists' : 'null'}, ws: ${this.ws ? 'exists' : 'null'}`,
    );
    if (!this.rpc) {
      logger.debug('[Browser UI] RPC not available, skipping reloadTestFile');
      return;
    }
    logger.debug(`[Browser UI] Calling reloadTestFile: ${testFile}`);
    await this.rpc.reloadTestFile(testFile, testNamePattern);
  }
}
