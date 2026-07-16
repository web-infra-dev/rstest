import { expect } from '@rstest/core';

const phaseKey = Symbol.for('rstest.dom.stale-timer-phase');
const timerKey = Symbol.for('rstest.dom.stale-timer-wrapper');
const intervalKey = Symbol.for('rstest.dom.stale-interval-wrapper');

export const runStaleTimerPhase = async () => {
  const phase = (Reflect.get(process, phaseKey) as number | undefined) ?? 0;

  if (phase === 0) {
    Reflect.set(process, timerKey, setTimeout);
    Reflect.set(process, intervalKey, setInterval);
    Reflect.set(process, phaseKey, 1);
    return;
  }

  const staleSetTimeout = Reflect.get(process, timerKey) as typeof setTimeout;
  const staleSetInterval = Reflect.get(
    process,
    intervalKey,
  ) as typeof setInterval;
  Reflect.deleteProperty(process, phaseKey);
  Reflect.deleteProperty(process, timerKey);
  Reflect.deleteProperty(process, intervalKey);

  const timeout = staleSetTimeout(() => {}, 60_000);
  const interval = staleSetInterval(() => {}, 60_000);
  expect(timeout.hasRef()).toBe(false);
  expect(interval.hasRef()).toBe(false);
  clearTimeout(timeout);
  clearInterval(interval);

  staleSetTimeout(() => {
    throw new Error('retained stale timer error');
  }, 0);
  await new Promise((resolve) => setTimeout(resolve, 20));
};
