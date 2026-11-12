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
        [Symbol.asyncDispose]: async () => {},
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
  it('never opens more headless browsers than the cap, one launch per visit', async () => {
    const fake = createFakeBrowsers();
    const specs = [spec('a'), spec('b'), spec('c')];
    const pool = createLaunchPool({ specs, cap: 1, launch: fake.launch });

    for (const { key } of specs) {
      const lease = await pool.acquire(key);
      expect(fake.open).toBe(1);
      lease.release();
    }
    expect(fake.peak).toBe(1);
    expect(fake.launched).toEqual(['a', 'b', 'c']);
    expect(pool.stats()).toEqual({ open: 1, peak: 1, launched: 3 });

    await pool.closeAll();
    expect(fake.open).toBe(0);
    expect(fake.closed.sort()).toEqual(['a', 'b', 'c']);
  });

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

  it('wakes queued acquirers in FIFO order', async () => {
    const fake = createFakeBrowsers();
    const specs = [spec('a'), spec('b'), spec('c')];
    const pool = createLaunchPool({ specs, cap: 1, launch: fake.launch });

    const holder = await pool.acquire('a');
    const order: string[] = [];
    const take = async (key: string) => {
      const lease = await pool.acquire(key);
      order.push(key);
      lease.release();
    };
    const queued = Promise.all([take('b'), take('c')]);
    await tick();
    holder.release();
    await queued;

    expect(order).toEqual(['b', 'c']);
    expect(fake.peak).toBe(1);
    await pool.closeAll();
  });

  it('pins headed launches: never evicted and outside the cap', async () => {
    const fake = createFakeBrowsers();
    const specs = [spec('headed', false), spec('a'), spec('b')];
    const pool = createLaunchPool({ specs, cap: 1, launch: fake.launch });

    const headed = await pool.acquire('headed');
    headed.release();
    (await pool.acquire('a')).release();
    (await pool.acquire('b')).release();

    // The headed browser stays open next to one headless browser.
    expect(fake.closed).toEqual(['a']);
    expect(fake.open).toBe(2);
    expect(pool.stats().open).toBe(1);
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
    expect(pool.stats().open).toBe(0);
    (await pool.acquire('good')).release();
    expect(fake.launched).toEqual(['good']);
    await pool.closeAll();
  });

  it('treats release as idempotent', async () => {
    const fake = createFakeBrowsers();
    const specs = [spec('a'), spec('b')];
    const pool = createLaunchPool({ specs, cap: 1, launch: fake.launch });

    const lease = await pool.acquire('a');
    const other = await pool.acquire('a');
    lease.release();
    lease.release();
    // The second lease still holds `a`, so `b` cannot evict it.
    let bDone = false;
    const pendingB = pool.acquire('b').then((value) => {
      bDone = true;
      return value;
    });
    await tick();
    expect(bDone).toBe(false);
    other.release();
    (await pendingB).release();
    await pool.closeAll();
  });

  it('closes launching and closing browsers on closeAll and rejects later acquires', async () => {
    const fake = createFakeBrowsers();
    const specs = [spec('a'), spec('b')];
    const pool = createLaunchPool({ specs, cap: 2, launch: fake.launch });

    const pendingA = pool.acquire('a');
    await pool.closeAll();
    await pendingA.catch(() => {});
    expect(fake.open).toBe(0);
    await expect(pool.acquire('b')).rejects.toThrow('closed');
  });

  it('rejects a key that is not in the launch plan', async () => {
    const pool = createLaunchPool({
      specs: [],
      cap: 1,
      launch: createFakeBrowsers().launch,
    });
    await expect(pool.acquire('missing')).rejects.toThrow('missing');
  });
});
