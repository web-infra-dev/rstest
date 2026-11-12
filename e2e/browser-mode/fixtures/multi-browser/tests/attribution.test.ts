import { expect, test } from '@rstest/core';

test('passes in every configured browser', () => {
  expect(document.createElement('main').tagName).toBe('MAIN');
});

test('reports per browser', () => {
  expect(1 + 1).toBe(2);
});

test('runs with the entry-level viewport override', () => {
  // One entry per engine in this fixture, so the user agent picks the
  // expected viewport: the chromium entry overrides to 800, the firefox
  // entry to 900 — a per-entry override survives the shared build.
  const width = window.innerWidth;
  if (navigator.userAgent.includes('Firefox')) {
    expect(width).toBe(900);
  } else {
    expect(width).toBe(800);
  }
});
