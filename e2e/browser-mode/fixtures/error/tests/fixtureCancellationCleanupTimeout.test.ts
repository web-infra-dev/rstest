import { page } from '@rstest/browser';
import { expect, test } from '@rstest/core';

const fixtureTest = test.extend(
  'fixtureValue',
  async (_context, { onCleanup }) => {
    onCleanup(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      document
        .querySelector('[aria-label="cancellation-cleanup-count"]')
        ?.remove();
      const count = document.createElement('div');
      count.setAttribute('aria-label', 'cancellation-cleanup-count');
      count.textContent = '5';
      document.body.appendChild(count);
      setTimeout(() => {
        count.textContent = '6';
      }, 50);

      await expect
        .element(page.getByLabel('cancellation-cleanup-count'))
        .toHaveText('6');
      throw new Error('cancellation cleanup reached after element assertion');
    });
    await new Promise<never>(() => {});
  },
);

fixtureTest(
  'uses a fresh deadline for cancellation cleanup',
  { retry: 1, timeout: 1000 },
  ({ fixtureValue }) => {
    expect(fixtureValue).toBeDefined();
  },
);
