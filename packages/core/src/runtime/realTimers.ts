/**
 * Captured native timers, kept in a module with no other dependencies so the
 * worker boot path can read them without pulling `./util` (and its formatting
 * dependencies) into the initial module graph. `./util` re-exports these for
 * consumers outside that path.
 */
const REAL_TIMERS: {
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
  setImmediate?: typeof globalThis.setImmediate;
} = {};

// store the original timers
export const setRealTimers = (): void => {
  REAL_TIMERS.setTimeout ??= globalThis.setTimeout.bind(globalThis);
  REAL_TIMERS.clearTimeout ??= globalThis.clearTimeout.bind(globalThis);
  if (typeof globalThis.setImmediate === 'function') {
    REAL_TIMERS.setImmediate ??= globalThis.setImmediate.bind(globalThis);
  }
};

export const getRealTimers = (): typeof REAL_TIMERS => {
  return REAL_TIMERS;
};

/**
 * Stable reference to `Date.now`, captured before `@sinonjs/fake-timers`
 * can hijack the global. Phase boundaries straddling `tests` rely on this.
 */
const realNow = Date.now.bind(Date);

export const getRealNow = (): number => realNow();
