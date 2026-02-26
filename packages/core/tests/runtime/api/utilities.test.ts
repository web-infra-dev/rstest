import { createRstestUtilities } from '../../../src/runtime/api/utilities';
import { setRealTimers } from '../../../src/runtime/util';
import type { WorkerState } from '../../../src/types';

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
