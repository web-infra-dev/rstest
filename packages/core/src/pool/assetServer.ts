import { randomBytes } from 'node:crypto';
import { chmodSync, unlinkSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toError } from '../utils';

// POSIX `sockaddr_un.sun_path` is 104 bytes on macOS and 108 bytes on Linux.
const MAX_UNIX_SOCKET_PATH_BYTES = 100;
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

type AssetProvider = {
  getAssetFiles: (names: string[]) => Promise<Record<string, Buffer>>;
  allowedPaths: Set<string>;
  onLoadError?: (error: unknown) => void;
};

type AssetSocketRequest = {
  token?: unknown;
  providerId?: unknown;
  paths?: unknown;
};

type AssetSocketResponseHeader =
  | {
      ok: true;
      files: Array<[string, number]>;
    }
  | {
      ok: false;
      error: string;
    };

export type RegisteredAssetProvider = {
  socketPath: string;
  token: string;
  providerId: number;
};

const createSocketPath = (): string | undefined => {
  const suffix = `rstest-a-${process.pid}-${randomBytes(6).toString('hex')}`;
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\${suffix}`;
  }

  const candidate = join(tmpdir(), `${suffix}.sock`);
  if (Buffer.byteLength(candidate) <= MAX_UNIX_SOCKET_PATH_BYTES) {
    return candidate;
  }

  const fallback = `/tmp/${suffix}.sock`;
  return Buffer.byteLength(fallback) <= MAX_UNIX_SOCKET_PATH_BYTES
    ? fallback
    : undefined;
};

const writeBuffer = (socket: Socket, chunk: Buffer): Promise<void> => {
  if (socket.destroyed || !socket.writable) {
    return Promise.resolve();
  }
  if (socket.write(chunk)) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const onDone = () => {
      socket.off('drain', onDone);
      socket.off('close', onDone);
      socket.off('error', onDone);
      resolve();
    };
    socket.once('drain', onDone);
    socket.once('close', onDone);
    socket.once('error', onDone);
  });
};

const writeFrameHeader = async (
  socket: Socket,
  header: AssetSocketResponseHeader,
): Promise<void> => {
  const headerJson = JSON.stringify(header);
  const headerLen = Buffer.byteLength(headerJson, 'utf8');
  const frame = Buffer.allocUnsafe(4 + headerLen);
  frame.writeUInt32BE(headerLen, 0);
  frame.write(headerJson, 4, headerLen, 'utf8');
  await writeBuffer(socket, frame);
};

/**
 * Local binary socket server that streams compiled `Buffer` assets directly
 * from host memory to fork workers without `child_process.send()`'s
 * `v8.serialize` copy and external-memory retention.
 *
 * Uses a Unix domain socket on POSIX and a named pipe on Windows. Started
 * lazily on the first in-memory fork dispatch and closed with the pool.
 */
export class AssetServer {
  private readonly token = randomBytes(16).toString('hex');
  private readonly providers = new Map<number, AssetProvider>();
  private readonly sockets = new Set<Socket>();
  private nextProviderId = 1;
  private server: Server | undefined;
  private socketPath: string | undefined;
  private startPromise: Promise<string | undefined> | undefined;
  private closed = false;
  private exitCleanupInstalled = false;

  private readonly unlinkSocketSync = (): void => {
    if (!this.socketPath || process.platform === 'win32') {
      return;
    }
    try {
      unlinkSync(this.socketPath);
    } catch {
      // ignore missing/already-unlinked socket
    }
  };

  async registerProvider(
    getAssetFiles: AssetProvider['getAssetFiles'],
    allowedPaths: Set<string>,
    onLoadError?: AssetProvider['onLoadError'],
  ): Promise<RegisteredAssetProvider | undefined> {
    if (this.closed) {
      return undefined;
    }
    const socketPath = await this.ensureStarted();
    if (!socketPath || this.closed) {
      return undefined;
    }
    const providerId = this.nextProviderId++;
    this.providers.set(providerId, {
      getAssetFiles,
      allowedPaths,
      onLoadError,
    });
    return {
      socketPath,
      token: this.token,
      providerId,
    };
  }

  unregisterProvider(providerId: number): void {
    this.providers.delete(providerId);
  }

  private ensureStarted(): Promise<string | undefined> {
    if (this.startPromise) {
      return this.startPromise;
    }
    this.startPromise = this.start();
    return this.startPromise;
  }

  private async start(): Promise<string | undefined> {
    const socketPath = createSocketPath();
    if (!socketPath) {
      return undefined;
    }

    const server = createServer((socket) => {
      this.handleConnection(socket);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => {
          server.off('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen({ path: socketPath, backlog: 511 });
      });
    } catch {
      try {
        server.close();
      } catch {
        // ignore
      }
      return undefined;
    }

    if (this.closed) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      if (process.platform !== 'win32') {
        try {
          unlinkSync(socketPath);
        } catch {
          // ignore
        }
      }
      return undefined;
    }

    if (process.platform !== 'win32') {
      try {
        chmodSync(socketPath, 0o600);
      } catch {
        // best-effort owner-only permissions
      }
    }

    server.unref();
    server.on('error', () => {
      // Transport errors on individual sockets are handled per-connection.
    });
    this.server = server;
    this.socketPath = socketPath;
    if (!this.exitCleanupInstalled && process.platform !== 'win32') {
      this.exitCleanupInstalled = true;
      process.once('exit', this.unlinkSocketSync);
    }

    return socketPath;
  }

  private handleConnection(socket: Socket): void {
    if (this.closed) {
      socket.destroy();
      return;
    }

    this.sockets.add(socket);
    socket.once('close', () => {
      this.sockets.delete(socket);
    });
    socket.on('error', () => {
      // Workers killed mid-transfer can trigger EPIPE/ECONNRESET; ignore.
    });

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let expectedLength: number | undefined;
    let handled = false;

    socket.on('data', (chunk: Buffer) => {
      if (handled) {
        return;
      }
      chunks.push(chunk);
      totalBytes += chunk.byteLength;

      if (expectedLength === undefined) {
        if (totalBytes < 4) {
          return;
        }
        const headerBuf =
          chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks);
        expectedLength = headerBuf.readUInt32BE(0);
        if (expectedLength > MAX_REQUEST_BYTES) {
          handled = true;
          socket.destroy();
          return;
        }
        chunks.length = 0;
        chunks.push(headerBuf);
      }

      if (totalBytes >= 4 + expectedLength) {
        const full = chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks);
        handled = true;
        void this.serveRequest(socket, full.subarray(4, 4 + expectedLength));
      }
    });
  }

  private async serveRequest(socket: Socket, rawJson: Buffer): Promise<void> {
    try {
      const parsed = JSON.parse(rawJson.toString('utf8')) as AssetSocketRequest;

      if (
        parsed.token !== this.token ||
        typeof parsed.providerId !== 'number' ||
        !Array.isArray(parsed.paths) ||
        !parsed.paths.every((p): p is string => typeof p === 'string')
      ) {
        await writeFrameHeader(socket, {
          ok: false,
          error: 'Invalid asset socket request',
        });
        socket.end();
        return;
      }

      const provider = this.providers.get(parsed.providerId);
      if (!provider) {
        await writeFrameHeader(socket, {
          ok: false,
          error: 'Asset provider is no longer active',
        });
        socket.end();
        return;
      }

      for (const filePath of parsed.paths) {
        if (!provider.allowedPaths.has(filePath)) {
          await writeFrameHeader(socket, {
            ok: false,
            error: `Asset path not allowed: ${filePath}`,
          });
          socket.end();
          return;
        }
      }

      let loaded: Record<string, Buffer>;
      try {
        loaded = await provider.getAssetFiles(parsed.paths);
      } catch (error) {
        provider.onLoadError?.(error);
        if (!socket.destroyed) {
          await writeFrameHeader(socket, {
            ok: false,
            error: toError(error).message,
          });
          socket.end();
        }
        return;
      }
      if (socket.destroyed) {
        return;
      }

      const orderedBuffers: Buffer[] = [];
      const filesMeta: Array<[string, number]> = [];
      for (const filePath of parsed.paths) {
        const content = loaded[filePath];
        if (!content) {
          const error = new Error(`Asset not found: ${filePath}`);
          provider.onLoadError?.(error);
          await writeFrameHeader(socket, {
            ok: false,
            error: error.message,
          });
          socket.end();
          return;
        }
        filesMeta.push([filePath, content.byteLength]);
        orderedBuffers.push(content);
      }

      await writeFrameHeader(socket, { ok: true, files: filesMeta });
      for (const buf of orderedBuffers) {
        if (socket.destroyed) {
          return;
        }
        await writeBuffer(socket, buf);
      }
      socket.end();
    } catch (error) {
      if (!socket.destroyed) {
        try {
          await writeFrameHeader(socket, {
            ok: false,
            error: toError(error).message,
          });
          socket.end();
        } catch {
          socket.destroy();
        }
      }
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.providers.clear();
    if (this.startPromise) {
      await this.startPromise.catch(() => undefined);
    }
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();

    const server = this.server;
    this.server = undefined;
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }

    this.unlinkSocketSync();
    this.socketPath = undefined;
    if (this.exitCleanupInstalled) {
      this.exitCleanupInstalled = false;
      process.off('exit', this.unlinkSocketSync);
    }
  }
}
