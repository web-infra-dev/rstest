import { readFileSync } from 'node:fs';
import os from 'node:os';
import v8 from 'node:v8';
import { isDebug, logger } from '../utils/logger';
import { isWorkerResponseEnvelope } from './protocol';

// Hard-coded internal tuning. Intentionally not exposed as config or env var
// — see plan #1160. WHY values where non-obvious:
const RSS_QUANTILE = 0.9;
const WINDOW_SIZE = 32;
// ×3 leaves headroom for tail samples + system memory drift; ×2 caused
// fast/slow lane flapping in fixture tests, ×5 downgraded too late.
const FAST_LANE_FACTOR = 3;
// 1.5× empirical margin for GC nondeterminism in the host heap.
const HEAP_SAFETY_FACTOR = 1.5;
// Slow-lane cache is tighter (250 ms) than fast-lane (1 s) because slow-lane
// decisions are clustered and 1 s drift would block re-spawns too long.
const FREEMEM_CACHE_MS = 1000;
const MEMINFO_CACHE_MS = 250;
const POLL_INTERVAL_MS = 500;
// 0 = engage the gate the instant the first sample lands. Higher values
// trade cold-start defense for sample-stability — kept at 0 by design.
const WARMUP_SAMPLES = 0;

type Cached = { value: number; expiresAt: number };

/**
 * Structural subset of PoolWorker — kept narrow so MemoryGate doesn't need
 * to import the PoolWorker type, which keeps unit tests simple.
 */
export interface MemoryReportSource {
  on(event: 'message', listener: (msg: unknown) => void): void;
}

const p90 = (samples: number[]): number => {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.floor(RSS_QUANTILE * sorted.length),
  );
  return sorted[idx]!;
};

/** @internal — test seam for deterministic freemem/meminfo reads. */
export type MemoryGateDeps = {
  freemem?: () => number;
  readMeminfo?: () => string | null;
};

/**
 * Memory-aware spawn gate. `recordDispatch`/`recordResolve` stay no-ops
 * until the slow lane first triggers, so the dispatch hot path is one
 * boolean read when memory is plentiful. Owns its own poll timer so the
 * Pool only sees a single `attachPoll(wake)` / `dispose()` surface.
 */
export class MemoryGate {
  private readonly rssSamples: number[] = [];
  private readonly heapDeltaSamples: number[] = [];
  private readonly freememFn: () => number;
  private readonly readMeminfoFn: () => string | null;
  private heapBeforeDispatch: number | undefined;
  private heapTrackingEnabled = false;
  private freememCache: Cached | undefined;
  private memInfoCache: Cached | undefined;
  /**
   * Cached p90 values for the two sample windows. Invalidated to `undefined`
   * on every `pushSample`. `canSpawnNewWorker` can fire dozens of times per
   * worker turnover while the sample set doesn't move, so this avoids
   * re-sorting a 32-element array per call.
   */
  private rssP90Cache: number | undefined;
  private heapDeltaP90Cache: number | undefined;
  private heapHeadroomCache: Cached | undefined;
  private pollTimer: NodeJS.Timeout | undefined;

  constructor(deps: MemoryGateDeps = {}) {
    this.freememFn = deps.freemem ?? os.freemem;
    this.readMeminfoFn =
      deps.readMeminfo ??
      (() => {
        try {
          return readFileSync('/proc/meminfo', 'utf-8');
        } catch {
          // /proc/meminfo missing (containers, exotic kernels) — fall back.
          return null;
        }
      });
  }

  recordWorkerRss(rss: number): void {
    if (rss <= 0) return;
    this.pushSample(this.rssSamples, rss);
    this.rssP90Cache = undefined;
  }

  recordDispatch(): void {
    if (!this.heapTrackingEnabled) return;
    this.heapBeforeDispatch = process.memoryUsage().heapUsed;
  }

  recordResolve(): void {
    if (!this.heapTrackingEnabled) return;
    if (this.heapBeforeDispatch === undefined) return;
    const delta = Math.max(
      0,
      process.memoryUsage().heapUsed - this.heapBeforeDispatch,
    );
    this.heapBeforeDispatch = undefined;
    this.pushSample(this.heapDeltaSamples, delta);
    this.heapDeltaP90Cache = undefined;
  }

  canSpawnNewWorker(activeCount: number): boolean {
    // Deadlock guard: at least one worker must always be allowed.
    if (activeCount === 0) return true;

    // Cold-start bypass: don't defend until the first sample lands.
    if (this.rssSamples.length <= WARMUP_SAMPLES) return true;

    const estRss = (this.rssP90Cache ??= p90(this.rssSamples));

    // Fast lane uses os.freemem() (= MemFree on Linux). It excludes
    // reclaimable page cache, so it errs pessimistic — at worst we drop
    // into the slow lane earlier than strictly necessary; never a wrong
    // fast-pass.
    const freemem = this.cachedFreemem();
    if (freemem >= estRss * FAST_LANE_FACTOR) return true;

    // Slow lane enables lazy heap tracking — see recordDispatch/recordResolve.
    this.heapTrackingEnabled = true;

    const available = this.accurateAvailableMemory();
    if (available < estRss) {
      this.logDeferred('system memory', { estRss, available });
      return false;
    }

    if (this.heapDeltaSamples.length > 0) {
      const heapHeadroom = this.cachedHeapHeadroom();
      const estHeapDelta = (this.heapDeltaP90Cache ??= p90(
        this.heapDeltaSamples,
      ));
      if (heapHeadroom < estHeapDelta * HEAP_SAFETY_FACTOR) {
        this.logDeferred('main heap', { heapHeadroom, estHeapDelta });
        return false;
      }
    }

    return true;
  }

  /** Subscribes off-band so PoolRunner stays free of gate-specific plumbing. */
  attachWorker(source: MemoryReportSource): void {
    source.on('message', (msg) => {
      if (!isWorkerResponseEnvelope(msg)) return;
      const r = msg.response;
      if (r.type !== 'runFinished' && r.type !== 'collectFinished') return;
      if (r.memory) this.recordWorkerRss(r.memory.rss);
    });
  }

  /**
   * Idempotent. `wake` returns `false` to stop the loop (queue drained /
   * pool closing). `.unref()` so the timer never holds the process open.
   */
  attachPoll(wake: () => boolean): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      if (!wake()) this.dispose();
    }, POLL_INTERVAL_MS);
    this.pollTimer.unref();
  }

  dispose(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private pushSample(arr: number[], value: number): void {
    arr.push(value);
    if (arr.length > WINDOW_SIZE) arr.shift();
  }

  private cachedFreemem(): number {
    const now = Date.now();
    if (this.freememCache && this.freememCache.expiresAt > now) {
      return this.freememCache.value;
    }
    const value = this.freememFn();
    this.freememCache = { value, expiresAt: now + FREEMEM_CACHE_MS };
    return value;
  }

  /**
   * `v8.getHeapStatistics()` allocates a fresh object each call. The poll
   * loop can re-enter the slow lane every 500 ms, so cap re-reads at the
   * meminfo TTL (same clustering rationale).
   */
  private cachedHeapHeadroom(): number {
    const now = Date.now();
    if (this.heapHeadroomCache && this.heapHeadroomCache.expiresAt > now) {
      return this.heapHeadroomCache.value;
    }
    const stats = v8.getHeapStatistics();
    const value = stats.heap_size_limit - stats.used_heap_size;
    this.heapHeadroomCache = { value, expiresAt: now + MEMINFO_CACHE_MS };
    return value;
  }

  /**
   * On Linux, `MemAvailable` from /proc/meminfo accounts for reclaimable
   * page cache, which `os.freemem()` (= MemFree) does not. Slow lane only.
   */
  private accurateAvailableMemory(): number {
    const now = Date.now();
    if (this.memInfoCache && this.memInfoCache.expiresAt > now) {
      return this.memInfoCache.value;
    }
    let value = this.freememFn();
    const meminfo = this.readMeminfoFn();
    if (meminfo) {
      const match = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB/m);
      if (match) value = Number(match[1]) * 1024;
    }
    this.memInfoCache = { value, expiresAt: now + MEMINFO_CACHE_MS };
    return value;
  }

  private logDeferred(reason: string, details: Record<string, number>): void {
    if (!isDebug()) return;
    const parts = Object.entries(details).map(
      ([k, v]) => `${k}=${(v / 1024 / 1024).toFixed(0)}MB`,
    );
    logger.debug(
      `[pool] deferred worker spawn (${reason}): ${parts.join(', ')}`,
    );
  }
}

/** Honors `RSTEST_MEMORY_AWARE=0` (emergency kill switch). */
export const createDefaultMemoryGate = (): MemoryGate | undefined => {
  if (process.env.RSTEST_MEMORY_AWARE === '0') return undefined;
  return new MemoryGate();
};
