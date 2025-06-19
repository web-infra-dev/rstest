import type { RstestUtilities } from '../../types';
import { type FakeTimerInstallOpts, FakeTimers } from './fakeTimers';
import { fn, isMockFunction, mocks, spyOn } from './spy';

export const createRstestUtilities: () => RstestUtilities = () => {
  const originalEnvValues = new Map<string, string | undefined>();
  const originalGlobalValues = new Map<
    string | symbol | number,
    PropertyDescriptor | undefined
  >();

  let _timers: FakeTimers;

  const timers = () => {
    if (!_timers) {
      _timers = new FakeTimers({
        global: globalThis,
      });
    }
    return _timers;
  };

  const rstest: RstestUtilities = {
    fn,
    spyOn,
    isMockFunction,
    clearAllMocks: () => {
      for (const mock of mocks) {
        mock.mockClear();
      }
      return rstest;
    },
    resetAllMocks: () => {
      for (const mock of mocks) {
        mock.mockReset();
      }
      return rstest;
    },
    restoreAllMocks: () => {
      for (const mock of mocks) {
        mock.mockRestore();
      }
      return rstest;
    },
    mock: () => {
      // TODO
    },
    doMock: () => {
      // TODO
    },
    unMock: () => {
      // TODO
    },
    doUnMock: () => {
      // TODO
    },
    importMock: async () => {
      return {} as any;
    },
    importActual: async () => {
      // The real implementation is handled by Rstest built-in plugin.
      return {} as any;
    },
    requireActual: () => {
      // The real implementation is handled by Rstest built-in plugin.
      return {} as any;
    },
    resetModules: () => {
      // TODO
      return rstest;
    },

    stubEnv: (name: string, value: string | undefined): RstestUtilities => {
      if (!originalEnvValues.has(name)) {
        originalEnvValues.set(name, process.env[name]);
      }

      // update process.env
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }

      return rstest;
    },
    unstubAllEnvs: (): RstestUtilities => {
      // restore process.env
      for (const [name, value] of originalEnvValues) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }

      originalEnvValues.clear();

      return rstest;
    },
    stubGlobal: (name: string | symbol | number, value: any) => {
      if (!originalGlobalValues.has(name)) {
        originalGlobalValues.set(
          name,
          Object.getOwnPropertyDescriptor(globalThis, name),
        );
      }
      Object.defineProperty(globalThis, name, {
        value,
        writable: true,
        configurable: true,
        enumerable: true,
      });
      return rstest;
    },
    unstubAllGlobals: () => {
      originalGlobalValues.forEach((original, name) => {
        if (!original) {
          Reflect.deleteProperty(globalThis, name);
        } else {
          Object.defineProperty(globalThis, name, original);
        }
      });
      originalGlobalValues.clear();
      return rstest;
    },
    useFakeTimers: (opts?: FakeTimerInstallOpts) => {
      timers().useFakeTimers(opts);
      return rstest;
    },
    useRealTimers: () => {
      timers().useRealTimers();
      return rstest;
    },
    setSystemTime: (now?: number | Date) => {
      timers().setSystemTime(now);
      return rstest;
    },
    getRealSystemTime: () => {
      return _timers ? timers().getRealSystemTime() : Date.now();
    },
    isFakeTimers: () => {
      return _timers ? timers().isFakeTimers() : false;
    },
    runAllTimers: () => {
      timers().runAllTimers();
      return rstest;
    },
    runAllTimersAsync: async () => {
      await timers().runAllTimersAsync();
      return rstest;
    },
    runAllTicks: () => {
      timers().runAllTicks();
      return rstest;
    },
    runOnlyPendingTimers: () => {
      timers().runOnlyPendingTimers();
      return rstest;
    },
    runOnlyPendingTimersAsync: async () => {
      await timers().runOnlyPendingTimersAsync();
      return rstest;
    },
    advanceTimersByTime: (ms: number) => {
      timers().advanceTimersByTime(ms);
      return rstest;
    },
    advanceTimersByTimeAsync: async (ms: number) => {
      await timers().advanceTimersByTimeAsync(ms);
      return rstest;
    },
    advanceTimersToNextTimer: (steps?: number) => {
      timers().advanceTimersToNextTimer(steps);
      return rstest;
    },
    advanceTimersToNextTimerAsync: async (steps?: number) => {
      await timers().advanceTimersToNextTimerAsync(steps);
      return rstest;
    },
    advanceTimersToNextFrame: () => {
      timers().advanceTimersToNextFrame();
      return rstest;
    },
    getTimerCount: () => {
      return timers().getTimerCount();
    },
    clearAllTimers: () => {
      timers().clearAllTimers();
      return rstest;
    },
  };

  return rstest;
};
