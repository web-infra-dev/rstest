import { expect, rstest } from '@rstest/core';

const phaseKey = Symbol.for('rstest.jsdom.timer-phase');
const staleTimerKey = Symbol.for('rstest.jsdom.stale-timer');
const completedTimerKey = Symbol.for('rstest.jsdom.completed-timer');
const staleWrapperKey = Symbol.for('rstest.jsdom.stale-timer-wrapper');

export const runTimerPhase = async () => {
  const phase = (Reflect.get(process, phaseKey) as number | undefined) ?? 0;
  const reportsStaleError = process.env.RSTEST_STALE_TIMER_ERROR === '1';

  if (phase === 0) {
    if (reportsStaleError) {
      Reflect.set(process, staleWrapperKey, setTimeout);
      Reflect.set(process, phaseKey, 1);
      return;
    }
    rstest.useFakeTimers({ now: 0 });
    Reflect.set(process, phaseKey, 1);
    return;
  }

  if (phase === 1) {
    if (reportsStaleError) {
      const staleSetTimeout = Reflect.get(
        process,
        staleWrapperKey,
      ) as typeof setTimeout;
      Reflect.deleteProperty(process, phaseKey);
      Reflect.deleteProperty(process, staleWrapperKey);

      const timeout = staleSetTimeout(() => {}, 60_000);
      expect(timeout.hasRef()).toBe(false);
      clearTimeout(timeout);
      staleSetTimeout(() => {
        throw new Error('retained stale timer error');
      }, 0);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return;
    }

    rstest.useFakeTimers({ now: 0 });
    rstest.useRealTimers();
    Reflect.set(process, staleTimerKey, false);
    setTimeout(() => Reflect.set(process, staleTimerKey, true), 50);
    const completedTimer = await new Promise<NodeJS.Timeout>((resolve) => {
      const timer = setTimeout(() => resolve(timer), 0);
    });
    Reflect.set(process, completedTimerKey, completedTimer);
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

  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(Reflect.get(process, staleTimerKey)).toBe(false);
  Reflect.deleteProperty(process, phaseKey);
  Reflect.deleteProperty(process, staleTimerKey);
  Reflect.deleteProperty(process, completedTimerKey);
};
