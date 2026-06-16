import {
  createRstestUtilities,
  restoreScopedEntry,
} from '../../../src/runtime/api/utilities';
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

describe('rstest utilities plugin-managed APIs', () => {
  it('throws when module mock APIs are not transformed by the Rstest plugin', async () => {
    const rs = await createRstestUtilities(createWorkerState());

    expect(() => rs.mock('./module')).toThrow(
      'rs.mock() must be called as rstest.mock() or rs.mock() so Rstest can transform it',
    );
    expect(() => rs.doMock('./module')).toThrow(
      'Import aliases are not supported for module mock APIs',
    );
    expect(() => rs.unmock('./module')).toThrow(
      'Import aliases are not supported for module mock APIs',
    );
  });

  it('throws when module loader APIs are not transformed by the Rstest plugin', async () => {
    const rs = await createRstestUtilities(createWorkerState());

    expect(() => rs.importActual('./module')).toThrow(
      'rs.importActual() must be called as rstest.importActual() or rs.importActual() so Rstest can transform it',
    );
    expect(() => rs.requireActual('./module')).toThrow(
      'Import aliases are not supported for module mock APIs',
    );
    expect(() => rs.hoisted(() => ({}))).toThrow(
      'Import aliases are not supported for module mock APIs',
    );
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

  it('preserves pending timers after nested fake timer scoped disposal', async () => {
    const rs = await createRstestUtilities(createWorkerState());

    rs.useFakeTimers({ now: 100 });
    const callback = rs.fn();

    globalThis.setTimeout(callback, 50);

    expect(rs.getTimerCount()).toBe(1);

    const disposable = rs.useFakeTimers({ now: 200 });
    disposable[Symbol.dispose]();

    expect(rs.getTimerCount()).toBe(1);

    rs.advanceTimersByTime(50);

    expect(callback).toHaveBeenCalledTimes(1);

    rs.useRealTimers();
  });
});

describe('restoreScopedEntry', () => {
  it('runs onTail and onEmpty when the newest (tail) entry is restored', () => {
    const stack = [{ value: 1 }];
    const entry = stack[0]!;
    const events: string[] = [];

    restoreScopedEntry(stack, entry, {
      onSupersede: () => events.push('supersede'),
      onTail: () => events.push('tail'),
      onEmpty: () => events.push('empty'),
    });

    expect(events).toEqual(['tail', 'empty']);
    expect(stack).toHaveLength(0);
  });

  it('forwards the saved payload onto the next entry without touching the live binding', () => {
    const first = { value: 'first' };
    const second = { value: 'second' };
    const stack = [first, second];
    const events: string[] = [];

    // Disposing the shadowed (non-tail) entry: its payload supersedes the next
    // entry and it is spliced out; no tail/empty restore runs.
    restoreScopedEntry(stack, first, {
      onSupersede: (later) => {
        events.push('supersede');
        later.value = first.value;
      },
      onTail: () => events.push('tail'),
      onEmpty: () => events.push('empty'),
    });

    expect(events).toEqual(['supersede']);
    expect(stack).toEqual([{ value: 'first' }]);
    expect(stack[0]).toBe(second);
  });

  it('does not run onEmpty while older entries remain after the tail pop', () => {
    const older = { value: 'older' };
    const newest = { value: 'newest' };
    const stack = [older, newest];
    const events: string[] = [];

    restoreScopedEntry(stack, newest, {
      onSupersede: () => events.push('supersede'),
      onTail: () => events.push('tail'),
      onEmpty: () => events.push('empty'),
    });

    expect(events).toEqual(['tail']);
    expect(stack).toEqual([older]);
  });

  it('is a no-op when the stack is missing or the entry was already removed', () => {
    const events: string[] = [];
    const handlers = {
      onSupersede: () => events.push('supersede'),
      onTail: () => events.push('tail'),
      onEmpty: () => events.push('empty'),
    };

    restoreScopedEntry(undefined, { value: 1 }, handlers);
    restoreScopedEntry([{ value: 1 }], { value: 2 }, handlers);

    expect(events).toEqual([]);
  });
});
