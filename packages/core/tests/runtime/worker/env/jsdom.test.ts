import { promisify } from 'node:util';
import { expect, test } from '@rstest/core';
import type { DOMWindow } from 'jsdom';
import { environment } from '../../../../src/runtime/worker/env/jsdom';

const createTestGlobal = (): typeof globalThis =>
  ({
    clearInterval: globalThis.clearInterval,
    clearTimeout: globalThis.clearTimeout,
    console: globalThis.console,
    fetch: globalThis.fetch,
    setInterval: globalThis.setInterval,
    setTimeout: globalThis.setTimeout,
    URL: globalThis.URL,
    URLSearchParams: globalThis.URLSearchParams,
  }) as typeof globalThis;

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
  const { teardown } = await environment.setup(testGlobal, {});
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
