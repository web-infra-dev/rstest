import type { IncomingMessage } from 'node:http';
import { logger } from '@rstest/core/internal/browser';
import { type BirpcReturn, createBirpc } from 'birpc';
import type { WebSocket, WebSocketServer } from 'ws';
import type {
  BrowserDispatchRequest,
  BrowserDispatchResponse,
  BrowserHostConfig,
  TestFileInfo,
  VersionedTestFileSet,
} from './protocol';

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
// RPC Session & Hub - Multiplexes WebSocket connections per headed container
// ============================================================================

/**
 * Manages one headed container window's WebSocket connection and birpc channel.
 * Multiple containers share a single WebSocketServer through {@link ContainerRpcHub},
 * while each session keeps its own transport epoch and settlement callbacks.
 */
export class ContainerRpcSession {
  private ws: WebSocket | null = null;
  private rpc: ContainerRpc | null = null;
  private methods: HostRpcMethods;
  private onDisconnect?: (error: Error) => void;
  private onAttach?: (transportEpoch: number) => void;
  private detachActiveSocketListeners: (() => void) | null = null;
  private transportEpoch = 0;

  constructor(
    methods: HostRpcMethods,
    onDisconnect?: (error: Error) => void,
    onAttach?: (transportEpoch: number) => void,
  ) {
    this.methods = methods;
    this.onDisconnect = onDisconnect;
    this.onAttach = onAttach;
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

  attachWebSocket(ws: WebSocket): void {
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

  /** Check if this container is currently connected */
  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === this.ws.OPEN;
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

const parseContainerId = (req?: IncomingMessage): string | null => {
  if (!req?.url) {
    return null;
  }
  try {
    return new URL(req.url, 'http://localhost').searchParams.get('containerId');
  } catch {
    return null;
  }
};

/**
 * Multiplexes one shared `WebSocketServer` across any number of headed
 * container windows. Each container connects with `?containerId=<id>` so a
 * sibling window's connection never replaces another container's transport.
 */
export class ContainerRpcHub {
  private sessions = new Map<string, ContainerRpcSession>();
  private pendingSockets = new Map<
    string,
    { ws: WebSocket; cleanup: () => void }
  >();

  constructor(wss: WebSocketServer) {
    wss.on('connection', (ws: WebSocket, req?: IncomingMessage) => {
      const containerId = parseContainerId(req);
      logger.debug(
        `[Browser UI] Container WebSocket connected (containerId: ${containerId ?? '<default>'})`,
      );
      if (containerId) {
        const session = this.sessions.get(containerId);
        if (session) {
          session.attachWebSocket(ws);
          return;
        }
        this.stashPendingSocket(containerId, ws);
        return;
      }

      if (this.sessions.size === 1) {
        const sole = this.sessions.values().next().value!;
        sole.attachWebSocket(ws);
        return;
      }

      if (this.sessions.size === 0) {
        this.stashPendingSocket('', ws);
      }
    });
  }

  private stashPendingSocket(key: string, ws: WebSocket): void {
    const previous = this.pendingSockets.get(key);
    if (previous) {
      previous.cleanup();
      this.pendingSockets.delete(key);
    }
    const handleClose = () => {
      if (this.pendingSockets.get(key)?.ws === ws) {
        this.pendingSockets.delete(key);
      }
    };
    ws.on('close', handleClose);
    this.pendingSockets.set(key, {
      ws,
      cleanup: () => {
        ws.off('close', handleClose);
      },
    });
  }

  private claimPendingSocket(key: string): WebSocket | undefined {
    const entry = this.pendingSockets.get(key);
    if (!entry) {
      return undefined;
    }
    entry.cleanup();
    this.pendingSockets.delete(key);
    return entry.ws.readyState === entry.ws.OPEN ? entry.ws : undefined;
  }

  register(
    containerId: string,
    methods: HostRpcMethods,
    onDisconnect?: (error: Error) => void,
    onAttach?: (transportEpoch: number) => void,
  ): ContainerRpcSession {
    const existing = this.sessions.get(containerId);
    if (existing) {
      existing.updateMethods(methods, onDisconnect, onAttach);
      return existing;
    }
    const session = new ContainerRpcSession(methods, onDisconnect, onAttach);
    this.sessions.set(containerId, session);
    const pending =
      this.claimPendingSocket(containerId) ??
      (this.sessions.size === 1 ? this.claimPendingSocket('') : undefined);
    if (pending) {
      session.attachWebSocket(pending);
    }
    return session;
  }
}
