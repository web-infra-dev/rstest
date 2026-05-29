import { createRstestUtilities } from '../../../src/runtime/api/utilities';
import { setRealTimers } from '../../../src/runtime/util';
import type { WorkerState } from '../../../src/types';

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function createWorkerState(): WorkerState {
  return {
    runtimeConfig: {
      testTimeout: 1_000,
      hookTimeout: 1_000,
      clearMocks: false,
      resetMocks: false,
      restoreMocks: false,
      maxConcurrency: 5,
      retry: 0,
    },
  } as WorkerState;
}

describe('rstest utilities wait APIs', () => {
  beforeEach(() => {
    setRealTimers();
  });

  it('waitFor retries until callback stops throwing', async () => {
    const rs = await createRstestUtilities(createWorkerState());

    let attempts = 0;
    const result = await rs.waitFor(
      () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error(`attempt ${attempts}`);
        }
        return 'ok';
      },
      { timeout: 200, interval: 5 },
    );

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('waitFor throws the latest callback error after timeout', async () => {
    const rs = await createRstestUtilities(createWorkerState());

    let attempts = 0;
    await rs
      .waitFor(
        () => {
          attempts += 1;
          throw new Error(`attempt ${attempts}`);
        },
        { timeout: 30, interval: 5 },
      )
      .then(() => {
        throw new Error('expected waitFor to throw');
      })
      .catch((error) => {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(`attempt ${attempts}`);
      });

    expect(attempts).toBeGreaterThan(1);
  });

  it('waitFor rejects when callback succeeds after timeout', async () => {
    const rs = await createRstestUtilities(createWorkerState());

    await expect(
      rs.waitFor(async () => {
        await sleep(30);
        return 'late-success';
      }, 10),
    ).rejects.toThrow('waitFor timed out in 10ms');
  });

  it('waitUntil retries until callback returns a truthy value', async () => {
    const rs = await createRstestUtilities(createWorkerState());

    let attempts = 0;
    const result = await rs.waitUntil(
      () => {
        attempts += 1;
        return attempts >= 3 ? 'ready' : '';
      },
      { timeout: 200, interval: 5 },
    );

    expect(result).toBe('ready');
    expect(attempts).toBe(3);
  });

  it('waitUntil throws on timeout and accepts number options', async () => {
    const rs = await createRstestUtilities(createWorkerState());

    await expect(rs.waitUntil(() => false, 20)).rejects.toThrow(
      'waitUntil timed out in 20ms',
    );
  });

  it('waitUntil rejects truthy values returned after timeout', async () => {
    const rs = await createRstestUtilities(createWorkerState());

    await expect(
      rs.waitUntil(async () => {
        await sleep(30);
        return 'late-ready';
      }, 10),
    ).rejects.toThrow('waitUntil timed out in 10ms');
  });

  it('wait APIs still work when fake timers are enabled', async () => {
    const rs = await createRstestUtilities(createWorkerState());

    rs.useFakeTimers();

    let attempts = 0;
    const result = await rs.waitUntil(
      () => {
        attempts += 1;
        return attempts > 2 ? 'done' : undefined;
      },
      { timeout: 200, interval: 5 },
    );

    expect(result).toBe('done');
    expect(attempts).toBe(3);

    rs.useRealTimers();
  });
});

describe('rstest utility scoped cleanup', () => {
  const envName = 'RSTEST_SCOPED_ENV';

  beforeEach(() => {
    delete process.env[envName];
    Reflect.deleteProperty(globalThis, envName);
    setRealTimers();
  });

  afterEach(() => {
    delete process.env[envName];
    Reflect.deleteProperty(globalThis, envName);
    setRealTimers();
  });

  it('tracks chained scoped utility disposals', async () => {
    const rs = await createRstestUtilities(createWorkerState());

    const disposable = rs.stubEnv(envName, 'first').stubEnv(envName, 'second');

    expect(process.env[envName]).toBe('second');

    disposable[Symbol.dispose]();

    expect(process.env[envName]).toBeUndefined();
  });

  it('ignores stale scoped env disposables after unstubAllEnvs', async () => {
    const rs = await createRstestUtilities(createWorkerState());

    const disposable = rs.stubEnv(envName, 'scoped');
    rs.unstubAllEnvs();
    rs.stubEnv(envName, 'new');

    disposable[Symbol.dispose]();

    expect(process.env[envName]).toBe('new');

    rs.unstubAllEnvs();
  });

  it('ignores stale scoped global disposables after unstubAllGlobals', async () => {
    const rs = await createRstestUtilities(createWorkerState());

    const disposable = rs.stubGlobal(envName, 'scoped');
    rs.unstubAllGlobals();
    rs.stubGlobal(envName, 'new');

    disposable[Symbol.dispose]();

    expect(Reflect.get(globalThis, envName)).toBe('new');

    rs.unstubAllGlobals();
  });

  it('restores previous fake timer state on scoped disposal', async () => {
    const rs = await createRstestUtilities(createWorkerState());

    rs.useFakeTimers({ now: 100 });
    const disposable = rs.useFakeTimers({ now: 200 });

    expect(Date.now()).toBe(200);

    disposable[Symbol.dispose]();

    expect(rs.isFakeTimers()).toBe(true);
    expect(Date.now()).toBe(100);

    rs.useRealTimers();
  });
});
