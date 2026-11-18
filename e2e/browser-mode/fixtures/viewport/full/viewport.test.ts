import { page } from '@rstest/browser';
import { beforeAll, describe, expect, test } from '@rstest/core';

const initial = { width: window.innerWidth, height: window.innerHeight };

test('resizes a viewport without an explicit size', async () => {
  await page.viewport(600, 400);
  expect(window.innerWidth).toBe(600);
  expect(window.innerHeight).toBe(400);
});

test.skipIf(!window.frameElement)(
  'applies explicit dimensions after the headed panel changes',
  async () => {
    const container = window.frameElement?.parentElement?.parentElement;
    if (!container) throw new Error('Expected a headed viewport container.');
    const originalWidth = container.style.width;
    try {
      await page.viewport(600, 400);
      container.style.width = `${initial.width - 40}px`;
      await page.viewport(initial.width, initial.height);
      expect(window.innerWidth).toBe(initial.width);
      expect(window.innerHeight).toBe(initial.height);
    } finally {
      container.style.width = originalWidth;
    }
  },
);

test.concurrent('rejects concurrent viewport changes', async () => {
  await expect(page.viewport(600, 400)).rejects.toThrow('concurrent tests');
});

describe('beforeAll viewport changes', () => {
  beforeAll(async () => {
    await page.viewport(700, 500);
  });
  test('uses the beforeAll size for the first test', () => {
    expect(window.innerWidth).toBe(700);
  });
  test('restores the initial viewport for the following test', () => {
    expect(window.innerWidth).toBe(initial.width);
    expect(window.innerHeight).toBe(initial.height);
  });
});

test('restores the initial size and headed UI mode', () => {
  expect(window.innerWidth).toBe(initial.width);
  expect(window.innerHeight).toBe(initial.height);
  if (window.frameElement) {
    expect(
      window.frameElement.closest('[data-testid="viewport-resizer"]'),
    ).toBeNull();
  }
});

describe('suite with only skipped concurrent children', () => {
  beforeAll(async () => {
    await page.viewport(700, 500);
  });
  test('allows the hook to resize', () => {
    expect(window.innerWidth).toBe(700);
  });
  test.concurrent.skip('does not make the suite concurrent', () => {});
  describe.concurrent('suite with no runnable tests', () => {
    test.skip('does not make the parent concurrent', () => {});
  });
});
