import { page } from '@rstest/browser';
import { expect, test } from '@rstest/core';

const fixtureTest = test.extend<{ count: HTMLDivElement }>({
  count: async (_context, use) => {
    const count = document.createElement('div');
    count.setAttribute('aria-label', 'use-style-cleanup-count');
    count.textContent = '5';
    document.body.appendChild(count);

    await use(count);

    setTimeout(() => {
      count.textContent = '6';
    }, 1500);
    await expect
      .element(page.getByLabel('use-style-cleanup-count'))
      .toHaveText('6');
  },
});

fixtureTest(
  'caps use-style fixture cleanup assertions',
  ({ count }) => {
    expect(count.textContent).toBe('5');
  },
  1000,
);
