import { expect, test } from '@rstest/core';
import type { DOMWindow } from 'jsdom';
import { environment } from '../../../../src/runtime/worker/env/jsdom';

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
