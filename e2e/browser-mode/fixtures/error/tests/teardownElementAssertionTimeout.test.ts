import { page } from '@rstest/browser';
import { afterEach, expect, test } from '@rstest/core';

afterEach(async () => {
  await expect.element(page.getByLabel('teardown-count')).toHaveText('6');
}, 2000);

test('clears the body deadline before teardown', async () => {
  const count = document.createElement('div');
  count.setAttribute('aria-label', 'teardown-count');
  count.textContent = '5';
  document.body.appendChild(count);

  await new Promise((resolve) => setTimeout(resolve, 500));
}, 1000);
