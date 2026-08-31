import { runInContext } from 'node:vm';
import { promisify } from 'node:util';
import { expect, test } from '@rstest/core';
import type { DOMWindow } from 'jsdom';
import {
  environment,
  forwardVirtualConsole,
  setupVM,
} from '../../../../src/runtime/worker/env/jsdom';

const createTestGlobal = (): typeof globalThis =>
  ({
    clearInterval: globalThis.clearInterval,
    clearTimeout: globalThis.clearTimeout,
    console: globalThis.console,
    AbortController: globalThis.AbortController,
    AbortSignal: globalThis.AbortSignal,
    fetch: globalThis.fetch,
    setInterval: globalThis.setInterval,
    setTimeout: globalThis.setTimeout,
    URL: globalThis.URL,
    URLSearchParams: globalThis.URLSearchParams,
  }) as typeof globalThis;

test('bridges Node AbortSignal to jsdom event listeners', async () => {
  const testGlobal = createTestGlobal();
  let JSDOMAbortController!: typeof AbortController;
  let eventTargetPrototype!: EventTarget;
  let originalAddEventListener!: EventTarget['addEventListener'];
  const { teardown } = await environment.setup(
    testGlobal,
    {
      beforeParse(window: DOMWindow) {
        JSDOMAbortController = window.AbortController;
        eventTargetPrototype = window.EventTarget.prototype;
        originalAddEventListener = eventTargetPrototype.addEventListener;
      },
    },
    { scope: 'file' },
  );

  try {
    expect(testGlobal.AbortController).toBe(globalThis.AbortController);
    expect(eventTargetPrototype.addEventListener).not.toBe(
      originalAddEventListener,
    );

    for (const controller of [
      new testGlobal.AbortController(),
      new JSDOMAbortController(),
    ]) {
      let calls = 0;
      const type = 'rstest-abort-signal';
      testGlobal.document.addEventListener(type, () => calls++, {
        signal: controller.signal,
      });
      testGlobal.document.dispatchEvent(new testGlobal.Event(type));
      expect(calls).toBe(1);

      controller.abort();
      testGlobal.document.dispatchEvent(new testGlobal.Event(type));
      expect(calls).toBe(1);
    }

    const abortedController = new testGlobal.AbortController();
    abortedController.abort();
    let calls = 0;
    const type = 'rstest-aborted-signal';
    testGlobal.document.addEventListener(type, () => calls++, {
      signal: abortedController.signal,
    });
    testGlobal.document.dispatchEvent(new testGlobal.Event(type));
    expect(calls).toBe(0);

    const syntheticController = new testGlobal.AbortController();
    syntheticController.signal.addEventListener('abort', (event) =>
      event.stopImmediatePropagation(),
    );
    let syntheticCalls = 0;
    const syntheticType = 'rstest-synthetic-abort-event';
    testGlobal.document.addEventListener(
      syntheticType,
      () => syntheticCalls++,
      { signal: syntheticController.signal },
    );
    syntheticController.signal.dispatchEvent(new Event('abort'));
    testGlobal.document.dispatchEvent(new testGlobal.Event(syntheticType));
    expect(syntheticCalls).toBe(1);

    syntheticController.abort();
    testGlobal.document.dispatchEvent(new testGlobal.Event(syntheticType));
    expect(syntheticCalls).toBe(1);
  } finally {
    await teardown(testGlobal);
  }

  expect(eventTargetPrototype.addEventListener).toBe(originalAddEventListener);
});

test('forwards the console with the pre-v27 jsdom API', () => {
  const forwarded: Console[] = [];

  forwardVirtualConsole(
    {
      sendTo(console) {
        forwarded.push(console);
      },
    },
    console,
  );

  expect(forwarded).toEqual([console]);
});

test('forwards the console with the jsdom v27+ API', () => {
  const forwarded: Console[] = [];

  forwardVirtualConsole(
    {
      forwardTo(console) {
        forwarded.push(console);
      },
    },
    console,
  );

  expect(forwarded).toEqual([console]);
});

test('does not drop VM console events during JSDOM initialization', async () => {
  const calls: unknown[][] = [];
  const { teardown } = await setupVM(
    {
      html: '<script>console.warn("during initialization")</script>',
      beforeParse(window: DOMWindow) {
        window.console.warn = (...args: unknown[]) => calls.push(args);
      },
    },
    { scope: 'file' },
  );

  try {
    expect(calls).toEqual([['during initialization']]);
  } finally {
    teardown();
  }
});

test('forwards deferred VM console events to the configured target', async () => {
  const calls: unknown[][] = [];
  const { setVirtualConsoleTarget, teardown } = await setupVM(
    {
      console: true,
      html: '<script>console.warn("during initialization")</script>',
    },
    { scope: 'file' },
  );

  try {
    setVirtualConsoleTarget({
      warn: (...args: unknown[]) => calls.push(args),
    } as unknown as Console);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(calls).toEqual([['during initialization']]);
  } finally {
    teardown();
  }
});

test('bridges Node AbortSignal to VM JSDOM event listeners', async () => {
  const { context, teardown } = await setupVM({}, { scope: 'file' });
  const vmGlobal = runInContext('globalThis', context) as typeof globalThis;
  const controller = new AbortController();
  let calls = 0;

  try {
    vmGlobal.document.addEventListener(
      'rstest-vm-abort-signal',
      () => calls++,
      { signal: controller.signal },
    );
    vmGlobal.document.dispatchEvent(
      new vmGlobal.Event('rstest-vm-abort-signal'),
    );
    expect(calls).toBe(1);

    controller.abort();
    vmGlobal.document.dispatchEvent(
      new vmGlobal.Event('rstest-vm-abort-signal'),
    );
    expect(calls).toBe(1);
  } finally {
    teardown();
  }
});

test('clears pending Node timers during jsdom teardown', async () => {
  const testGlobal = createTestGlobal();
  const nativeTimers = {
    clearInterval: testGlobal.clearInterval,
    clearTimeout: testGlobal.clearTimeout,
    setInterval: testGlobal.setInterval,
    setTimeout: testGlobal.setTimeout,
  };
  const clearedTimeouts: unknown[] = [];
  const clearedIntervals: unknown[] = [];
  testGlobal.clearTimeout = ((timer: NodeJS.Timeout) => {
    clearedTimeouts.push(timer);
    nativeTimers.clearTimeout(timer);
  }) as typeof clearTimeout;
  testGlobal.clearInterval = ((timer: NodeJS.Timeout) => {
    clearedIntervals.push(timer);
    nativeTimers.clearInterval(timer);
  }) as typeof clearInterval;
  const { teardown } = await environment.setup(
    testGlobal,
    {},
    { scope: 'file' },
  );
  const timeout = testGlobal.setTimeout(() => {}, 60_000);
  const interval = testGlobal.setInterval(() => {}, 60_000);
  let tornDown = false;

  try {
    expect(timeout).toBeInstanceOf(Object);
    expect(timeout.refresh).toBeTypeOf('function');
    expect(interval).toBeInstanceOf(Object);
    expect(promisify(testGlobal.setTimeout)).toBe(
      promisify(nativeTimers.setTimeout),
    );

    await teardown(testGlobal);
    tornDown = true;

    expect(clearedTimeouts).toEqual([timeout]);
    expect(clearedIntervals).toEqual([interval]);
    expect(testGlobal.setTimeout).toBe(nativeTimers.setTimeout);
    expect(testGlobal.setInterval).toBe(nativeTimers.setInterval);
  } finally {
    nativeTimers.clearTimeout(timeout);
    nativeTimers.clearInterval(interval);
    if (!tornDown) {
      await teardown(testGlobal);
    }
  }
});

test('should preserve URL customizations from beforeParse', async () => {
  const testGlobal = { console, URL, URLSearchParams } as typeof globalThis;
  const originalURL = testGlobal.URL;
  const { teardown } = await environment.setup(
    testGlobal,
    {
      beforeParse(window: DOMWindow) {
        const OriginalURL = window.URL as typeof URL;
        class CustomURL extends OriginalURL {}
        Object.defineProperty(CustomURL, 'beforeParseMarker', { value: true });
        window.URL = CustomURL;
      },
    },
    { scope: 'file' },
  );

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
