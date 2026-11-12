import type { BrowserLaunchSpec } from './browserRsbuild';
import type { BrowserProviderBrowser } from './providers';

/**
 * Host-side owner of every Playwright browser process of a run.
 *
 * Browsers launch on demand, one per launch key, and never more than `cap`
 * headless ones are open at once (`launching`, `open` and `closing` all count,
 * so the bound holds while an evicted browser is still shutting down). A
 * headed launch is pinned: it is never evicted and does not count toward `cap`,
 * because the user is watching its window.
 *
 * Callers hold a lease for as long as they use the browser. Only a launch with
 * no lease can be evicted, least recently used first, so eviction never kills a
 * running file. Idle launches stay open until a new launch needs the slot (or
 * until `closeAll`), which is what lets a watch session reuse them.
 */
export type LaunchLease = {
  browser: BrowserProviderBrowser;
  /** Idempotent. */
  release: () => void;
};

export type LaunchPoolStats = {
  /** Headless browsers currently counted against `cap`. */
  open: number;
  /** Highest `open` seen so far. */
  peak: number;
  /** Launches started so far (a relaunch after eviction counts again). */
  launched: number;
};

export type LaunchPool = {
  acquire: (key: string) => Promise<LaunchLease>;
  closeAll: () => Promise<void>;
  stats: () => LaunchPoolStats;
};

type Entry = {
  spec: BrowserLaunchSpec;
  state: 'launching' | 'open' | 'closing';
  refs: number;
  /** Order of the last acquire/release; the smallest idle value is evicted. */
  lastUsed: number;
  ready: Promise<BrowserProviderBrowser>;
  /** Settles once `browser.close()` finished; set while `closing`. */
  closed?: Promise<void>;
};

const isPinned = (spec: BrowserLaunchSpec): boolean => !spec.headless;

export const createLaunchPool = ({
  specs,
  cap,
  launch,
  onClosed,
}: {
  specs: readonly BrowserLaunchSpec[];
  /** Maximum number of headless browsers open at once; at least 1. */
  cap: number;
  launch: (spec: BrowserLaunchSpec) => Promise<BrowserProviderBrowser>;
  /** Called after a browser has been closed (eviction or `closeAll`). */
  onClosed?: (spec: BrowserLaunchSpec) => void;
}): LaunchPool => {
  const limit = Math.max(1, Math.floor(cap));
  const specsByKey = new Map(specs.map((spec) => [spec.key, spec]));
  const entries = new Map<string, Entry>();
  let waiters: Array<() => void> = [];
  let tick = 0;
  let peak = 0;
  let launched = 0;
  let disposed = false;

  const counted = (): number => {
    let count = 0;
    for (const entry of entries.values()) {
      if (!isPinned(entry.spec)) {
        count++;
      }
    }
    return count;
  };

  const wake = (): void => {
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) {
      resolve();
    }
  };

  const closeEntry = (entry: Entry): Promise<void> => {
    if (entry.closed) {
      return entry.closed;
    }
    entry.state = 'closing';
    entry.closed = (async () => {
      try {
        const browser = await entry.ready;
        await browser.close();
      } catch {
        // A browser that failed to launch or close has nothing left to release.
      } finally {
        if (entries.get(entry.spec.key) === entry) {
          entries.delete(entry.spec.key);
        }
        onClosed?.(entry.spec);
        wake();
      }
    })();
    return entry.closed;
  };

  const evictIdle = (): boolean => {
    let victim: Entry | undefined;
    for (const entry of entries.values()) {
      if (
        entry.state === 'open' &&
        entry.refs === 0 &&
        !isPinned(entry.spec) &&
        (!victim || entry.lastUsed < victim.lastUsed)
      ) {
        victim = entry;
      }
    }
    if (!victim) {
      return false;
    }
    void closeEntry(victim);
    return true;
  };

  const makeLease = (entry: Entry, browser: BrowserProviderBrowser) => {
    let released = false;
    return {
      browser,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        entry.refs--;
        entry.lastUsed = ++tick;
        wake();
      },
    } satisfies LaunchLease;
  };

  const start = (spec: BrowserLaunchSpec): Promise<LaunchLease> => {
    launched++;
    const entry: Entry = {
      spec,
      state: 'launching',
      refs: 1,
      lastUsed: ++tick,
      ready: launch(spec),
    };
    entries.set(spec.key, entry);
    peak = Math.max(peak, counted());
    return entry.ready.then(
      (browser) => {
        // `closeAll` may already have moved a launching entry to `closing`.
        if (entry.state === 'launching') {
          entry.state = 'open';
        }
        return makeLease(entry, browser);
      },
      (error) => {
        // The failed launch gives its slot back; waiters retry or give up.
        if (entries.get(spec.key) === entry) {
          entries.delete(spec.key);
        }
        wake();
        throw error;
      },
    );
  };

  const acquire = async (key: string): Promise<LaunchLease> => {
    const spec = specsByKey.get(key);
    if (!spec) {
      throw new Error(`No browser launch is planned for key ${key}.`);
    }
    for (;;) {
      if (disposed) {
        throw new Error('The browser launch pool is closed.');
      }
      const existing = entries.get(key);
      if (existing?.state === 'closing') {
        await existing.closed;
        continue;
      }
      if (existing) {
        existing.refs++;
        existing.lastUsed = ++tick;
        // A failed shared launch rejects every holder; its entry is already gone.
        const browser = await existing.ready;
        return makeLease(existing, browser);
      }
      if (isPinned(spec) || counted() < limit) {
        return start(spec);
      }
      if (!evictIdle()) {
        await new Promise<void>((resolve) => waiters.push(resolve));
        continue;
      }
      // The evicted browser keeps its slot until it is closed.
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };

  const closeAll = async (): Promise<void> => {
    disposed = true;
    wake();
    await Promise.allSettled([...entries.values()].map(closeEntry));
  };

  return {
    acquire,
    closeAll,
    stats: () => ({ open: counted(), peak, launched }),
  };
};
