type CacheEntry = {
  size: number;
  value: unknown;
};

// Keep zero-byte values and short cache keys from bypassing the byte budget.
// This is a conservative approximation of Map/string/object bookkeeping.
const CACHE_ENTRY_OVERHEAD_BYTES = 64;

export class WorkerCacheNamespace<T> {
  constructor(
    private readonly cache: WorkerCache,
    private readonly prefix: string,
    private readonly getSize: (value: T) => number,
  ) {}

  get(key: string): T | undefined {
    return this.cache.get(`${this.prefix}:${key}`) as T | undefined;
  }

  set(key: string, value: T): void {
    this.cache.set(`${this.prefix}:${key}`, value, this.getSize(value));
  }

  clear(): void {
    this.cache.clearPrefix(`${this.prefix}:`);
  }
}

export class WorkerCache {
  private readonly entries = new Map<string, CacheEntry>();
  private totalBytes = 0;

  constructor(private limitBytes: number) {}

  namespace<T>(
    name: string,
    getSize: (value: T) => number,
  ): WorkerCacheNamespace<T> {
    return new WorkerCacheNamespace(this, name, getSize);
  }

  configure(limitBytes: number): void {
    if (this.limitBytes === limitBytes) {
      return;
    }
    this.limitBytes = limitBytes;
    this.clear();
  }

  get(key: string): unknown {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: unknown, size: number): void {
    const previous = this.entries.get(key);
    if (previous) {
      this.totalBytes -= previous.size;
      this.entries.delete(key);
    }

    const entrySize =
      CACHE_ENTRY_OVERHEAD_BYTES + Buffer.byteLength(key) + Math.max(0, size);
    if (this.limitBytes === 0 || entrySize > this.limitBytes) {
      return;
    }

    while (this.totalBytes + entrySize > this.limitBytes) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      const oldest = this.entries.get(oldestKey)!;
      this.entries.delete(oldestKey);
      this.totalBytes -= oldest.size;
    }

    this.entries.set(key, { size: entrySize, value });
    this.totalBytes += entrySize;
  }

  clearPrefix(prefix: string): void {
    for (const [key, entry] of this.entries) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
        this.totalBytes -= entry.size;
      }
    }
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }
}

export const workerCache: WorkerCache = new WorkerCache(0);
