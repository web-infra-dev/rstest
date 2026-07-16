import { expect, rstest } from '@rstest/core';

const phaseKey = Symbol.for('rstest.jsdom.timer-phase');
const staleTimerKey = Symbol.for('rstest.jsdom.stale-timer');

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
    Reflect.set(process, phaseKey, 2);
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(Reflect.get(process, staleTimerKey)).toBe(false);
  Reflect.deleteProperty(process, phaseKey);
  Reflect.deleteProperty(process, staleTimerKey);
};
