import { promisify } from 'node:util';
import { expect, rstest } from '@rstest/core';

const phaseKey = Symbol.for('rstest.jsdom.timer-phase');
const staleTimerKey = Symbol.for('rstest.jsdom.stale-timer');
const completedTimerKey = Symbol.for('rstest.jsdom.completed-timer');
const userAbortKey = Symbol.for('rstest.jsdom.user-abort');

export const runTimerPhase = async () => {
  const phase = (Reflect.get(process, phaseKey) as number | undefined) ?? 0;

  if (phase === 0) {
    rstest.useFakeTimers({ now: 0 });
    Reflect.set(process, phaseKey, 1);
    return;
  }

  if (phase === 1) {
    rstest.useFakeTimers({ now: 0 });
    rstest.useRealTimers();
    Reflect.set(process, staleTimerKey, false);
    setTimeout(() => Reflect.set(process, staleTimerKey, true), 50);
    const completedTimer = await new Promise<NodeJS.Timeout>((resolve) => {
      const timer = setTimeout(() => resolve(timer), 0);
    });
    Reflect.set(process, completedTimerKey, completedTimer);
    const controller = new AbortController();
    const userReason = new Error('non-isolated user abort');
    const userAbort = promisify(setTimeout)(60_000, undefined, {
      signal: controller.signal,
    }).catch((error) => error);
    controller.abort(userReason);
    Reflect.set(process, userAbortKey, userAbort);
    Reflect.set(process, phaseKey, 2);
    return;
  }

  const completedTimer = Reflect.get(
    process,
    completedTimerKey,
  ) as NodeJS.Timeout;
  completedTimer.refresh();
  expect(completedTimer.hasRef()).toBe(false);
  clearTimeout(completedTimer);

  const userAbort = Reflect.get(process, userAbortKey) as Promise<unknown>;
  await expect(
    Promise.race([
      userAbort,
      new Promise((resolve) => setTimeout(() => resolve('pending'), 100)),
    ]),
  ).resolves.toMatchObject({
    cause: expect.any(Error),
    code: 'ABORT_ERR',
    name: 'AbortError',
  });

  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(Reflect.get(process, staleTimerKey)).toBe(false);
  Reflect.deleteProperty(process, phaseKey);
  Reflect.deleteProperty(process, staleTimerKey);
  Reflect.deleteProperty(process, completedTimerKey);
  Reflect.deleteProperty(process, userAbortKey);
};
