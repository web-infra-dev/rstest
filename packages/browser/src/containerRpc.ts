import { logger } from '@rstest/core/internal/browser';
import { type BirpcReturn, createBirpc } from 'birpc';
import { type WebSocket, WebSocketServer } from 'ws';
import type {
  BrowserDispatchRequest,
  BrowserDispatchResponse,
  BrowserHostConfig,
  TestFileInfo,
} from './protocol';

/** The committed test-file set plus its monotonic version (see `onFrameSetReady`). */
export type VersionedTestFileSet = {
  files: TestFileInfo[];
  version: number;
};

/**
 * RPC methods exposed by the host (server) to the container (client).
 * Runner lifecycle events (file-start, case-result, file-complete, log,
 * fatal, ...) do NOT get dedicated methods: the container relays every runner
 * message as a `dispatch` request on the `runner` namespace, stamped with the
 * envelope's run identity, so the host has exactly one inbound gate.
 */
export type HostRpcMethods = {
  rerunTest: (testFile: string, testNamePattern?: string) => Promise<void>;
  getTestFiles: () => Promise<VersionedTestFileSet>;
  /**
   * The container committed the frame set for this version — every iframe for
   * the set exists in the DOM. Versions are monotonic, so a stale ack can
   * never satisfy a newer wait (a content signature could ABA back to a
   * previously-acked value; a counter cannot).
   */
  onFrameSetReady: (version: number) => Promise<void>;
  /**
   * The container granted this run a lease but no document ever adopted it
   * (navigation failed, config message lost, boot deadline elapsed). The run
   * can never complete; the host settles it now.
   */
  onRunAbandoned: (
    testFile: string,
    runId: string,
    reason: string,
  ) => Promise<void>;
  dispatch: (
    request: BrowserDispatchRequest,
  ) => Promise<BrowserDispatchResponse>;
};

/** RPC methods exposed by the container (client) to the host (server) */
export type ContainerRpcMethods = {
  onTestFileUpdate: (
    testFiles: TestFileInfo[],
    version: number,
  ) => Promise<void>;
  /**
   * Grant `runId` (host-minted, already registered host-side) to this file's
   * frame and navigate it. Identity travels IN — the container never mints or
   * echoes identity back.
   */
  reloadTestFile: (
    testFile: string,
    runId: string,
    testNamePattern?: string,
  ) => Promise<void>;
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
  private onAttach?: (transportEpoch: number) => void;
  private detachActiveSocketListeners: (() => void) | null = null;
  private transportEpoch = 0;

  constructor(
    wss: WebSocketServer,
    methods: HostRpcMethods,
    onDisconnect?: (error: Error) => void,
    onAttach?: (transportEpoch: number) => void,
  ) {
    this.wss = wss;
    this.methods = methods;
    this.onDisconnect = onDisconnect;
    this.onAttach = onAttach;
    this.setupConnectionHandler();
  }

  /** Update the RPC methods (used when starting a new test run) */
  updateMethods(
    methods: HostRpcMethods,
    onDisconnect?: (error: Error) => void,
    onAttach?: (transportEpoch: number) => void,
  ): void {
    this.methods = methods;
    this.onDisconnect = onDisconnect;
    this.onAttach = onAttach;
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
    // Bumped BEFORE the new transport can carry anything, and independent of
    // the previous socket's `close` event — which may never fire for the host,
    // because the line above just detached its listener. Runs leased under the
    // previous epoch can no longer complete; the epoch observer settles them.
    this.transportEpoch += 1;
    this.onAttach?.(this.transportEpoch);
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
  async notifyTestFileUpdate(
    files: TestFileInfo[],
    version: number,
  ): Promise<void> {
    await this.rpc?.onTestFileUpdate(files, version);
  }

  /** Push a refreshed host config to the container (watch reruns) */
  async updateHostConfig(config: BrowserHostConfig): Promise<void> {
    await this.rpc?.onHostConfigUpdate(config);
  }

  /** Grant a run to a test file's frame and navigate it */
  async reloadTestFile(
    testFile: string,
    runId: string,
    testNamePattern?: string,
  ): Promise<void> {
    logger.debug(
      `[Browser UI] reloadTestFile called, rpc: ${this.rpc ? 'exists' : 'null'}, ws: ${this.ws ? 'exists' : 'null'}`,
    );
    if (!this.rpc) {
      throw new Error('Browser UI RPC not available for reloadTestFile');
    }
    logger.debug(
      `[Browser UI] Calling reloadTestFile: ${testFile} (run ${runId})`,
    );
    await this.rpc.reloadTestFile(testFile, runId, testNamePattern);
  }
}
