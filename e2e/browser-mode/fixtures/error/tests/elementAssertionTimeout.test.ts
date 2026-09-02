import { page } from '@rstest/browser';
import { afterAll, beforeAll, describe, expect, test } from '@rstest/core';

test('reports the element assertion before the test timeout', async () => {
  const count = document.createElement('div');
  count.setAttribute('aria-label', 'count');
  count.textContent = '5';
  document.body.appendChild(count);

  await expect.element(page.getByLabel('count')).toHaveText('6');
}, 500);

test('uses the Browser Mode poll timeout by default', async () => {
  const count = document.createElement('div');
  count.setAttribute('aria-label', 'default-count');
  count.textContent = '5';
  document.body.appendChild(count);

  await expect.element(page.getByLabel('default-count')).toHaveText('6');
}, 10000);

describe('suite hook assertion timeout', () => {
  beforeAll(async () => {
    const count = document.createElement('div');
    count.setAttribute('aria-label', 'before-all-count');
    count.textContent = '5';
    document.body.appendChild(count);

    await expect.element(page.getByLabel('before-all-count')).toHaveText('6');
  }, 2000);

  afterAll(async () => {
    const count = document.createElement('div');
    count.setAttribute('aria-label', 'after-all-count');
    count.textContent = '5';
    document.body.appendChild(count);

    await expect.element(page.getByLabel('after-all-count')).toHaveText('6');
  }, 2000);

  test('runs suite hooks', () => {});
});
