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

describe('fake timers API', () => {
  beforeEach(() => {
    setRealTimers();
  });

  it('useFakeTimers not throws when specifies `toNotFake`', async () => {
    const rs = await createRstestUtilities(createWorkerState());

    expect(() =>
      rs.useFakeTimers({ toNotFake: ['setImmediate'] }),
    ).not.toThrow();

    rs.useRealTimers();
  });

  it('useFakeTimers filters out timers in toNotFake', async () => {
    const rs = await createRstestUtilities(createWorkerState());

    rs.useFakeTimers({ toNotFake: ['setTimeout'] });

    let fired = false;
    setTimeout(() => {
      fired = true;
    }, 5);

    rs.advanceTimersByTime(10); // proves that setTimeout is not mocked
    expect(fired).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fired).toBe(true);

    rs.useRealTimers();
  });
});
