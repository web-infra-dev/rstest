import { logger } from '@rstest/core/internal/browser';
import type { BrowserLaunchSpec } from './browserRsbuild';
import type { BrowserProviderBrowser } from './providers';

export type LaunchLease = {
  browser: BrowserProviderBrowser;
  release: () => void;
};

export type LaunchPool = {
  acquire: (key: string) => Promise<LaunchLease>;
  /** Whether a browser for `key` is launching or open (not closing). */
  isOpen: (key: string) => boolean;
  closeAll: () => Promise<void>;
};

type Entry = {
  spec: BrowserLaunchSpec;
  /** A launching entry always holds the lease of the acquirer that started it. */
  refs: number;
  ready: Promise<BrowserProviderBrowser>;
  /** Set once the entry is closing; settles when `browser.close()` finished. */
  closed?: Promise<void>;
};

const isPinned = (spec: BrowserLaunchSpec): boolean => !spec.headless;

const describe = (spec: BrowserLaunchSpec): string =>
  `${spec.provider}/${spec.browserName}` +
  (spec.headless ? ' (headless)' : ' (headed)');

/**
 * Host-side owner of every Playwright browser process of a run.
 *
 * Browsers launch on demand, one per launch key, and never more than `cap`
 * headless ones are open at once (launching, open and closing all count, so the
 * bound holds while an evicted browser is still shutting down). A headed launch
 * does not count toward `cap`, because the user is watching its window; its
 * lease is never released, which is also what keeps it from being evicted.
 *
 * Callers hold a lease for as long as they use the browser. Only a browser with
 * no lease is evicted, least recently released first, so eviction never kills a
 * running file. Idle browsers stay open until a new launch needs the slot (or
 * until `closeAll`), which is what lets a watch session reuse them.
 */
export const createLaunchPool = ({
  specs,
  cap,
  launch,
}: {
  specs: readonly BrowserLaunchSpec[];
  /** Maximum number of headless browsers open at once. */
  cap: number;
  launch: (spec: BrowserLaunchSpec) => Promise<BrowserProviderBrowser>;
}): LaunchPool => {
  const specsByKey = new Map(specs.map((spec) => [spec.key, spec]));
  // Insertion order is recency order: a released entry is re-inserted last, so
  // the first idle entry is the least recently used.
  const entries = new Map<string, Entry>();
  let waiters: Array<() => void> = [];
  let disposed = false;

  const wake = (): void => {
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) {
      resolve();
    }
  };

  const closeEntry = (entry: Entry): Promise<void> => {
    entry.closed ??= (async () => {
      try {
        await (await entry.ready).close();
      } catch {
        // A browser that failed to launch or close has nothing left to release.
      } finally {
        entries.delete(entry.spec.key);
        logger.debug(`[Browser] closed ${describe(entry.spec)}`);
        wake();
      }
    })();
    return entry.closed;
  };

  const evictIdle = (): void => {
    for (const entry of entries.values()) {
      if (entry.refs === 0 && !entry.closed) {
        void closeEntry(entry);
        return;
      }
    }
  };

  const makeLease = (entry: Entry, browser: BrowserProviderBrowser) => ({
    browser,
    release: () => {
      entry.refs--;
      // A closing entry must not come back into the map.
      if (!entry.closed) {
        entries.delete(entry.spec.key);
        entries.set(entry.spec.key, entry);
      }
      wake();
    },
  });

  const start = async (spec: BrowserLaunchSpec): Promise<LaunchLease> => {
    logger.debug(`[Browser] launching ${describe(spec)}`);
    const entry: Entry = { spec, refs: 1, ready: launch(spec) };
    entries.set(spec.key, entry);
    try {
      return makeLease(entry, await entry.ready);
    } catch (error) {
      // The failed launch gives its slot back; waiters retry or give up.
      entries.delete(spec.key);
      wake();
      throw error;
    }
  };

  const countOpen = (): number => {
    let count = 0;
    for (const entry of entries.values()) {
      if (!isPinned(entry.spec)) {
        count++;
      }
    }
    return count;
  };

  const acquire = async (key: string): Promise<LaunchLease> => {
    const spec = specsByKey.get(key)!;
    for (;;) {
      if (disposed) {
        throw new Error('The browser launch pool is closed.');
      }
      const existing = entries.get(key);
      if (existing?.closed) {
        await existing.closed;
        continue;
      }
      if (existing) {
        existing.refs++;
        // A failed shared launch rejects every holder; its entry is already gone.
        return makeLease(existing, await existing.ready);
      }
      if (isPinned(spec) || countOpen() < cap) {
        return start(spec);
      }
      // Evict only when no browser is already closing: that one frees a slot
      // for the first acquirer, and acquirers of one key then share its launch.
      if (![...entries.values()].some((entry) => entry.closed)) {
        evictIdle();
      }
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };

  return {
    acquire,
    isOpen: (key) => {
      const entry = entries.get(key);
      return entry !== undefined && !entry.closed;
    },
    closeAll: async () => {
      disposed = true;
      wake();
      await Promise.allSettled([...entries.values()].map(closeEntry));
    },
  };
};
