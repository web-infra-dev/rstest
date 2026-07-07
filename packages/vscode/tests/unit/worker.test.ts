import { describe, expect, it, rs } from '@rstest/core';
import { Worker } from '../../src/worker';

// The worker module pulls in `vscode` transitively (type-only in the runtime
// path, but mock it defensively so the unit harness never resolves the real
// editor module).
rs.mock('vscode', () => ({}));

type WithWatcher = { watcher?: { close: () => Promise<void> } };

describe('Worker.closeWatch', () => {
  it('closes an active watch session exactly once, then clears it', async () => {
    const close = rs.fn(async () => {});
    const worker = new Worker();
    (worker as unknown as WithWatcher).watcher = { close };

    await worker.closeWatch();
    // Second call is idempotent — the watcher was already released.
    await worker.closeWatch();

    expect(close).toHaveBeenCalledTimes(1);
    expect((worker as unknown as WithWatcher).watcher).toBeUndefined();
  });

  it('is a no-op when there is no active watch session', async () => {
    const worker = new Worker();
    await expect(worker.closeWatch()).resolves.toBeUndefined();
  });
});

type WithInternals = {
  createInstance: (options: unknown) => Promise<unknown>;
  init: (options: unknown) => Promise<unknown>;
};

describe('Worker instance cache', () => {
  const base = {
    configFilePath: '/project/rstest.config.ts',
    rstestPath: '/project/node_modules/@rstest/core',
  };

  it('reuses one instance across RPCs with the same init-identity', async () => {
    const worker = new Worker();
    let created = 0;
    (worker as unknown as WithInternals).createInstance = async () => {
      created += 1;
      return {};
    };
    const init = (worker as unknown as WithInternals).init.bind(worker);

    // fileFilters / command don't change identity, so both reuse one instance.
    await init({ ...base, command: 'run', fileFilters: ['a'] });
    await init({ ...base, command: 'list', fileFilters: ['b'] });
    expect(created).toBe(1);

    // A different override config is a different identity → a new instance.
    await init({ ...base, command: 'run', coverage: { enabled: true } });
    expect(created).toBe(2);
  });

  it('does not cache a failed creation, so the next RPC retries', async () => {
    const worker = new Worker();
    let attempts = 0;
    (worker as unknown as WithInternals).createInstance = async () => {
      attempts += 1;
      throw new Error('boom');
    };
    const init = (worker as unknown as WithInternals).init.bind(worker);

    await expect(init({ ...base, command: 'run' })).rejects.toThrow('boom');
    await expect(init({ ...base, command: 'run' })).rejects.toThrow('boom');
    expect(attempts).toBe(2);
  });
});
