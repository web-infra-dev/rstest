import type {
  AssetFileContent,
  AssetFiles,
  RuntimeRPC,
} from '../../../types/worker';
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

export type WorkerAssetCache = {
  assetFiles: WorkerCacheNamespace<AssetFileContent>;
  sourceMaps: WorkerCacheNamespace<AssetFileContent>;
};

export const createWorkerAssetCache = (
  cache: WorkerCache,
): WorkerAssetCache => ({
  assetFiles: cache.namespace('asset', getContentSize),
  sourceMaps: cache.namespace('source-map', getContentSize),
});

export const workerAssetCache: WorkerAssetCache =
  createWorkerAssetCache(workerCache);

export const loadCachedAssets = async (
  assetNames: string[],
  cache: WorkerAssetCache,
  getAssetsByEntry: RuntimeRPC['getAssetsByEntry'],
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
      ? await getAssetsByEntry(missingAssetNames, missingSourceMapNames)
      : { assetFiles: {}, sourceMaps: {} };

  Object.assign(assetFiles, fetched.assetFiles);
  Object.assign(sourceMaps, fetched.sourceMaps);

  // Populate the LRU only after the task's complete asset set is retained in
  // the return value. An insertion may evict an earlier hit when one task is
  // larger than the cache budget, but that must only affect later tasks.
  for (const [name, content] of Object.entries(fetched.assetFiles)) {
    cache.assetFiles.set(name, content);
  }
  for (const [name, content] of Object.entries(fetched.sourceMaps)) {
    cache.sourceMaps.set(name, content);
  }
  for (const name of missingSourceMapNames) {
    if (!(name in fetched.sourceMaps)) {
      cache.sourceMaps.set(name, '');
    }
  }

  return { assetFiles, sourceMaps };
};
