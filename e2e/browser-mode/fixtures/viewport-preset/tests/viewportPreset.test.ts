import { expect, test } from '@rstest/core';

test('should apply preset viewport to runner iframe', () => {
  expect(window.innerWidth).toBe(390);
  expect(window.innerHeight).toBe(844);
});
import { page } from '@rstest/browser';

test('changes the preset viewport for one test', async () => {
  await page.viewport(800, 600);
  expect(window.innerWidth).toBe(800);
});

test('restores the preset viewport', () => {
  expect(window.innerWidth).toBe(390);
  expect(window.innerHeight).toBe(844);
});
