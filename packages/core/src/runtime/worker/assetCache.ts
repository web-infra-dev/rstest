import type {
  AssetFileContent,
  AssetFiles,
  RuntimeRPC,
} from '../../types/worker';

type CacheEntry = {
  content: AssetFileContent;
  size: number;
};

const getContentSize = (content: AssetFileContent): number => {
  if (typeof content === 'string') {
    return Buffer.byteLength(content);
  }

  if ('encoding' in content) {
    return Math.floor((content.data.length * 3) / 4);
  }

  return content.byteLength;
};

/**
 * Keeps immutable bundle bytes in the worker thread, outside VM Contexts.
 * Module instances are intentionally not cached here: they are realm-bound.
 */
export class WorkerAssetCache {
  private readonly entries = new Map<string, CacheEntry>();
  private totalBytes = 0;
  private limitBytes: number;

  constructor(limitBytes: number) {
    this.limitBytes = limitBytes;
  }

  configure(limitBytes: number): void {
    if (this.limitBytes === limitBytes) {
      return;
    }

    this.limitBytes = limitBytes;
    this.clear();
  }

  get(key: string): AssetFileContent | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.content;
  }

  set(key: string, content: AssetFileContent): void {
    const size = getContentSize(content);
    const previous = this.entries.get(key);
    if (previous) {
      this.totalBytes -= previous.size;
      this.entries.delete(key);
    }

    if (size > this.limitBytes) {
      return;
    }

    while (this.totalBytes + size > this.limitBytes) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }

      const oldest = this.entries.get(oldestKey)!;
      this.entries.delete(oldestKey);
      this.totalBytes -= oldest.size;
    }

    this.entries.set(key, { content, size });
    this.totalBytes += size;
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }
}

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
    const asset = cache.get(`asset:${name}`);
    if (asset === undefined) {
      missingAssetNames.push(name);
    } else {
      assetFiles[name] = asset;
    }

    const sourceMap = cache.get(`sourceMap:${name}`);
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
    cache.set(`asset:${name}`, content);
  }
  for (const [name, content] of Object.entries(fetched.sourceMaps)) {
    cache.set(`sourceMap:${name}`, content);
  }
  for (const name of missingSourceMapNames) {
    if (!(name in fetched.sourceMaps)) {
      cache.set(`sourceMap:${name}`, '');
    }
  }

  return { assetFiles, sourceMaps };
};
