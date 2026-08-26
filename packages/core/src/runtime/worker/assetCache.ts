import type { AssetFileContent } from '../../types/worker';

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
