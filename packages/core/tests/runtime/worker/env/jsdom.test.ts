import { setTimeout as nodeSetTimeout } from 'node:timers';
import { promisify } from 'node:util';
import { describe, expect, it } from '@rstest/core';
import type { DOMWindow } from 'jsdom';
import { environment } from '../../../../src/runtime/worker/env/jsdom';
import { installTimerTracking } from '../../../../src/runtime/worker/env/utils';

const createTestGlobal = (): typeof globalThis =>
  ({
    AbortController: globalThis.AbortController,
    clearInterval: globalThis.clearInterval,
    clearTimeout: globalThis.clearTimeout,
    console: globalThis.console,
    fetch: globalThis.fetch,
    setInterval: globalThis.setInterval,
    setTimeout: globalThis.setTimeout,
  }) as unknown as typeof globalThis;

const getNodeTimers = (testGlobal: typeof globalThis) => ({
  AbortController: testGlobal.AbortController,
  clearInterval: testGlobal.clearInterval,
  clearTimeout: testGlobal.clearTimeout,
  setInterval: testGlobal.setInterval,
  setTimeout: testGlobal.setTimeout,
});

describe('jsdom environment', () => {
  it('tracks Node timers and clears them during teardown', async () => {
    const testGlobal = createTestGlobal();
    const nativeClearInterval = testGlobal.clearInterval;
    testGlobal.clearInterval = rs.fn((timer) => nativeClearInterval(timer));
    const nodeTimers = {
      clearInterval: testGlobal.clearInterval,
      clearTimeout: testGlobal.clearTimeout,
      setInterval: testGlobal.setInterval,
      setTimeout: testGlobal.setTimeout,
    };
    const nodeFetch = testGlobal.fetch;
    const { teardown } = await environment.setup(testGlobal, {});
    let tornDown = false;

    try {
      expect(testGlobal.setTimeout).toBe(testGlobal.window.setTimeout);
      expect(testGlobal.setTimeout).not.toBe(nodeTimers.setTimeout);
      expect(testGlobal.setInterval).not.toBe(nodeTimers.setInterval);
      expect(testGlobal.fetch).toBe(nodeFetch);

      const timeout = testGlobal.setTimeout(() => {}, 1_000);
      expect(typeof timeout).toBe('object');
      expect(timeout.unref).toBeTypeOf('function');
      testGlobal.clearTimeout(timeout);

      let intervalCalls = 0;
      const interval = testGlobal.setInterval(() => {
        intervalCalls++;
      }, 1);
      expect(typeof interval).toBe('object');

      tornDown = true;
      await teardown();
      expect(nodeTimers.clearInterval).toHaveBeenCalledWith(interval);
      await new Promise((resolve) => nodeSetTimeout(resolve, 20));

      expect(intervalCalls).toBe(0);
      expect(testGlobal.setTimeout).toBe(nodeTimers.setTimeout);
      expect(testGlobal.clearTimeout).toBe(nodeTimers.clearTimeout);
      expect(testGlobal.setInterval).toBe(nodeTimers.setInterval);
      expect(testGlobal.clearInterval).toBe(nodeTimers.clearInterval);
      expect(testGlobal.fetch).toBe(nodeFetch);
    } finally {
      if (!tornDown) {
        await teardown();
      }
    }
  });

  it('keeps native jsdom timer realm and close semantics', async () => {
    const testGlobal = createTestGlobal();
    let retainedWindow: DOMWindow | undefined;
    let beforeParseTimerType: string | undefined;
    let beforeParsePendingTimer: number | undefined;
    let beforeParseTimerFired = false;
    const { teardown } = await environment.setup(testGlobal, {
      html: `<!DOCTYPE html><body><script>
        var timerToken = 'ok';
        setTimeout(function () {
          document.body.dataset.timerThis = String(this === window);
        }, 0);
        setTimeout("document.body.dataset.timerToken = timerToken", 0);
      </script></body>`,
      beforeParse(window) {
        retainedWindow = window;
        const timer = window.setTimeout(() => {}, 0);
        beforeParseTimerType = typeof timer;
        window.clearTimeout(timer);
        beforeParsePendingTimer = window.setTimeout(() => {
          beforeParseTimerFired = true;
        }, 100);
      },
    });
    let tornDown = false;

    try {
      await new Promise((resolve) => nodeSetTimeout(resolve, 20));
      expect(beforeParseTimerType).toBe('number');
      expect(testGlobal.document.body.dataset.timerThis).toBe('true');
      expect(testGlobal.document.body.dataset.timerToken).toBe('ok');

      testGlobal.clearTimeout(beforeParsePendingTimer);
      await new Promise((resolve) => nodeSetTimeout(resolve, 120));
      expect(beforeParseTimerFired).toBe(false);

      tornDown = true;
      await teardown();
      if (!retainedWindow) {
        throw new Error('Expected beforeParse to receive the jsdom window');
      }

      let called = false;
      const timer = retainedWindow.setTimeout(() => {
        called = true;
      }, 0);
      await new Promise((resolve) => nodeSetTimeout(resolve, 20));

      expect(timer).toBe(0);
      expect(called).toBe(false);
    } finally {
      if (!tornDown) {
        await teardown();
      }
    }
  });

  it('reports observed timer errors unless they are prevented', async () => {
    const testGlobal = createTestGlobal();
    const { teardown } = await environment.setup(testGlobal, {});
    const uncaughtErrors: unknown[] = [];
    const emitSpy = rs
      .spyOn(process, 'emit')
      .mockImplementation((event: string | symbol, ...args: unknown[]) => {
        if (event === 'uncaughtException') {
          uncaughtErrors.push(args[0]);
        }
        return true;
      });

    try {
      const observedError = new Promise<unknown>((resolve) => {
        testGlobal.addEventListener('error', (event) => resolve(event.error), {
          once: true,
        });
      });
      testGlobal.setTimeout(() => {
        throw undefined;
      }, 0);

      const normalizedError = await observedError;
      await Promise.resolve();
      expect(normalizedError).toBeInstanceOf(Error);
      expect((normalizedError as Error).message).toBe(
        'Timer callback threw undefined',
      );
      expect(uncaughtErrors).toEqual([normalizedError]);

      testGlobal.addEventListener('error', (event) => event.preventDefault(), {
        once: true,
      });
      testGlobal.setTimeout(() => {
        throw new Error('handled timer error');
      }, 0);
      await new Promise((resolve) => nodeSetTimeout(resolve, 20));
      expect(uncaughtErrors).toHaveLength(1);
    } finally {
      emitSpy.mockRestore();
      await teardown();
    }
  });

  it('reports timer errors when DOM propagation is stopped', async () => {
    const testGlobal = createTestGlobal();
    const { teardown } = await environment.setup(testGlobal, {});
    const expected = new Error('stopped timer error');
    const uncaughtErrors: unknown[] = [];
    const emitSpy = rs
      .spyOn(process, 'emit')
      .mockImplementation((event: string | symbol, ...args: unknown[]) => {
        if (event === 'uncaughtException') {
          uncaughtErrors.push(args[0]);
        }
        return true;
      });

    try {
      testGlobal.addEventListener(
        'error',
        (event) => event.stopImmediatePropagation(),
        { capture: true, once: true },
      );
      testGlobal.setTimeout(() => {
        throw expected;
      }, 0);
      await new Promise((resolve) => nodeSetTimeout(resolve, 20));

      expect(uncaughtErrors).toEqual([expected]);
    } finally {
      emitSpy.mockRestore();
      await teardown();
    }
  });

  it('snapshots timer error cancellation after DOM dispatch', async () => {
    const testGlobal = createTestGlobal();
    const { teardown } = await environment.setup(testGlobal, {});
    const expected = new Error('late timer cancellation');
    const uncaughtErrors: unknown[] = [];
    const emitSpy = rs
      .spyOn(process, 'emit')
      .mockImplementation((event: string | symbol, ...args: unknown[]) => {
        if (event === 'uncaughtException') {
          uncaughtErrors.push(args[0]);
        }
        return true;
      });

    try {
      testGlobal.addEventListener(
        'error',
        (event) => queueMicrotask(() => event.preventDefault()),
        { once: true },
      );
      testGlobal.setTimeout(() => {
        throw expected;
      }, 0);
      await new Promise((resolve) => nodeSetTimeout(resolve, 20));

      expect(uncaughtErrors).toEqual([expected]);
    } finally {
      emitSpy.mockRestore();
      await teardown();
    }
  });

  it('only honors error cancellation during synchronous DOM dispatch', async () => {
    const testGlobal = createTestGlobal();
    const { teardown } = await environment.setup(testGlobal, {
      beforeParse(window) {
        window.addEventListener(
          'error',
          (event) =>
            queueMicrotask(() => {
              event.preventDefault();
              Object.defineProperty(event, 'error', { value: null });
            }),
          { once: true },
        );
      },
    });
    const lateCancellationError = new Error('late cancellation');
    const synchronouslyHandledError = new Error('synchronously handled');
    const prototypeHandledError = new Error('prototype handled');
    const uncaughtErrors: unknown[] = [];
    const emitSpy = rs
      .spyOn(process, 'emit')
      .mockImplementation((event: string | symbol, ...args: unknown[]) => {
        if (event === 'uncaughtException') {
          uncaughtErrors.push(args[0]);
        }
        return true;
      });

    try {
      const lateCancellationEvent = new testGlobal.ErrorEvent('error', {
        cancelable: true,
        error: lateCancellationError,
      });
      const originalPreventDefault = lateCancellationEvent.preventDefault;
      testGlobal.dispatchEvent(lateCancellationEvent);
      await Promise.resolve();
      expect(lateCancellationEvent.preventDefault).toBe(originalPreventDefault);

      testGlobal.addEventListener('error', (event) => event.preventDefault(), {
        once: true,
      });
      testGlobal.dispatchEvent(
        new testGlobal.ErrorEvent('error', {
          cancelable: true,
          error: synchronouslyHandledError,
        }),
      );
      await Promise.resolve();

      const preventDefault = testGlobal.Event.prototype.preventDefault;
      testGlobal.addEventListener(
        'error',
        (event) => Reflect.apply(preventDefault, event, []),
        { once: true },
      );
      testGlobal.dispatchEvent(
        new testGlobal.ErrorEvent('error', {
          cancelable: true,
          error: prototypeHandledError,
        }),
      );
      await Promise.resolve();

      const nonExtensibleError = new Error('non-extensible event');
      testGlobal.dispatchEvent(
        Object.preventExtensions(
          new testGlobal.ErrorEvent('error', {
            cancelable: true,
            error: nonExtensibleError,
          }),
        ),
      );
      await Promise.resolve();

      expect(uncaughtErrors).toEqual([
        lateCancellationError,
        nonExtensibleError,
      ]);
    } finally {
      emitSpy.mockRestore();
      await teardown();
    }
  });

  it('preserves thrown values when timer error messages are unsafe', async () => {
    const testGlobal = createTestGlobal();
    const { teardown } = await environment.setup(testGlobal, {});
    const toStringError = new Error('toString trap');
    const messageError = new Error('message getter trap');
    const nestedMessageError = new Error('nested message toString trap');
    const thrownValues = [
      {
        toString() {
          throw toStringError;
        },
      },
      Object.defineProperty(new Error(), 'message', {
        get() {
          throw messageError;
        },
      }),
      Object.defineProperty(new Error(), 'message', {
        get() {
          return {
            toString() {
              throw nestedMessageError;
            },
          };
        },
      }),
    ];

    try {
      for (const thrownValue of thrownValues) {
        const received = new Promise<{ error: unknown; message: string }>(
          (resolve) => {
            testGlobal.addEventListener(
              'error',
              (event) => {
                event.preventDefault();
                resolve({ error: event.error, message: event.message });
              },
              { once: true },
            );
          },
        );
        testGlobal.setTimeout(() => {
          throw thrownValue;
        }, 0);

        await expect(received).resolves.toEqual({
          error: thrownValue,
          message: 'Timer callback threw an unprintable value',
        });
      }
    } finally {
      await teardown();
    }
  });

  it('uses the Node fatal path for unhandled timer errors', async () => {
    const testGlobal = createTestGlobal();
    const { teardown } = await environment.setup(testGlobal, {});
    const expected = new Error('captured timer error');
    const emitSpy = rs.spyOn(process, 'emit').mockImplementation(() => true);
    let capturedError: unknown;

    try {
      process.setUncaughtExceptionCaptureCallback((error) => {
        capturedError = error;
      });
      testGlobal.setTimeout(() => {
        throw expected;
      }, 0);
      await new Promise((resolve) => nodeSetTimeout(resolve, 20));

      expect(capturedError).toBe(expected);
    } finally {
      process.setUncaughtExceptionCaptureCallback(null);
      emitSpy.mockRestore();
      await teardown();
    }
  });

  it('reports errors with the original microtask scheduler', async () => {
    const testGlobal = createTestGlobal();
    const { teardown } = await environment.setup(testGlobal, {});
    const uncaughtErrors: unknown[] = [];
    const emitSpy = rs
      .spyOn(process, 'emit')
      .mockImplementation((event: string | symbol, ...args: unknown[]) => {
        if (event === 'uncaughtException') {
          uncaughtErrors.push(args[0]);
        }
        return true;
      });

    try {
      rs.useFakeTimers({ toFake: ['queueMicrotask'] });
      const expected = new Error('unhandled error');
      testGlobal.dispatchEvent(
        new testGlobal.ErrorEvent('error', {
          cancelable: true,
          error: expected,
          message: expected.message,
        }),
      );
      await Promise.resolve();

      expect(uncaughtErrors).toEqual([expected]);
    } finally {
      rs.useRealTimers();
      emitSpy.mockRestore();
      await teardown();
    }
  });

  it('preserves Node uncaught-exception events and origin', async () => {
    const testGlobal = createTestGlobal();
    const { teardown } = await environment.setup(testGlobal, {});
    const expected = new Error('unhandled error metadata');
    const uncaughtEvents: Array<[string | symbol, ...unknown[]]> = [];
    const emitSpy = rs
      .spyOn(process, 'emit')
      .mockImplementation((event: string | symbol, ...args: unknown[]) => {
        if (
          event === 'uncaughtExceptionMonitor' ||
          event === 'uncaughtException'
        ) {
          uncaughtEvents.push([event, ...args]);
        }
        return true;
      });

    try {
      testGlobal.dispatchEvent(
        new testGlobal.ErrorEvent('error', {
          cancelable: true,
          error: expected,
          message: expected.message,
        }),
      );
      await Promise.resolve();

      expect(uncaughtEvents).toEqual([
        ['uncaughtExceptionMonitor', expected, 'uncaughtException'],
        ['uncaughtException', expected, 'uncaughtException'],
      ]);
    } finally {
      emitSpy.mockRestore();
      await teardown();
    }
  });

  it('reports timer errors with the captured DOM dispatch', async () => {
    const testGlobal = createTestGlobal();
    const { teardown } = await environment.setup(testGlobal, {});
    const expected = new Error('captured dispatch error');
    const uncaughtErrors: unknown[] = [];
    const emitSpy = rs
      .spyOn(process, 'emit')
      .mockImplementation((event: string | symbol, ...args: unknown[]) => {
        if (event === 'uncaughtException') {
          uncaughtErrors.push(args[0]);
        }
        return true;
      });

    try {
      testGlobal.dispatchEvent = () => true;
      testGlobal.ErrorEvent = undefined as unknown as typeof ErrorEvent;
      testGlobal.setTimeout(() => {
        throw expected;
      }, 0);

      await new Promise((resolve) => nodeSetTimeout(resolve, 20));
      expect(uncaughtErrors).toEqual([expected]);
    } finally {
      emitSpy.mockRestore();
      await teardown();
    }
  });

  it('ignores error events without an error value', async () => {
    const testGlobal = createTestGlobal();
    const { teardown } = await environment.setup(testGlobal, {});
    const uncaughtErrors: unknown[] = [];
    const emitSpy = rs
      .spyOn(process, 'emit')
      .mockImplementation((event: string | symbol, ...args: unknown[]) => {
        if (event === 'uncaughtException') {
          uncaughtErrors.push(args[0]);
        }
        return true;
      });

    try {
      testGlobal.dispatchEvent(new testGlobal.Event('error'));
      testGlobal.dispatchEvent(
        new testGlobal.ErrorEvent('error', { message: 'notification' }),
      );
      await Promise.resolve();

      expect(uncaughtErrors).toEqual([]);
    } finally {
      emitSpy.mockRestore();
      await teardown();
    }
  });

  it('clears a timeout refreshed from inside its callback', async () => {
    const testGlobal = createTestGlobal();
    const { teardown } = await environment.setup(testGlobal, {});
    let calls = 0;
    let tornDown = false;

    try {
      await new Promise<void>((resolve) => {
        testGlobal.setTimeout(function (this: NodeJS.Timeout) {
          calls++;
          if (calls === 1) {
            this.refresh();
            resolve();
          }
        }, 10);
      });

      tornDown = true;
      await teardown();
      await new Promise((resolve) => nodeSetTimeout(resolve, 30));
      expect(calls).toBe(1);
    } finally {
      if (!tornDown) {
        await teardown();
      }
    }
  });

  it('uses the refreshed timeout receiver for teardown ownership', () => {
    const testGlobal = createTestGlobal();
    const clearTimeout = rs.fn(testGlobal.clearTimeout);
    const cleanup = installTimerTracking(testGlobal, {
      AbortController,
      clearInterval: testGlobal.clearInterval,
      clearTimeout,
      setInterval: testGlobal.setInterval,
      setTimeout: testGlobal.setTimeout,
    });
    const firstTimer = testGlobal.setTimeout(() => {}, 60_000);
    const secondTimer = testGlobal.setTimeout(() => {}, 60_000);

    try {
      expect(Reflect.apply(firstTimer.refresh, secondTimer, [])).toBe(
        secondTimer,
      );
      cleanup();

      expect(clearTimeout).toHaveBeenCalledTimes(2);
      expect(clearTimeout).toHaveBeenCalledWith(firstTimer);
      expect(clearTimeout).toHaveBeenCalledWith(secondTimer);
    } finally {
      clearTimeout(firstTimer);
      clearTimeout(secondTimer);
      cleanup();
    }
  });

  it('preserves timer lifecycle method descriptors', () => {
    const nativeTimer = setTimeout(() => {}, 60_000);
    const testGlobal = createTestGlobal();
    const cleanup = installTimerTracking(testGlobal, getNodeTimers(testGlobal));
    const trackedTimer = testGlobal.setTimeout(() => {}, 60_000);

    try {
      for (const key of ['close', 'refresh', Symbol.dispose] as const) {
        const nativeDescriptor = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(nativeTimer),
          key,
        );
        const trackedDescriptor = Object.getOwnPropertyDescriptor(
          trackedTimer,
          key,
        );

        expect(trackedDescriptor).toMatchObject({
          configurable: nativeDescriptor?.configurable,
          enumerable: nativeDescriptor?.enumerable,
          writable: nativeDescriptor?.writable,
        });
      }
    } finally {
      clearTimeout(nativeTimer);
      clearTimeout(trackedTimer);
      cleanup();
    }
  });

  it('keeps borrowed refresh ownership in the receiver environment', () => {
    const firstGlobal = createTestGlobal();
    const secondGlobal = createTestGlobal();
    const firstClearTimeout = rs.fn(firstGlobal.clearTimeout);
    const secondClearTimeout = rs.fn(secondGlobal.clearTimeout);
    const firstCleanup = installTimerTracking(firstGlobal, {
      AbortController,
      clearInterval: firstGlobal.clearInterval,
      clearTimeout: firstClearTimeout,
      setInterval: firstGlobal.setInterval,
      setTimeout: firstGlobal.setTimeout,
    });
    const secondCleanup = installTimerTracking(secondGlobal, {
      AbortController,
      clearInterval: secondGlobal.clearInterval,
      clearTimeout: secondClearTimeout,
      setInterval: secondGlobal.setInterval,
      setTimeout: secondGlobal.setTimeout,
    });
    const firstTimer = firstGlobal.setTimeout(() => {}, 60_000);
    const secondTimer = secondGlobal.setTimeout(() => {}, 60_000);

    try {
      Reflect.apply(firstTimer.refresh, secondTimer, []);
      firstCleanup();

      expect(firstClearTimeout).toHaveBeenCalledTimes(1);
      expect(firstClearTimeout).toHaveBeenCalledWith(firstTimer);
      expect(secondClearTimeout).not.toHaveBeenCalled();

      secondCleanup();
      expect(secondClearTimeout).toHaveBeenCalledTimes(1);
      expect(secondClearTimeout).toHaveBeenCalledWith(secondTimer);
    } finally {
      clearTimeout(firstTimer);
      clearTimeout(secondTimer);
      firstCleanup();
      secondCleanup();
    }
  });

  it('does not keep a completed timeout referenced after teardown', async () => {
    const testGlobal = createTestGlobal();
    const { teardown } = await environment.setup(testGlobal, {});
    let timer: NodeJS.Timeout | undefined;
    let tornDown = false;

    try {
      timer = await new Promise<NodeJS.Timeout>((resolve) => {
        const scheduledTimer = testGlobal.setTimeout(
          () => resolve(scheduledTimer),
          1,
        );
      });

      tornDown = true;
      await teardown();
      Object.defineProperty(timer, Symbol.toPrimitive, {
        configurable: true,
        value() {
          throw new Error('timer coercion');
        },
      });
      expect(() => timer?.refresh()).not.toThrow();

      expect(timer?.hasRef()).toBe(false);
      timer?.ref();
      expect(timer?.hasRef()).toBe(true);
      timer?.unref();
    } finally {
      if (!tornDown) {
        await teardown();
      }
      clearTimeout(timer);
    }
  });

  it('does not reactivate a canceled timeout refreshed after teardown', async () => {
    const testGlobal = createTestGlobal();
    const { teardown } = await environment.setup(testGlobal, {});
    let called = false;
    const timer = testGlobal.setTimeout(() => {
      called = true;
    }, 10);

    await teardown();
    timer.refresh();
    expect(timer.hasRef()).toBe(false);
    await new Promise((resolve) => nodeSetTimeout(resolve, 20));
    expect(called).toBe(false);
    clearTimeout(timer);
  });

  it('preserves Node setTimeout utility behavior', async () => {
    const testGlobal = createTestGlobal();
    const nativePromisifyDescriptor = Object.getOwnPropertyDescriptor(
      testGlobal.setTimeout,
      promisify.custom,
    );
    const { teardown } = await environment.setup(testGlobal, {});

    try {
      const sleep = promisify(testGlobal.setTimeout);
      await expect(sleep(1, 'done')).resolves.toBe('done');
      await expect(
        sleep(1, 'frozen', Object.freeze({ ref: false })),
      ).resolves.toBe('frozen');
      const frozenController = new AbortController();
      await expect(
        sleep(
          1,
          'frozen signal',
          Object.freeze({ signal: frozenController.signal }),
        ),
      ).resolves.toBe('frozen signal');

      const trackedPromisifyDescriptor = Object.getOwnPropertyDescriptor(
        testGlobal.setTimeout,
        promisify.custom,
      );
      expect(trackedPromisifyDescriptor).toMatchObject({
        configurable: nativePromisifyDescriptor?.configurable,
        enumerable: nativePromisifyDescriptor?.enumerable,
      });
      expect('get' in (trackedPromisifyDescriptor ?? {})).toBe(
        'get' in (nativePromisifyDescriptor ?? {}),
      );

      let errorCode: string | undefined;
      try {
        Reflect.apply(testGlobal.setTimeout, testGlobal, ['invalid', 0]);
      } catch (error) {
        errorCode = (error as { code?: string }).code;
      }
      expect(errorCode).toBe('ERR_INVALID_ARG_TYPE');
    } finally {
      await teardown();
    }
  });

  it('preserves rejected promises for invalid promisify options', async () => {
    const testGlobal = createTestGlobal();
    const { teardown } = await environment.setup(testGlobal, {});
    const sleep = promisify(testGlobal.setTimeout);
    const callSleep = (options: unknown) =>
      Reflect.apply(sleep, undefined, [0, undefined, options]) as Promise<void>;

    try {
      let nullSignalPromise: Promise<void> | undefined;
      expect(() => {
        nullSignalPromise = callSleep({ signal: null });
      }).not.toThrow();
      await expect(nullSignalPromise).rejects.toMatchObject({
        code: 'ERR_INVALID_ARG_TYPE',
      });

      for (const key of ['signal', 'ref']) {
        const expected = new Error(`${key} getter`);
        const options = Object.defineProperty({}, key, {
          get() {
            throw expected;
          },
        });
        let getterPromise: Promise<void> | undefined;
        expect(() => {
          getterPromise = callSleep(options);
        }).not.toThrow();
        await expect(getterPromise).rejects.toBe(expected);
      }

      const cleanupError = new Error('removeEventListener');
      const signal = {
        aborted: false,
        addEventListener() {},
        removeEventListener() {
          throw cleanupError;
        },
      };
      await expect(callSleep({ signal })).rejects.toBe(cleanupError);

      const cleanupGetterError = new Error('removeEventListener getter');
      const signalWithCleanupGetter = Object.defineProperty(
        {
          aborted: false,
          addEventListener() {},
        },
        'removeEventListener',
        {
          get() {
            throw cleanupGetterError;
          },
        },
      );
      let cleanupGetterPromise: Promise<void> | undefined;
      expect(() => {
        cleanupGetterPromise = callSleep({ signal: signalWithCleanupGetter });
      }).not.toThrow();
      await expect(cleanupGetterPromise).rejects.toBe(cleanupGetterError);
    } finally {
      await teardown();
    }
  });

  it('preserves native signal accessor error timing', async () => {
    const testGlobal = createTestGlobal();
    const nativeSleep = promisify(testGlobal.setTimeout);
    const cleanup = installTimerTracking(testGlobal, getNodeTimers(testGlobal));
    const trackedSleep = promisify(testGlobal.setTimeout);
    const observeCall = async (call: () => Promise<unknown>) => {
      let promise: Promise<unknown>;
      try {
        promise = call();
      } catch (error) {
        return { error, phase: 'thrown' } as const;
      }
      try {
        await promise;
        return { phase: 'resolved' } as const;
      } catch (error) {
        return { error, phase: 'rejected' } as const;
      }
    };
    const cases: Array<[string, (expected: Error) => { signal: object }]> = [
      [
        'aborted getter',
        (expected) => ({
          signal: Object.defineProperty(
            { addEventListener() {}, removeEventListener() {} },
            'aborted',
            {
              get() {
                throw expected;
              },
            },
          ),
        }),
      ],
      [
        'addEventListener getter',
        (expected) => ({
          signal: {
            aborted: false,
            get addEventListener(): never {
              throw expected;
            },
            removeEventListener() {},
          },
        }),
      ],
      [
        'reason getter',
        (expected) => ({
          signal: {
            aborted: true,
            addEventListener() {},
            removeEventListener() {},
            get reason(): never {
              throw expected;
            },
          },
        }),
      ],
      [
        'addEventListener method',
        (expected) => ({
          signal: {
            aborted: false,
            addEventListener() {
              throw expected;
            },
            removeEventListener() {},
          },
        }),
      ],
      [
        'removeEventListener getter',
        (expected) => ({
          signal: {
            aborted: false,
            addEventListener() {},
            get removeEventListener(): never {
              throw expected;
            },
          },
        }),
      ],
      [
        'removeEventListener method',
        (expected) => ({
          signal: {
            aborted: false,
            addEventListener() {},
            removeEventListener() {
              throw expected;
            },
          },
        }),
      ],
    ];

    try {
      for (const [name, createOptions] of cases) {
        const expected = new Error(name);
        const nativeResult = await observeCall(() =>
          Reflect.apply(nativeSleep, undefined, [
            0,
            undefined,
            createOptions(expected),
          ]),
        );
        const trackedResult = await observeCall(() =>
          Reflect.apply(trackedSleep, undefined, [
            0,
            undefined,
            createOptions(expected),
          ]),
        );

        expect(trackedResult).toEqual(nativeResult);
      }
    } finally {
      cleanup();
    }
  });

  it('routes numeric timer ids without losing Node ownership', () => {
    const testGlobal = createTestGlobal();
    const clearTimeout = rs.fn(testGlobal.clearTimeout);
    const clearInterval = rs.fn(testGlobal.clearInterval);
    const domClearTimeout = rs.fn();
    const domClearInterval = rs.fn();
    const cleanup = installTimerTracking(
      testGlobal,
      {
        AbortController,
        clearInterval,
        clearTimeout,
        setInterval: testGlobal.setInterval,
        setTimeout: testGlobal.setTimeout,
      },
      {
        clearInterval: domClearInterval,
        clearTimeout: domClearTimeout,
      },
    );

    try {
      const numericTimeout = testGlobal.setTimeout(() => {}, 60_000);
      const numericInterval = testGlobal.setInterval(() => {}, 60_000);
      testGlobal.clearInterval(Number(numericTimeout));
      testGlobal.clearTimeout(Number(numericInterval));

      const stringTimeout = testGlobal.setTimeout(() => {}, 60_000);
      const stringInterval = testGlobal.setInterval(() => {}, 60_000);
      const timeoutId = String(Number(stringTimeout));
      const intervalId = String(Number(stringInterval));
      Reflect.apply(testGlobal.clearInterval, testGlobal, [timeoutId]);
      Reflect.apply(testGlobal.clearTimeout, testGlobal, [intervalId]);

      const aliasedTimeout = testGlobal.setTimeout(() => {}, 60_000);
      const nonCanonicalId = `0${Number(aliasedTimeout)}`;
      Reflect.apply(testGlobal.clearTimeout, testGlobal, [nonCanonicalId]);
      Reflect.apply(testGlobal.clearTimeout, testGlobal, ['424242']);
      cleanup();

      expect(domClearInterval).not.toHaveBeenCalled();
      expect(domClearTimeout.mock.calls).toEqual([
        [nonCanonicalId],
        ['424242'],
      ]);
      expect(clearInterval).toHaveBeenCalledWith(timeoutId);
      expect(clearTimeout).toHaveBeenCalledWith(intervalId);
      expect(clearTimeout).toHaveBeenCalledWith(nonCanonicalId);
      expect(clearTimeout).toHaveBeenCalledWith(aliasedTimeout);
    } finally {
      cleanup();
    }
  });

  it('keeps promisified timeouts tracked after no-op clear calls', () => {
    const testGlobal = createTestGlobal();
    const abortSpy = rs.spyOn(AbortController.prototype, 'abort');
    const cleanup = installTimerTracking(testGlobal, getNodeTimers(testGlobal));

    try {
      const sleep = promisify(testGlobal.setTimeout);
      const timeoutSleep = sleep(20);
      const intervalSleep = sleep(20);
      Reflect.apply(testGlobal.clearTimeout, testGlobal, [timeoutSleep]);
      Reflect.apply(testGlobal.clearInterval, testGlobal, [intervalSleep]);
      cleanup();

      expect(abortSpy).toHaveBeenCalledTimes(2);
    } finally {
      abortSpy.mockRestore();
      cleanup();
    }
  });

  it('forgets timers canceled through their handles', () => {
    const testGlobal = createTestGlobal();
    const clearTimeout = rs.fn(testGlobal.clearTimeout);
    const clearInterval = rs.fn(testGlobal.clearInterval);
    const cleanup = installTimerTracking(testGlobal, {
      AbortController,
      clearInterval,
      clearTimeout,
      setInterval: testGlobal.setInterval,
      setTimeout: testGlobal.setTimeout,
    });

    try {
      const disposedTimeout = testGlobal.setTimeout(() => {}, 60_000);
      const closedTimeout = testGlobal.setTimeout(() => {}, 60_000);
      const disposedInterval = testGlobal.setInterval(() => {}, 60_000);
      const closedInterval = testGlobal.setInterval(() => {}, 60_000);

      expect(disposedTimeout[Symbol.dispose]()).toBeUndefined();
      expect(closedTimeout.close()).toBe(closedTimeout);
      expect(disposedInterval[Symbol.dispose]()).toBeUndefined();
      expect(closedInterval.close()).toBe(closedInterval);
      cleanup();

      expect(clearTimeout).not.toHaveBeenCalled();
      expect(clearInterval).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it('forgets timers canceled from another environment', () => {
    const firstGlobal = createTestGlobal();
    const secondGlobal = createTestGlobal();
    const firstClearTimeout = rs.fn(firstGlobal.clearTimeout);
    const firstClearInterval = rs.fn(firstGlobal.clearInterval);
    const secondClearTimeout = rs.fn(secondGlobal.clearTimeout);
    const secondClearInterval = rs.fn(secondGlobal.clearInterval);
    const domClearTimeout = rs.fn();
    const domClearInterval = rs.fn();
    const firstCleanup = installTimerTracking(firstGlobal, {
      AbortController,
      clearInterval: firstClearInterval,
      clearTimeout: firstClearTimeout,
      setInterval: firstGlobal.setInterval,
      setTimeout: firstGlobal.setTimeout,
    });
    const secondCleanup = installTimerTracking(
      secondGlobal,
      {
        AbortController,
        clearInterval: secondClearInterval,
        clearTimeout: secondClearTimeout,
        setInterval: secondGlobal.setInterval,
        setTimeout: secondGlobal.setTimeout,
      },
      {
        clearInterval: domClearInterval,
        clearTimeout: domClearTimeout,
      },
    );

    try {
      const staleSetTimeout = firstGlobal.setTimeout;
      const staleSetInterval = firstGlobal.setInterval;
      const firstTimer = firstGlobal.setTimeout(() => {}, 60_000);
      const secondTimer = secondGlobal.setTimeout(() => {}, 60_000);
      expect(Reflect.apply(firstTimer.close, secondTimer, [])).toBe(
        secondTimer,
      );
      firstCleanup();

      const crossClearedTimeout = staleSetTimeout(() => {}, 60_000);
      const crossClearedInterval = staleSetInterval(() => {}, 60_000);
      secondGlobal.clearTimeout(crossClearedTimeout);
      secondGlobal.clearInterval(Number(crossClearedInterval));
      secondCleanup();

      expect(secondClearTimeout).toHaveBeenCalledWith(crossClearedTimeout);
      expect(secondClearInterval).toHaveBeenCalledWith(
        Number(crossClearedInterval),
      );
      expect(domClearTimeout).not.toHaveBeenCalled();
      expect(domClearInterval).not.toHaveBeenCalled();
      expect(firstClearTimeout).toHaveBeenCalledTimes(1);
      expect(firstClearTimeout).toHaveBeenCalledWith(firstTimer);
      expect(firstClearInterval).not.toHaveBeenCalled();
    } finally {
      firstCleanup();
      secondCleanup();
    }
  });

  it('forgets timers canceled through stale handle wrappers', () => {
    const testGlobal = createTestGlobal();
    const domClearTimeout = rs.fn();
    const domClearInterval = rs.fn();
    const cleanup = installTimerTracking(
      testGlobal,
      {
        AbortController,
        clearInterval: testGlobal.clearInterval,
        clearTimeout: testGlobal.clearTimeout,
        setInterval: testGlobal.setInterval,
        setTimeout: testGlobal.setTimeout,
      },
      {
        clearInterval: domClearInterval,
        clearTimeout: domClearTimeout,
      },
    );
    const staleSetTimeout = testGlobal.setTimeout;
    const staleSetInterval = testGlobal.setInterval;
    const staleClearTimeout = testGlobal.clearTimeout;
    const staleClearInterval = testGlobal.clearInterval;
    cleanup();

    const timeout = staleSetTimeout(() => {}, 60_000);
    const interval = staleSetInterval(() => {}, 60_000);
    const timeoutId = Number(timeout);
    const intervalId = Number(interval);
    timeout[Symbol.dispose]();
    interval.close();
    staleClearTimeout(timeoutId);
    staleClearInterval(intervalId);

    expect(domClearTimeout).toHaveBeenCalledWith(timeoutId);
    expect(domClearInterval).toHaveBeenCalledWith(intervalId);
  });

  it('uses the captured AbortController abort method during cleanup', async () => {
    const testGlobal = createTestGlobal();
    const cleanup = installTimerTracking(testGlobal, getNodeTimers(testGlobal));
    const abort = AbortController.prototype.abort;

    try {
      const sleep = promisify(testGlobal.setTimeout);
      const outcome = sleep(20, 'resolved');
      AbortController.prototype.abort = () => {};
      cleanup();
      AbortController.prototype.abort = abort;

      await expect(
        Promise.race([
          outcome,
          new Promise((resolve) =>
            nodeSetTimeout(() => resolve('pending'), 40),
          ),
        ]),
      ).resolves.toBe('pending');
    } finally {
      AbortController.prototype.abort = abort;
      cleanup();
    }
  });

  it('isolates ordinary sleeps from AbortSignal prototype changes', async () => {
    const testGlobal = createTestGlobal();
    const cleanup = installTimerTracking(testGlobal, getNodeTimers(testGlobal));
    const addEventListener = AbortSignal.prototype.addEventListener;
    const removeEventListener = AbortSignal.prototype.removeEventListener;
    const abortedDescriptor = Object.getOwnPropertyDescriptor(
      AbortSignal.prototype,
      'aborted',
    );
    const signalDescriptor = Object.getOwnPropertyDescriptor(
      AbortController.prototype,
      'signal',
    );

    try {
      const sleep = promisify(testGlobal.setTimeout);
      AbortSignal.prototype.addEventListener = () => {
        throw new Error('mutated addEventListener');
      };
      const addOutcome = sleep(1, 'add');
      AbortSignal.prototype.addEventListener = addEventListener;
      await expect(addOutcome).resolves.toBe('add');

      const removeOutcome = sleep(1, 'remove');
      AbortSignal.prototype.removeEventListener = () => {
        throw new Error('mutated removeEventListener');
      };
      await expect(removeOutcome).resolves.toBe('remove');

      Reflect.deleteProperty(AbortSignal.prototype, 'aborted');
      await expect(sleep(1, 'aborted')).resolves.toBe('aborted');

      Object.defineProperty(AbortController.prototype, 'signal', {
        configurable: true,
        get() {
          throw new Error('mutated signal getter');
        },
      });
      await expect(sleep(1, 'signal')).resolves.toBe('signal');
    } finally {
      AbortSignal.prototype.addEventListener = addEventListener;
      AbortSignal.prototype.removeEventListener = removeEventListener;
      if (abortedDescriptor) {
        Object.defineProperty(
          AbortSignal.prototype,
          'aborted',
          abortedDescriptor,
        );
      }
      if (signalDescriptor) {
        Object.defineProperty(
          AbortController.prototype,
          'signal',
          signalDescriptor,
        );
      }
      cleanup();
    }
  });

  it('preserves stale promisified timeouts during cleanup', async () => {
    const testGlobal = createTestGlobal();
    const cleanup = installTimerTracking(testGlobal, getNodeTimers(testGlobal));
    const unhandledRejections: unknown[] = [];
    const emitSpy = rs
      .spyOn(process, 'emit')
      .mockImplementation((event: string | symbol, ...args: unknown[]) => {
        if (event === 'unhandledRejection') {
          unhandledRejections.push(args[0]);
        }
        return true;
      });

    try {
      const staleSleep = promisify(testGlobal.setTimeout);
      void staleSleep(60_000).then(() => {});
      cleanup();
      await expect(staleSleep(1, 'done')).resolves.toBe('done');
      const callStaleSleep = (options: unknown) =>
        Reflect.apply(staleSleep, undefined, [
          0,
          undefined,
          options,
        ]) as Promise<void>;
      await expect(callStaleSleep({ ref: 'invalid' })).rejects.toMatchObject({
        code: 'ERR_INVALID_ARG_TYPE',
      });
      const refGetterError = new Error('stale ref getter');
      await expect(
        callStaleSleep(
          Object.defineProperty({}, 'ref', {
            get() {
              throw refGetterError;
            },
          }),
        ),
      ).rejects.toBe(refGetterError);
      await new Promise((resolve) => nodeSetTimeout(resolve, 20));

      expect(unhandledRejections).toEqual([]);
    } finally {
      emitSpy.mockRestore();
      cleanup();
    }
  });

  it('preserves a user abort rejection when cleanup runs in the same turn', async () => {
    const testGlobal = createTestGlobal();
    const cleanup = installTimerTracking(testGlobal, getNodeTimers(testGlobal));
    const controller = new AbortController();
    const userReason = new Error('user abort');

    try {
      const sleep = promisify(testGlobal.setTimeout);
      const outcome = sleep(60_000, undefined, {
        signal: controller.signal,
      }).then(
        () => 'resolved' as const,
        (error) => error,
      );
      controller.abort(userReason);
      cleanup();

      await expect(
        Promise.race([
          outcome,
          new Promise((resolve) =>
            nodeSetTimeout(() => resolve('pending'), 20),
          ),
        ]),
      ).resolves.toMatchObject({
        cause: userReason,
        code: 'ABORT_ERR',
        name: 'AbortError',
      });
    } finally {
      cleanup();
    }
  });

  it('suppresses signal cleanup failures caused by teardown', async () => {
    const testGlobal = createTestGlobal();
    const cleanup = installTimerTracking(testGlobal, getNodeTimers(testGlobal));
    const cleanupError = new Error('teardown signal cleanup');
    const signal = {
      aborted: false,
      addEventListener() {},
      removeEventListener() {
        throw cleanupError;
      },
    };

    try {
      const sleep = promisify(testGlobal.setTimeout);
      const outcome = Reflect.apply(sleep, undefined, [
        60_000,
        undefined,
        { signal },
      ]).then(
        () => 'resolved' as const,
        (error) => error,
      );
      cleanup();

      await expect(
        Promise.race([
          outcome,
          new Promise((resolve) =>
            nodeSetTimeout(() => resolve('pending'), 20),
          ),
        ]),
      ).resolves.toBe('pending');
    } finally {
      cleanup();
    }
  });

  it('preserves user-owned signal cleanup failures during teardown', async () => {
    const testGlobal = createTestGlobal();
    const cleanup = installTimerTracking(testGlobal, getNodeTimers(testGlobal));
    const controller = new AbortController();
    const cleanupError = new Error('user signal cleanup');
    const removeEventListener = controller.signal.removeEventListener;
    controller.signal.removeEventListener = function (...args) {
      Reflect.apply(removeEventListener, this, args);
      throw cleanupError;
    };

    try {
      const sleep = promisify(testGlobal.setTimeout);
      const outcome = sleep(60_000, undefined, {
        signal: controller.signal,
      }).then(
        () => 'resolved' as const,
        (error) => error,
      );
      controller.abort(new Error('user abort'));
      cleanup();

      await expect(outcome).resolves.toBe(cleanupError);
    } finally {
      cleanup();
    }
  });

  it('does not ref promisified timer wrappers retained after teardown', async () => {
    const testGlobal = createTestGlobal();
    let receivedRef: boolean | undefined;
    let receivedSignal: AbortSignal | null | undefined;
    const nativeSetTimeout = ((...args: Parameters<typeof setTimeout>) =>
      setTimeout(...args)) as typeof setTimeout;
    Object.defineProperty(nativeSetTimeout, promisify.custom, {
      configurable: true,
      value: async <T>(
        _delay?: number,
        value?: T,
        options?: { ref?: boolean; signal?: AbortSignal | null } | null,
      ) => {
        receivedRef = options?.ref;
        receivedSignal = options?.signal;
        return value;
      },
    });
    const cleanup = installTimerTracking(testGlobal, {
      AbortController,
      clearInterval: testGlobal.clearInterval,
      clearTimeout: testGlobal.clearTimeout,
      setInterval: testGlobal.setInterval,
      setTimeout: nativeSetTimeout,
    });
    const staleSleep = promisify(testGlobal.setTimeout);
    const options = Object.defineProperty({}, 'signal', {
      get(this: unknown) {
        expect(this).toBe(options);
        return undefined;
      },
    });
    cleanup();

    await expect(
      Reflect.apply(staleSleep, undefined, [1, 'done', options]),
    ).resolves.toBe('done');
    expect(receivedRef).toBe(false);
    expect(receivedSignal).toBeUndefined();

    await expect(
      Reflect.apply(staleSleep, undefined, [
        1,
        'frozen',
        Object.freeze({ ref: true }),
      ]),
    ).resolves.toBe('frozen');
    expect(receivedRef).toBe(false);
  });

  it('reports errors from timer wrappers retained after teardown', async () => {
    const testGlobal = createTestGlobal();
    const { teardown } = await environment.setup(testGlobal, {});
    const staleSetTimeout = testGlobal.setTimeout;
    const staleSetInterval = testGlobal.setInterval;
    const timeoutError = new Error('stale timeout error');
    const intervalError = new Error('stale interval error');
    const uncaughtErrors: unknown[] = [];
    await teardown();
    const emitSpy = rs
      .spyOn(process, 'emit')
      .mockImplementation((event: string | symbol, ...args: unknown[]) => {
        if (event === 'uncaughtException') {
          uncaughtErrors.push(args[0]);
        }
        return true;
      });

    try {
      const timeout = staleSetTimeout(() => {}, 60_000);
      const longInterval = staleSetInterval(() => {}, 60_000);
      expect(timeout.hasRef()).toBe(false);
      expect(longInterval.hasRef()).toBe(false);
      clearTimeout(timeout);
      clearInterval(longInterval);

      staleSetTimeout(() => {
        throw timeoutError;
      }, 0);
      const interval = staleSetInterval(() => {
        clearInterval(interval);
        throw intervalError;
      }, 0);
      await new Promise((resolve) => nodeSetTimeout(resolve, 20));

      expect(uncaughtErrors).toEqual([timeoutError, intervalError]);
    } finally {
      emitSpy.mockRestore();
    }
  });

  it('reports timer errors when teardown runs inside the callback', async () => {
    const testGlobal = createTestGlobal();
    const { teardown } = await environment.setup(testGlobal, {});
    const expected = new Error('teardown callback error');
    const uncaughtErrors: unknown[] = [];
    const emitSpy = rs
      .spyOn(process, 'emit')
      .mockImplementation((event: string | symbol, ...args: unknown[]) => {
        if (event === 'uncaughtException') {
          uncaughtErrors.push(args[0]);
        }
        return true;
      });

    try {
      testGlobal.setTimeout(() => {
        void teardown();
        throw expected;
      }, 0);
      await new Promise((resolve) => nodeSetTimeout(resolve, 20));

      expect(uncaughtErrors).toEqual([expected]);
    } finally {
      emitSpy.mockRestore();
    }
  });

  it('uses captured Node primitives for promisified timeouts', async () => {
    const testGlobal = createTestGlobal();
    const NativeAbortController = AbortController;
    let receivedOptions: { ref?: boolean; signal?: AbortSignal } | undefined;
    const nativePromisifiedSetTimeout = rs.fn(
      async <T>(
        _delay?: number,
        value?: T,
        options?: { ref?: boolean; signal?: AbortSignal },
      ) => {
        receivedOptions = options;
        return value;
      },
    );
    const nativeSetTimeout = ((...args: Parameters<typeof setTimeout>) =>
      setTimeout(...args)) as typeof setTimeout;
    Object.defineProperty(nativeSetTimeout, promisify.custom, {
      configurable: true,
      value: nativePromisifiedSetTimeout,
    });
    const cleanup = installTimerTracking(testGlobal, {
      AbortController: NativeAbortController,
      clearInterval: testGlobal.clearInterval,
      clearTimeout: testGlobal.clearTimeout,
      setInterval: testGlobal.setInterval,
      setTimeout: nativeSetTimeout,
    });
    const optionsPrototype = {};
    let inheritedOptions: object;
    Object.defineProperty(optionsPrototype, 'ref', {
      get(this: unknown) {
        expect(this).toBe(inheritedOptions);
        return false;
      },
    });
    inheritedOptions = Object.create(optionsPrototype);

    try {
      rs.stubGlobal('AbortController', undefined);
      await expect(
        promisify(testGlobal.setTimeout)(1, 'done', inheritedOptions),
      ).resolves.toBe('done');

      expect(receivedOptions?.ref).toBe(false);
      expect(receivedOptions?.signal).toBeDefined();
    } finally {
      rs.unstubAllGlobals();
      cleanup();
    }
  });

  it('releases completed one-shot timeouts from teardown tracking', async () => {
    const testGlobal = createTestGlobal();
    const nativeClearTimeout = testGlobal.clearTimeout;
    const clearedTimers: unknown[] = [];
    testGlobal.clearTimeout = (timer) => {
      clearedTimers.push(timer);
      nativeClearTimeout(timer);
    };
    const { teardown } = await environment.setup(testGlobal, {});
    let completedTimer: NodeJS.Timeout | undefined;
    let tornDown = false;

    try {
      await new Promise<void>((resolve) => {
        completedTimer = testGlobal.setTimeout(resolve, 0);
      });
      tornDown = true;
      await teardown();

      expect(clearedTimers).not.toContain(completedTimer);
    } finally {
      if (!tornDown) {
        await teardown();
      }
    }
  });

  it('should preserve URL customizations from beforeParse', async () => {
    const testGlobal = Object.assign(createTestGlobal(), {
      URL,
      URLSearchParams,
    });
    const originalURL = testGlobal.URL;
    const { teardown } = await environment.setup(testGlobal, {
      beforeParse(window: DOMWindow) {
        const OriginalURL = window.URL as typeof URL;
        class CustomURL extends OriginalURL {}
        Object.defineProperty(CustomURL, 'beforeParseMarker', { value: true });
        window.URL = CustomURL;
      },
    });

    try {
      expect(
        (testGlobal.URL as typeof URL & { beforeParseMarker: boolean })
          .beforeParseMarker,
      ).toBe(true);
      expect(
        new testGlobal.URL('https://example.test/?key=value').searchParams,
      ).toBeInstanceOf(testGlobal.URLSearchParams);

      const objectURL = testGlobal.URL.createObjectURL(
        new testGlobal.Blob(['blob']),
      );
      expect(objectURL).toMatch(/^blob:/);
      testGlobal.URL.revokeObjectURL(objectURL);
    } finally {
      await teardown(testGlobal);
    }

    expect(testGlobal.URL).toBe(originalURL);
  });
});
