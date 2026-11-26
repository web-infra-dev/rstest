import { readFile } from 'node:fs/promises';
import type { Socket } from 'node:net';
import type {
  AssetFileContent,
  AssetFiles,
  AssetSocketInfo,
  RunWorkerOptions,
  RuntimeRPC,
  WorkerContext,
} from '../../../types/worker';
import { parseInlineSourceMapStr } from '../../../utils/assetFiles';
import { isVmPoolType } from '../../../utils/workers';
import { getRealTimers, setRealTimers } from '../../realTimers';
import {
  type WorkerCache,
  type WorkerCacheNamespace,
  workerCache,
} from './cache';

const getContentSize = (content: AssetFileContent): number => {
  if (typeof content === 'string') {
    return Buffer.byteLength(content);
  }

  if ('encoding' in content) {
    return Math.floor((content.data.length * 3) / 4);
  }

  return content.byteLength;
};

const getSourceMapSize = (content: string): number =>
  Buffer.byteLength(content);

export type WorkerAssetCache = {
  assetFiles: WorkerCacheNamespace<AssetFileContent>;
  sourceMaps: WorkerCacheNamespace<string>;
};

export const createWorkerAssetCache = (
  cache: WorkerCache,
): WorkerAssetCache => ({
  assetFiles: cache.namespace('asset', getContentSize),
  sourceMaps: cache.namespace('source-map', getSourceMapSize),
});

export const workerAssetCache: WorkerAssetCache =
  createWorkerAssetCache(workerCache);

type LoadAssets = (
  names: string[],
  sourceMapNames?: string[],
) => ReturnType<RuntimeRPC['getAssetsByEntry']>;

const loadDiskAssets = async (
  names: string[],
  sourceMapNames: string[],
  sourceMapPaths: Record<string, string>,
): ReturnType<LoadAssets> => {
  const reads = new Map(names.map((name) => [name, readFile(name)]));
  const [assetEntries, mapEntries] = await Promise.all([
    Promise.all(
      Array.from(
        reads,
        async ([name, content]) => [name, await content] as const,
      ),
    ),
    Promise.all(
      sourceMapNames.map(async (name) => {
        const mapPath = sourceMapPaths[name];
        if (!mapPath) return null;

        const content = (
          await (reads.get(mapPath) ?? readFile(mapPath))
        ).toString('utf8');
        const map =
          mapPath === name ? parseInlineSourceMapStr(content) : content;
        return map === null ? null : ([name, map] as const);
      }),
    ),
  ]);
  return {
    assetFiles: Object.fromEntries(assetEntries),
    sourceMaps: Object.fromEntries(
      mapEntries.filter((entry) => entry !== null),
    ),
  };
};

export const loadCachedAssets = async (
  assetNames: string[],
  cache: WorkerAssetCache,
  loadAssets: LoadAssets,
): Promise<{
  assetFiles: AssetFiles;
  sourceMaps: Record<string, string>;
}> => {
  const assetFiles: AssetFiles = {};
  const sourceMaps: Record<string, string> = {};
  const missingAssetNames: string[] = [];
  const missingSourceMapNames: string[] = [];

  for (const name of assetNames) {
    const asset = cache.assetFiles.get(name);
    if (asset === undefined) {
      missingAssetNames.push(name);
    } else {
      assetFiles[name] = asset;
    }

    const sourceMap = cache.sourceMaps.get(name);
    if (sourceMap === undefined) {
      missingSourceMapNames.push(name);
    } else if (typeof sourceMap === 'string' && sourceMap) {
      sourceMaps[name] = sourceMap;
    }
  }

  const fetched =
    missingAssetNames.length || missingSourceMapNames.length
      ? await loadAssets(missingAssetNames, missingSourceMapNames)
      : { assetFiles: {}, sourceMaps: {} };

  Object.assign(assetFiles, fetched.assetFiles);
  for (const [name, content] of Object.entries(fetched.sourceMaps)) {
    if (typeof content === 'string' && content) {
      sourceMaps[name] = content;
    }
  }

  // Populate the LRU only after the task's complete asset set is retained in
  // the return value. An insertion may evict an earlier hit when one task is
  // larger than the cache budget, but that must only affect later tasks.
  for (const [name, content] of Object.entries(fetched.assetFiles)) {
    cache.assetFiles.set(name, content);
  }
  for (const [name, content] of Object.entries(fetched.sourceMaps)) {
    cache.sourceMaps.set(name, typeof content === 'string' ? content : '');
  }
  for (const name of missingSourceMapNames) {
    if (!(name in fetched.sourceMaps)) {
      cache.sourceMaps.set(name, '');
    }
  }

  return { assetFiles, sourceMaps };
};

type SocketResponseHeader =
  | {
      ok: true;
      files: Array<[string, number]>;
    }
  | {
      ok: false;
      error: string;
    };

const isSocketPermissionError = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EACCES' || code === 'EPERM';
};

// macOS returns ECONNREFUSED when a Unix domain socket's listen queue briefly
// saturates under a burst of simultaneous worker startups.
const isTransientConnectError = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ECONNREFUSED' || code === 'EAGAIN';
};

let netModulePromise: Promise<typeof import('node:net')> | undefined;
const loadNet = (): Promise<typeof import('node:net')> => {
  netModulePromise ??= import('node:net');
  return netModulePromise;
};

type PendingSocketRequest = {
  frame: Buffer;
  resolve: (value: Map<string, Buffer>) => void;
  reject: (error: Error) => void;
};

class AssetSocketTransportError extends Error {
  readonly causeError?: unknown;
  readonly code?: string;

  constructor(message: string, causeError?: unknown) {
    super(message);
    this.name = 'AssetSocketTransportError';
    this.causeError = causeError;
    this.code = (causeError as NodeJS.ErrnoException | undefined)?.code;
  }
}

/**
 * Reusable keep-alive client for `AssetServer`. Avoids per-task Unix domain
 * socket connect/accept/close overhead in reused workers (`vmForks` and
 * non-isolated `forks`), while calling `socket.unref()` when idle so worker
 * exit is never blocked.
 */
class AssetSocketClient {
  readonly socketPath: string;
  private readonly socket: Socket;
  private readonly queue: PendingSocketRequest[] = [];
  private active: PendingSocketRequest | undefined;
  private connected = false;
  private closed = false;

  // Streaming response parser state for the active request.
  private phase: 'len' | 'header' | 'body' = 'len';
  private lenFilled = 0;
  private readonly lenBuf = Buffer.allocUnsafe(4);
  private headerBuf: Buffer | undefined;
  private headerFilled = 0;
  private fileMeta: Array<[string, number]> = [];
  private fileIndex = 0;
  private currentBuf: Buffer | undefined;
  private currentFilled = 0;
  private result = new Map<string, Buffer>();

  constructor(socketPath: string, socket: Socket, onClose: () => void) {
    this.socketPath = socketPath;
    this.socket = socket;

    socket.on('connect', () => {
      this.connected = true;
      if (this.active) {
        socket.write(this.active.frame);
      }
    });

    socket.on('data', (chunk: Buffer) => {
      this.handleData(chunk);
    });

    socket.on('end', () => {
      this.failAll(
        new AssetSocketTransportError(
          'Asset socket closed before response completed',
        ),
      );
    });

    socket.on('error', (error: Error) => {
      this.failAll(
        new AssetSocketTransportError(
          error.message || 'Asset socket transport error',
          error,
        ),
      );
    });

    socket.once('close', () => {
      this.closed = true;
      onClose();
      this.failAll(
        new AssetSocketTransportError(
          'Asset socket closed before response completed',
        ),
      );
    });
  }

  get isUsable(): boolean {
    return !this.closed && !this.socket.destroyed;
  }

  request(frame: Buffer): Promise<Map<string, Buffer>> {
    if (!this.isUsable) {
      return Promise.reject(
        new AssetSocketTransportError('Asset socket is already closed'),
      );
    }

    return new Promise<Map<string, Buffer>>((resolve, reject) => {
      this.queue.push({ frame, resolve, reject });
      this.socket.ref();
      this.startNext();
    });
  }

  destroy(): void {
    this.closed = true;
    this.socket.destroy();
  }

  private resetParser(): void {
    this.phase = 'len';
    this.lenFilled = 0;
    this.headerBuf = undefined;
    this.headerFilled = 0;
    this.fileMeta = [];
    this.fileIndex = 0;
    this.currentBuf = undefined;
    this.currentFilled = 0;
    this.result = new Map<string, Buffer>();
  }

  private startNext(): void {
    if (this.active || this.closed || this.socket.destroyed) {
      return;
    }
    const next = this.queue.shift();
    if (!next) {
      this.socket.unref();
      return;
    }
    this.active = next;
    this.resetParser();
    if (this.connected) {
      this.socket.write(next.frame);
    }
  }

  private finishActive(): void {
    const active = this.active;
    if (!active) {
      return;
    }
    const result = this.result;
    this.active = undefined;
    this.resetParser();
    active.resolve(result);
    this.startNext();
  }

  private failActive(error: Error): void {
    const active = this.active;
    this.active = undefined;
    this.resetParser();
    this.closed = true;
    this.socket.destroy();
    active?.reject(error);
    this.failQueued(
      new AssetSocketTransportError(
        'Asset socket closed after request failure',
      ),
    );
  }

  private failQueued(error: Error): void {
    while (this.queue.length > 0) {
      this.queue.shift()!.reject(error);
    }
  }

  private failAll(error: Error): void {
    this.closed = true;
    const active = this.active;
    this.active = undefined;
    this.resetParser();
    if (!this.socket.destroyed) {
      this.socket.destroy();
    }
    active?.reject(error);
    this.failQueued(error);
  }

  private advanceFile(): boolean {
    while (this.fileIndex < this.fileMeta.length) {
      const [name, size] = this.fileMeta[this.fileIndex]!;
      // Allocate each file into its own right-sized Buffer so VM LRU eviction
      // never pins a shared response buffer.
      const buf = Buffer.allocUnsafe(size);
      this.result.set(name, buf);
      if (size === 0) {
        this.fileIndex++;
        continue;
      }
      this.currentBuf = buf;
      this.currentFilled = 0;
      return false;
    }
    this.currentBuf = undefined;
    return true;
  }

  private handleData(chunk: Buffer): void {
    let offset = 0;
    while (offset < chunk.byteLength && this.active) {
      if (this.phase === 'len') {
        const take = Math.min(4 - this.lenFilled, chunk.byteLength - offset);
        chunk.copy(this.lenBuf, this.lenFilled, offset, offset + take);
        this.lenFilled += take;
        offset += take;
        if (this.lenFilled === 4) {
          const headerLen = this.lenBuf.readUInt32BE(0);
          this.headerBuf = Buffer.allocUnsafe(headerLen);
          this.headerFilled = 0;
          this.phase = 'header';
        }
      } else if (this.phase === 'header') {
        const buf = this.headerBuf!;
        const take = Math.min(
          buf.byteLength - this.headerFilled,
          chunk.byteLength - offset,
        );
        chunk.copy(buf, this.headerFilled, offset, offset + take);
        this.headerFilled += take;
        offset += take;
        if (this.headerFilled === buf.byteLength) {
          let parsed: SocketResponseHeader;
          try {
            parsed = JSON.parse(buf.toString('utf8')) as SocketResponseHeader;
          } catch (error) {
            this.failActive(
              error instanceof Error
                ? error
                : new Error('Invalid asset socket header'),
            );
            return;
          }
          if (!parsed.ok) {
            this.failActive(new Error(parsed.error));
            return;
          }
          this.fileMeta = parsed.files;
          this.fileIndex = 0;
          this.phase = 'body';
          if (this.advanceFile()) {
            this.finishActive();
          }
        }
      } else if (this.phase === 'body') {
        const buf = this.currentBuf!;
        const take = Math.min(
          buf.byteLength - this.currentFilled,
          chunk.byteLength - offset,
        );
        chunk.copy(buf, this.currentFilled, offset, offset + take);
        this.currentFilled += take;
        offset += take;
        if (this.currentFilled === buf.byteLength) {
          this.fileIndex++;
          if (this.advanceFile()) {
            this.finishActive();
          }
        }
      }
    }
  }
}

let cachedSocketClient: AssetSocketClient | undefined;

const getOrCreateSocketClient = async (
  socketPath: string,
): Promise<{ client: AssetSocketClient; reused: boolean }> => {
  if (
    cachedSocketClient?.socketPath === socketPath &&
    cachedSocketClient.isUsable
  ) {
    return { client: cachedSocketClient, reused: true };
  }
  if (cachedSocketClient) {
    cachedSocketClient.destroy();
    cachedSocketClient = undefined;
  }
  const { createConnection } = await loadNet();
  const socket = createConnection(socketPath);
  const client = new AssetSocketClient(socketPath, socket, () => {
    if (cachedSocketClient === client) {
      cachedSocketClient = undefined;
    }
  });
  cachedSocketClient = client;
  return { client, reused: false };
};

const encodeAssetRequestFrame = (
  assetSocket: Pick<AssetSocketInfo, 'token' | 'providerId'>,
  paths: string[],
): Buffer => {
  const json = JSON.stringify({
    token: assetSocket.token,
    providerId: assetSocket.providerId,
    paths,
  });
  const payloadLen = Buffer.byteLength(json, 'utf8');
  const frame = Buffer.allocUnsafe(4 + payloadLen);
  frame.writeUInt32BE(payloadLen, 0);
  frame.write(json, 4, payloadLen, 'utf8');
  return frame;
};

const fetchSocketBuffers = async (
  assetSocket: Pick<AssetSocketInfo, 'socketPath' | 'token' | 'providerId'>,
  paths: string[],
): Promise<Map<string, Buffer>> => {
  if (paths.length === 0) {
    return new Map();
  }

  const frame = encodeAssetRequestFrame(assetSocket, paths);
  const retryDelaysMs = [5, 15, 50];
  let freshConnectAttempt = 0;

  for (;;) {
    const { client, reused } = await getOrCreateSocketClient(
      assetSocket.socketPath,
    );
    try {
      return await client.request(frame);
    } catch (error) {
      if (!(error instanceof AssetSocketTransportError)) {
        throw error;
      }
      if (cachedSocketClient === client) {
        cachedSocketClient = undefined;
      }
      client.destroy();

      // If an idle keep-alive connection was closed by the server between
      // tasks, transparently reconnect once without waiting.
      if (reused) {
        continue;
      }

      const cause = error.causeError ?? error;
      if (
        freshConnectAttempt >= retryDelaysMs.length ||
        !isTransientConnectError(cause)
      ) {
        throw cause;
      }
      setRealTimers();
      const scheduleTimeout = getRealTimers().setTimeout!;
      const delay = retryDelaysMs[freshConnectAttempt++]!;
      await new Promise<void>((resolve) => {
        scheduleTimeout(resolve, delay);
      });
    }
  }
};

const loadSocketAssets = async (
  assetSocket: AssetSocketInfo,
  names: string[],
  sourceMapNames: string[],
): ReturnType<LoadAssets> => {
  const { sourceMapPaths } = assetSocket;
  const uniquePaths = new Set<string>(names);
  for (const name of sourceMapNames) {
    const mapPath = sourceMapPaths[name];
    if (mapPath) {
      uniquePaths.add(mapPath);
    }
  }

  const buffers = await fetchSocketBuffers(
    assetSocket,
    Array.from(uniquePaths),
  );

  const assetFiles: AssetFiles = {};
  for (const name of names) {
    const content = buffers.get(name);
    if (content !== undefined) {
      assetFiles[name] = content;
    }
  }

  const sourceMaps: Record<string, string> = {};
  for (const name of sourceMapNames) {
    const mapPath = sourceMapPaths[name];
    if (!mapPath) continue;
    const raw = buffers.get(mapPath);
    if (!raw) continue;
    const content = raw.toString('utf8');
    const map = mapPath === name ? parseInlineSourceMapStr(content) : content;
    if (map !== null) {
      sourceMaps[name] = map;
    }
  }

  return { assetFiles, sourceMaps };
};

export const loadTaskAssets = async (
  options: Pick<
    RunWorkerOptions['options'],
    'assetNames' | 'diskSourceMapPaths' | 'assetSocket'
  > & {
    context: Pick<WorkerContext, 'pool' | 'workerCacheLimit'>;
  },
  assets: RunWorkerOptions['options']['assets'],
  rpc: Pick<RuntimeRPC, 'getAssetsByEntry'>,
): Promise<NonNullable<RunWorkerOptions['options']['assets']>> => {
  const { assetNames, context, diskSourceMapPaths, assetSocket } = options;
  const usesVmPool = isVmPoolType(context.pool);
  if (usesVmPool) {
    workerCache.configure(context.workerCacheLimit ?? 0);
  }
  if (assets) {
    return assets;
  }

  // A worker can have narrower filesystem grants than the host.
  const loadAssets: LoadAssets =
    diskSourceMapPaths && !process.permission
      ? (files, mapNames = files) =>
          loadDiskAssets(files, mapNames, diskSourceMapPaths)
      : assetSocket && !process.permission
        ? (files, mapNames = files) =>
            loadSocketAssets(assetSocket, files, mapNames).catch((err) => {
              if (isSocketPermissionError(err)) {
                return rpc.getAssetsByEntry(files, mapNames);
              }
              throw err;
            })
        : rpc.getAssetsByEntry;
  if (!usesVmPool || context.workerCacheLimit === undefined) {
    return loadAssets(assetNames);
  }

  return loadCachedAssets(assetNames, workerAssetCache, loadAssets);
};
