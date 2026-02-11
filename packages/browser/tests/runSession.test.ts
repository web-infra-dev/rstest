import { describe, expect, it } from '@rstest/core';
import { createRunSession, RunSessionLifecycle } from '../src/runSession';

type TestRunSession = ReturnType<typeof createRunSession> & {
  done?: Promise<void>;
};

describe('run session lifecycle', () => {
  it('should create active session with incrementing token', () => {
    const lifecycle = new RunSessionLifecycle<TestRunSession>();

    const first = lifecycle.createSession((token) => createRunSession(token));
    const second = lifecycle.createSession((token) => createRunSession(token));

    expect(first.token).toBe(1);
    expect(second.token).toBe(2);
    expect(lifecycle.activeToken).toBe(2);
  });

  it('should invalidate token and mark old token as stale', () => {
    const lifecycle = new RunSessionLifecycle<TestRunSession>();
    const session = lifecycle.createSession((token) => createRunSession(token));

    lifecycle.invalidateActiveToken();

    expect(lifecycle.isTokenStale(session.token)).toBe(true);
  });

  it('should cancel session and resolve cancel signal', async () => {
    const lifecycle = new RunSessionLifecycle<TestRunSession>();
    const session = lifecycle.createSession((token) => createRunSession(token));

    let cancelled = false;
    session.cancelSignal.then(() => {
      cancelled = true;
    });

    await lifecycle.cancel(session);

    expect(session.cancelled).toBe(true);
    expect(cancelled).toBe(true);
  });

  it('should wait for done when cancelling', async () => {
    const lifecycle = new RunSessionLifecycle<TestRunSession>();
    const session = lifecycle.createSession((token) => createRunSession(token));

    let resolveDone: () => void = () => {};
    session.done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    let completed = false;
    const cancelPromise = lifecycle.cancel(session).then(() => {
      completed = true;
    });

    expect(completed).toBe(false);
    resolveDone();
    await cancelPromise;
    expect(completed).toBe(true);
  });
});
