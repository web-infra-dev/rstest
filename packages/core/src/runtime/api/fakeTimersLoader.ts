import type { FakeTimers } from './fakeTimers';

let cachedFakeTimersClass: typeof FakeTimers | undefined;

/**
 * The compat path (browser runtime and `src/` unit tests): the timer API is
 * synchronous, so the class must be resolved before the first call and is
 * imported as its own lazy chunk here.
 */
export const prepareFakeTimers = async (): Promise<void> => {
  cachedFakeTimersClass ??= (
    await import(/* webpackChunkName: "fake-timers" */ './fakeTimers')
  ).FakeTimers;
};

export const getFakeTimersClass = (): typeof FakeTimers => {
  if (!cachedFakeTimersClass) {
    throw new Error('Fake timers were not prepared.');
  }
  return cachedFakeTimersClass;
};
