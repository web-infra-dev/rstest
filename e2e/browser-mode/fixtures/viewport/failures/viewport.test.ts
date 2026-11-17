import { page } from '@rstest/browser';
import { afterEach, beforeEach, describe, expect, test } from '@rstest/core';

beforeEach(() => {
  expect(window.innerWidth).toBe(390);
  expect(window.innerHeight).toBe(844);
});

test('fails with the resized viewport', async () => {
  await page.viewport(600, 400);
  console.log('VIEWPORT_DEVICE_SCALE', window.devicePixelRatio);
  throw new Error('VIEWPORT_FAILURE');
});

test('passes after the failed test', () => {
  console.log('VIEWPORT_AFTER_FAILURE', window.innerWidth);
});

test('times out with the resized viewport', { timeout: 2000 }, async () => {
  await page.viewport(610, 410);
  await new Promise(() => {});
});

test('passes after the timeout', () => {
  console.log('VIEWPORT_AFTER_TIMEOUT', window.innerWidth);
});

describe('failing cleanup', () => {
  afterEach(() => {
    throw new Error('VIEWPORT_CLEANUP_FAILURE');
  });
  test('fails afterEach with a resized viewport', async () => {
    await page.viewport(620, 420);
  });
});

test('passes after the failed cleanup', () => {
  console.log('VIEWPORT_AFTER_CLEANUP', window.innerWidth);
});
