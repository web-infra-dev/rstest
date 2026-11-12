import { describe, expect, it } from '@rstest/core';
import type { BrowserLaunchSpec } from '../src/browserRsbuild';
import { createLaunchPool } from '../src/launchPool';
import type { BrowserProviderBrowser } from '../src/providers';

const spec = (key: string, headless = true): BrowserLaunchSpec => ({
  provider: 'playwright',
  browserName: 'chromium',
  headless,
  providerOptions: {},
  key,
});

/**
 * Fake launcher that tracks how many browsers are open: a browser counts from
 * the moment its launch starts until its `close()` has resolved.
 */
const createFakeBrowsers = () => {
  let open = 0;
  let peak = 0;
  const launched: string[] = [];
  const closed: string[] = [];
  const gates: Array<() => void> = [];
  let delayClose = false;
  return {
    launch: async (s: BrowserLaunchSpec): Promise<BrowserProviderBrowser> => {
      open++;
      peak = Math.max(peak, open);
      launched.push(s.key);
      await Promise.resolve();
      return {
        close: async () => {
          if (delayClose) {
            await new Promise<void>((resolve) => gates.push(resolve));
          }
          open--;
          closed.push(s.key);
        },
        newContext: async () => ({}) as never,
      } as unknown as BrowserProviderBrowser;
    },
    get open() {
      return open;
    },
    get peak() {
      return peak;
    },
    launched,
    closed,
    holdCloses: () => {
      delayClose = true;
    },
    releaseCloses: () => {
      delayClose = false;
      for (const gate of gates.splice(0)) {
        gate();
      }
    },
  };
};

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('createLaunchPool', () => {
  it('keeps idle browsers open while the cap allows and reuses them', async () => {
    const fake = createFakeBrowsers();
    const specs = [spec('a'), spec('b')];
    const pool = createLaunchPool({ specs, cap: 2, launch: fake.launch });

    (await pool.acquire('a')).release();
    (await pool.acquire('b')).release();
    (await pool.acquire('a')).release();

    expect(fake.launched).toEqual(['a', 'b']);
    expect(fake.closed).toEqual([]);
    await pool.closeAll();
  });

  it('evicts the least recently used idle browser first', async () => {
    const fake = createFakeBrowsers();
    const specs = [spec('a'), spec('b'), spec('c')];
    const pool = createLaunchPool({ specs, cap: 2, launch: fake.launch });

    (await pool.acquire('a')).release();
    (await pool.acquire('b')).release();
    // `a` is used again, so `b` is now the least recently used.
    (await pool.acquire('a')).release();
    (await pool.acquire('c')).release();

    expect(fake.closed).toEqual(['b']);
    expect(fake.peak).toBe(2);
    await pool.closeAll();
  });

  it('shares one launch between concurrent leases and only evicts at zero refs', async () => {
    const fake = createFakeBrowsers();
    const specs = [spec('a'), spec('b')];
    const pool = createLaunchPool({ specs, cap: 1, launch: fake.launch });

    const [first, second] = await Promise.all([
      pool.acquire('a'),
      pool.acquire('a'),
    ]);
    expect(fake.launched).toEqual(['a']);

    let bLease: Awaited<ReturnType<typeof pool.acquire>> | undefined;
    const pendingB = pool.acquire('b').then((lease) => {
      bLease = lease;
    });
    first.release();
    await tick();
    // One lease on `a` is still held, so `a` must stay open and `b` waits.
    expect(bLease).toBeUndefined();
    expect(fake.closed).toEqual([]);

    second.release();
    await pendingB;
    expect(bLease).toBeDefined();
    expect(fake.closed).toEqual(['a']);
    expect(fake.peak).toBe(1);
    bLease!.release();
    await pool.closeAll();
  });

  it('keeps an evicted browser in the count until it has closed', async () => {
    const fake = createFakeBrowsers();
    const specs = [spec('a'), spec('b')];
    const pool = createLaunchPool({ specs, cap: 1, launch: fake.launch });

    (await pool.acquire('a')).release();
    fake.holdCloses();
    const pendingB = pool.acquire('b');
    await tick();
    // `a` is closing, so `b` must not have launched yet.
    expect(fake.launched).toEqual(['a']);
    expect(fake.open).toBe(1);

    fake.releaseCloses();
    (await pendingB).release();
    expect(fake.launched).toEqual(['a', 'b']);
    expect(fake.peak).toBe(1);
    await pool.closeAll();
  });

  it('frees one slot for concurrent acquirers of the same unopened key', async () => {
    const fake = createFakeBrowsers();
    const specs = [spec('k1'), spec('k2'), spec('k3')];
    const pool = createLaunchPool({ specs, cap: 2, launch: fake.launch });

    (await pool.acquire('k2')).release();
    (await pool.acquire('k3')).release();
    const leases = await Promise.all([pool.acquire('k1'), pool.acquire('k1')]);

    expect(fake.closed).toEqual(['k2']);
    expect(fake.launched).toEqual(['k2', 'k3', 'k1']);
    for (const lease of leases) {
      lease.release();
    }
    await pool.closeAll();
  });

  it('reports whether a launch is open', async () => {
    const fake = createFakeBrowsers();
    const specs = [spec('a'), spec('b')];
    const pool = createLaunchPool({ specs, cap: 1, launch: fake.launch });

    expect(pool.isOpen('a')).toBe(false);
    (await pool.acquire('a')).release();
    expect(pool.isOpen('a')).toBe(true);
    (await pool.acquire('b')).release();
    expect(pool.isOpen('a')).toBe(false);
    expect(pool.isOpen('b')).toBe(true);
    await pool.closeAll();
  });

  it('pins headed launches: never evicted and outside the cap', async () => {
    const fake = createFakeBrowsers();
    const specs = [spec('headed', false), spec('a'), spec('b')];
    const pool = createLaunchPool({ specs, cap: 1, launch: fake.launch });

    // Callers never release a headed lease; that is what protects it.
    await pool.acquire('headed');
    (await pool.acquire('a')).release();
    (await pool.acquire('b')).release();

    // The headed browser stays open next to one headless browser.
    expect(fake.closed).toEqual(['a']);
    expect(fake.open).toBe(2);
    await pool.closeAll();
    expect(fake.open).toBe(0);
  });

  it('rejects every holder of a failed launch and frees its slot', async () => {
    const specs = [spec('bad'), spec('good')];
    const error = new Error('Failed to launch');
    const fake = createFakeBrowsers();
    const pool = createLaunchPool({
      specs,
      cap: 1,
      launch: async (s) => {
        if (s.key === 'bad') {
          throw error;
        }
        return fake.launch(s);
      },
    });

    const results = await Promise.allSettled([
      pool.acquire('bad'),
      pool.acquire('bad'),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      'rejected',
      'rejected',
    ]);
    (await pool.acquire('good')).release();
    expect(fake.launched).toEqual(['good']);
    await pool.closeAll();
  });

  it('closes a launching browser on closeAll and rejects later acquires', async () => {
    const fake = createFakeBrowsers();
    const specs = [spec('a'), spec('b')];
    const pool = createLaunchPool({ specs, cap: 2, launch: fake.launch });

    const pendingA = pool.acquire('a');
    await pool.closeAll();
    await pendingA.catch(() => {});
    expect(fake.open).toBe(0);
    await expect(pool.acquire('b')).rejects.toThrow('closed');
  });
});
