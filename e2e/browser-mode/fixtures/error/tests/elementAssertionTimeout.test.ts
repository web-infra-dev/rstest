import { page } from '@rstest/browser';
import { expect, test } from '@rstest/core';

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
