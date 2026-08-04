import { logger, type TestResult } from '@rstest/core/internal/browser';
import { type BirpcReturn, createBirpc } from 'birpc';
import { type WebSocket, WebSocketServer } from 'ws';
import type {
  BrowserDispatchRequest,
  BrowserDispatchResponse,
  BrowserHostConfig,
  TestFileInfo,
} from './protocol';
import type {
  FatalPayload,
  HeadedTestFileCompletePayload,
  LogPayload,
  ReloadTestFileAck,
  TestFileStartPayload,
} from './hostPayloads';

/** RPC methods exposed by the host (server) to the container (client) */
export type HostRpcMethods = {
  rerunTest: (testFile: string, testNamePattern?: string) => Promise<void>;
  getTestFiles: () => Promise<TestFileInfo[]>;
  onRunnerFramesReady: (testFiles: string[]) => Promise<void>;
  // Test result callbacks from container
  onTestFileStart: (payload: TestFileStartPayload) => Promise<void>;
  onTestCaseResult: (payload: TestResult) => Promise<void>;
  onTestFileComplete: (payload: HeadedTestFileCompletePayload) => Promise<void>;
  onLog: (payload: LogPayload) => Promise<void>;
  onFatal: (payload: FatalPayload) => Promise<void>;
  // Generic dispatch endpoint used by runner RPC requests.
  dispatch: (
    request: BrowserDispatchRequest,
  ) => Promise<BrowserDispatchResponse>;
};

/** RPC methods exposed by the container (client) to the host (server) */
export type ContainerRpcMethods = {
  onTestFileUpdate: (testFiles: TestFileInfo[]) => Promise<void>;
  reloadTestFile: (
    testFile: string,
    testNamePattern?: string,
  ) => Promise<ReloadTestFileAck>;
  /**
   * Replace the container's copy of the host config so runner iframes loaded
   * from now on receive fresh values (e.g. the 'u' shortcut flipping
   * `snapshot.updateSnapshot` between watch reruns).
   */
  onHostConfigUpdate: (config: BrowserHostConfig) => Promise<void>;
};

export type ContainerRpc = BirpcReturn<ContainerRpcMethods, HostRpcMethods>;

// ============================================================================
// RPC Manager - Encapsulates WebSocket and birpc management
// ============================================================================

/**
 * Manages the WebSocket connection and birpc communication with the container UI.
 * Provides a clean interface for sending RPC calls and handling connections.
 */
export class ContainerRpcManager {
  private wss: WebSocketServer;
  private ws: WebSocket | null = null;
  private rpc: ContainerRpc | null = null;
  private methods: HostRpcMethods;
  private onDisconnect?: (error: Error) => void;
  private detachActiveSocketListeners: (() => void) | null = null;

  constructor(
    wss: WebSocketServer,
    methods: HostRpcMethods,
    onDisconnect?: (error: Error) => void,
  ) {
    this.wss = wss;
    this.methods = methods;
    this.onDisconnect = onDisconnect;
    this.setupConnectionHandler();
  }

  /** Update the RPC methods (used when starting a new test run) */
  updateMethods(
    methods: HostRpcMethods,
    onDisconnect?: (error: Error) => void,
  ): void {
    this.methods = methods;
    this.onDisconnect = onDisconnect;
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
    this.detachActiveSocketListeners?.();
    if (this.rpc && !this.rpc.$closed) {
      this.rpc.$close(new Error('Container RPC transport reattached'));
    }
    this.ws = ws;
    const messageHandlers = new WeakMap<
      (data: any) => void,
      (message: any) => void
    >();

    this.rpc = createBirpc<ContainerRpcMethods, HostRpcMethods>(this.methods, {
      timeout: -1,
      post: (data) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify(data));
        }
      },
      on: (fn) => {
        const handler = (message: any) => {
          try {
            const data = JSON.parse(message.toString());
            fn(data);
          } catch {
            // ignore invalid messages
          }
        };
        messageHandlers.set(fn, handler);
        ws.on('message', handler);
      },
      off: (fn) => {
        const handler = messageHandlers.get(fn);
        if (!handler) {
          return;
        }
        ws.off('message', handler);
        messageHandlers.delete(fn);
      },
    });

    const handleClose = () => {
      // Only clear if this is still the active connection
      // This prevents a race condition when a new connection is established
      // before the old one's close event fires
      if (this.ws === ws) {
        this.ws = null;
      }
      this.detachActiveSocketListeners?.();
      this.detachActiveSocketListeners = null;
      if (this.rpc && !this.rpc.$closed) {
        const disconnectError = new Error(
          'Browser UI WebSocket disconnected before reload completed',
        );
        this.rpc.$close(disconnectError);
        this.onDisconnect?.(disconnectError);
      }
      this.rpc = null;
    };

    ws.on('close', handleClose);
    this.detachActiveSocketListeners = () => {
      ws.off('close', handleClose);
    };
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

  /** Push a refreshed host config to the container (watch reruns) */
  async updateHostConfig(config: BrowserHostConfig): Promise<void> {
    await this.rpc?.onHostConfigUpdate(config);
  }

  /** Request container to reload a specific test file */
  async reloadTestFile(
    testFile: string,
    testNamePattern?: string,
  ): Promise<ReloadTestFileAck> {
    logger.debug(
      `[Browser UI] reloadTestFile called, rpc: ${this.rpc ? 'exists' : 'null'}, ws: ${this.ws ? 'exists' : 'null'}`,
    );
    if (!this.rpc) {
      throw new Error('Browser UI RPC not available for reloadTestFile');
    }
    logger.debug(`[Browser UI] Calling reloadTestFile: ${testFile}`);
    return this.rpc.reloadTestFile(testFile, testNamePattern);
  }
}
