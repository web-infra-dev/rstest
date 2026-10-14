import { page } from '@rstest/browser';
import { expect, test } from '@rstest/core';

test('matches a locator screenshot', async () => {
  document.body.innerHTML = `
    <div id="capture" style="width: 360px; height: 80px; overflow: hidden">
      <button style="appearance: none; display: block; box-sizing: border-box; width: 180px; height: 40px; margin: 0; background: rgb(20, 80, 180); color: white; padding: 0; border: 0; line-height: 40px">Save</button>
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
  'uses the pinned test context with the test-scoped expect',
  async ({ expect: testExpect }) => {
    await testExpect(page.locator('body')).toMatchScreenshot();
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
