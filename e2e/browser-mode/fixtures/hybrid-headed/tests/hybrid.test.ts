import { expect, test } from '@rstest/core';

test('runs in each configured browser', () => {
  // One entry per engine and these engine entries override distinct viewports:
  // the chromium entry (headed) opens at 800 wide, the firefox entry (headless)
  // at 900 — asserting the per-entry viewport proves BOTH browsers ran this
  // file, not one browser twice.
  const width = window.innerWidth;
  if (navigator.userAgent.includes('Firefox')) {
    expect(width).toBe(900);
  } else {
    expect(width).toBe(800);
  }
});
