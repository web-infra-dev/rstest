const phaseKey = Symbol.for('rstest.dom.stale-timer-phase');
const timerKey = Symbol.for('rstest.dom.stale-timer-wrapper');

export const runStaleTimerPhase = async () => {
  const phase = (Reflect.get(process, phaseKey) as number | undefined) ?? 0;

  if (phase === 0) {
    Reflect.set(process, timerKey, setTimeout);
    Reflect.set(process, phaseKey, 1);
    return;
  }

  const staleSetTimeout = Reflect.get(process, timerKey) as typeof setTimeout;
  Reflect.deleteProperty(process, phaseKey);
  Reflect.deleteProperty(process, timerKey);
  staleSetTimeout(() => {
    throw new Error('retained stale timer error');
  }, 0);
  await new Promise((resolve) => setTimeout(resolve, 20));
};
