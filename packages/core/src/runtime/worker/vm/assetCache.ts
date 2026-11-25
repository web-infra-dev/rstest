import { readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
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

const fetchSocketBuffersOnce = (
  assetSocket: Pick<AssetSocketInfo, 'socketPath' | 'token' | 'providerId'>,
  paths: string[],
): Promise<Map<string, Buffer>> => {
  if (paths.length === 0) {
    return Promise.resolve(new Map());
  }

  return new Promise<Map<string, Buffer>>((resolve, reject) => {
    const socket = createConnection(assetSocket.socketPath);
    const result = new Map<string, Buffer>();
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    // Streaming parser: reads 4-byte header length, JSON header, then copies
    // each file's bytes directly into its own right-sized Buffer so VM LRU
    // eviction never pins a shared response buffer.
    let phase: 'len' | 'header' | 'body' | 'done' = 'len';
    let lenFilled = 0;
    const lenBuf = Buffer.allocUnsafe(4);
    let headerBuf: Buffer | undefined;
    let headerFilled = 0;
    let fileMeta: Array<[string, number]> = [];
    let fileIndex = 0;
    let currentBuf: Buffer | undefined;
    let currentFilled = 0;

    const advanceFile = () => {
      while (fileIndex < fileMeta.length) {
        const [name, size] = fileMeta[fileIndex]!;
        const buf = Buffer.allocUnsafe(size);
        result.set(name, buf);
        if (size === 0) {
          fileIndex++;
          continue;
        }
        currentBuf = buf;
        currentFilled = 0;
        return;
      }
      currentBuf = undefined;
      phase = 'done';
    };

    socket.on('connect', () => {
      const json = JSON.stringify({
        token: assetSocket.token,
        providerId: assetSocket.providerId,
        paths,
      });
      const payloadLen = Buffer.byteLength(json, 'utf8');
      const frame = Buffer.allocUnsafe(4 + payloadLen);
      frame.writeUInt32BE(payloadLen, 0);
      frame.write(json, 4, payloadLen, 'utf8');
      socket.write(frame);
    });

    socket.on('data', (chunk: Buffer) => {
      let offset = 0;
      while (offset < chunk.byteLength && phase !== 'done') {
        if (phase === 'len') {
          const take = Math.min(4 - lenFilled, chunk.byteLength - offset);
          chunk.copy(lenBuf, lenFilled, offset, offset + take);
          lenFilled += take;
          offset += take;
          if (lenFilled === 4) {
            const headerLen = lenBuf.readUInt32BE(0);
            headerBuf = Buffer.allocUnsafe(headerLen);
            headerFilled = 0;
            phase = 'header';
          }
        } else if (phase === 'header') {
          const buf = headerBuf!;
          const take = Math.min(
            buf.byteLength - headerFilled,
            chunk.byteLength - offset,
          );
          chunk.copy(buf, headerFilled, offset, offset + take);
          headerFilled += take;
          offset += take;
          if (headerFilled === buf.byteLength) {
            let parsed: SocketResponseHeader;
            try {
              parsed = JSON.parse(buf.toString('utf8')) as SocketResponseHeader;
            } catch (error) {
              fail(
                error instanceof Error
                  ? error
                  : new Error('Invalid asset socket header'),
              );
              return;
            }
            if (!parsed.ok) {
              fail(new Error(parsed.error));
              return;
            }
            fileMeta = parsed.files;
            fileIndex = 0;
            phase = 'body';
            advanceFile();
          }
        } else if (phase === 'body') {
          const buf = currentBuf!;
          const take = Math.min(
            buf.byteLength - currentFilled,
            chunk.byteLength - offset,
          );
          chunk.copy(buf, currentFilled, offset, offset + take);
          currentFilled += take;
          offset += take;
          if (currentFilled === buf.byteLength) {
            fileIndex++;
            advanceFile();
          }
        }
      }
    });

    socket.on('end', () => {
      if (phase === 'done') {
        succeed();
      } else {
        fail(new Error('Asset socket closed before response completed'));
      }
    });

    socket.on('error', (error: Error) => {
      fail(error);
    });
  });
};

const fetchSocketBuffers = async (
  assetSocket: Pick<AssetSocketInfo, 'socketPath' | 'token' | 'providerId'>,
  paths: string[],
): Promise<Map<string, Buffer>> => {
  const retryDelaysMs = [5, 15, 50];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchSocketBuffersOnce(assetSocket, paths);
    } catch (error) {
      if (attempt >= retryDelaysMs.length || !isTransientConnectError(error)) {
        throw error;
      }
      setRealTimers();
      const scheduleTimeout = getRealTimers().setTimeout!;
      await new Promise<void>((resolve) => {
        scheduleTimeout(resolve, retryDelaysMs[attempt]);
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
