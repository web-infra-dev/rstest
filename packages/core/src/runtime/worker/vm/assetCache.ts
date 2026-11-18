import { readFile } from 'node:fs/promises';
import type {
  AssetFileContent,
  AssetFiles,
  RunWorkerOptions,
  RuntimeRPC,
  WorkerContext,
} from '../../../types/worker';
import { parseInlineSourceMapStr } from '../../../utils/assetFiles';
import { isVmPoolType } from '../../../utils/workers';
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

export const loadTaskAssets = async (
  options: Pick<
    RunWorkerOptions['options'],
    'assetNames' | 'diskSourceMapPaths'
  > & {
    context: Pick<WorkerContext, 'pool' | 'workerCacheLimit'>;
  },
  assets: RunWorkerOptions['options']['assets'],
  rpc: Pick<RuntimeRPC, 'getAssetsByEntry'>,
): Promise<NonNullable<RunWorkerOptions['options']['assets']>> => {
  const { assetNames, context, diskSourceMapPaths } = options;
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
      : rpc.getAssetsByEntry;
  if (!usesVmPool || context.workerCacheLimit === undefined) {
    return loadAssets(assetNames);
  }

  return loadCachedAssets(assetNames, workerAssetCache, loadAssets);
};
