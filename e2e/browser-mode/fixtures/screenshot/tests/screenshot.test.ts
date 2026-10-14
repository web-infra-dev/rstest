import { page } from '@rstest/browser';
import { expect, test } from '@rstest/core';

test('matches a locator screenshot', async () => {
  document.body.innerHTML = `
    <div id="capture" style="width: 360px; height: 80px; overflow: hidden">
      <button style="width: 180px; height: 40px; background: rgb(20, 80, 180); color: white; padding: 12px 24px; border: 0">Save</button>
      <span id="dynamic" style="display: inline-block; margin-left: 20px">dynamic content</span>
    </div>
  `;

  await expect(page.getByRole('button', { name: 'Save' })).toMatchScreenshot(
    'primary-button',
    { threshold: 0.1, maxDiffPixels: 0, stabilityTimeout: 2000 },
  );
  await expect(page.locator('#capture')).toMatchScreenshot('masked-capture', {
    stabilityTimeout: 2000,
    mask: [page.locator('#dynamic')],
  });
});

test.concurrent(
  'requires an explicit screenshot name with shared expect',
  async () => {
    let matcherError: unknown;
    try {
      await expect(page.locator('body')).toMatchScreenshot();
    } catch (error) {
      matcherError = error;
    }
    if (
      !(matcherError instanceof Error) ||
      !matcherError.message.includes('non-concurrent test or given a name')
    ) {
      throw new Error(
        'Expected concurrent screenshots to require an explicit name.',
      );
    }
  },
);

test.concurrent(
  'uses the pinned name with the test-scoped expect',
  async ({ expect: testExpect }) => {
    let matcherError: unknown;
    try {
      await testExpect(page.locator('body')).toMatchScreenshot(undefined, {
        mask: [null!],
      });
    } catch (error) {
      matcherError = error;
    }
    if (
      !(matcherError instanceof Error) ||
      !matcherError.message.includes('mask must contain browser-mode Locators')
    ) {
      throw new Error('Expected the test-scoped matcher to accept its name.');
    }
  },
);

test('explains that negated screenshot assertions are unsupported', async () => {
  try {
    await expect(page.locator('body')).not.toMatchScreenshot('negated');
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('does not support .not')
    ) {
      return;
    }
    throw error;
  }
  throw new Error('Expected .not.toMatchScreenshot() to be rejected.');
});
