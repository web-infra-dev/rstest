export type FakeTimerInstallOpts = Record<string, unknown>;

export type FakeTimerWithContext = {
  timers: Record<string, unknown>;
};

export type InstalledClock = {
  now: number;
  reset: () => void;
  uninstall: () => void;
  runAll: () => void;
  runAllAsync: () => Promise<void>;
  runToLast: () => void;
  runToLastAsync: () => Promise<void>;
  tick: (ms: number) => void;
  tickAsync: (ms: number) => Promise<void>;
  next: () => void;
  nextAsync: () => Promise<void>;
  runToFrame: () => void;
  runMicrotasks: () => void;
  setSystemTime: (now?: number | Date) => void;
  countTimers: () => number;
};

const createClock = (): InstalledClock => {
  const clock: InstalledClock = {
    now: Date.now(),
    reset: () => {
      clock.now = Date.now();
    },
    uninstall: () => {
      /* noop */
    },
    runAll: () => {
      /* noop */
    },
    runAllAsync: async () => {
      /* noop */
    },
    runToLast: () => {
      /* noop */
    },
    runToLastAsync: async () => {
      /* noop */
    },
    tick: (ms: number) => {
      clock.now += ms;
    },
    tickAsync: async (ms: number) => {
      clock.now += ms;
    },
    next: () => {
      /* noop */
    },
    nextAsync: async () => {
      /* noop */
    },
    runToFrame: () => {
      /* noop */
    },
    runMicrotasks: () => {
      /* noop */
    },
    setSystemTime: (value?: number | Date) => {
      if (typeof value === 'number') {
        clock.now = value;
        return;
      }
      if (value instanceof Date) {
        clock.now = value.valueOf();
        return;
      }
      clock.now = Date.now();
    },
    countTimers: () => 0,
  };

  return clock;
};

export const withGlobal = (_global: typeof globalThis) => {
  const clock = createClock();

  return {
    timers: {},
    install: (_config: FakeTimerInstallOpts = {}): InstalledClock => {
      clock.now = Date.now();
      return clock;
    },
  };
};
