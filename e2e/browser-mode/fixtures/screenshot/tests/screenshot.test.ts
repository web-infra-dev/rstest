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
    { threshold: 0.1, maxDiffPixels: 0 },
  );
  await expect(page.locator('#capture')).toMatchScreenshot('masked-capture', {
    mask: [page.locator('#dynamic')],
  });
}, 30_000);

test('matches a full page screenshot', async () => {
  document.body.innerHTML = `
    <main style="height: 1800px; background: linear-gradient(white, rgb(20, 80, 180))">
      <h1>Page screenshot</h1>
    </main>
  `;

  await expect(page).toMatchScreenshot('viewport', {
    mask: [page.locator('h1')],
  });
  await expect(page).toMatchScreenshot('whole-page', { fullPage: true });
}, 30_000);

test('uses distinct references for duplicate test titles', async () => {
  document.body.innerHTML =
    '<button style="background: rgb(20, 80, 180); color: white">Save</button>';
  await expect(page.getByRole('button', { name: 'Save' })).toMatchScreenshot();
}, 30_000);

test('keeps default screenshot references stable when earlier tests are added', async () => {
  document.body.innerHTML =
    '<button style="background: rgb(20, 80, 180); color: white">Save</button>';
  await expect(page.getByRole('button', { name: 'Save' })).toMatchScreenshot();
}, 30_000);

test('assigns separate references to repeated unnamed screenshots', async () => {
  document.body.innerHTML = `
    <button style="background: rgb(20, 80, 180); color: white">First</button>
    <button style="background: rgb(180, 40, 20); color: white">Second</button>
  `;
  await expect(page.getByRole('button', { name: 'First' })).toMatchScreenshot();
  await expect(
    page.getByRole('button', { name: 'Second' }),
  ).toMatchScreenshot();
}, 30_000);

test(
  'reuses unnamed screenshot references on retry',
  { retry: 1 },
  async ({ task }) => {
    document.body.innerHTML =
      '<button style="background: rgb(20, 80, 180); color: white">Retry</button>';
    await expect(
      page.getByRole('button', { name: 'Retry' }),
    ).toMatchScreenshot();
    if (task.retryCount === 0) {
      throw new Error('Retry this screenshot assertion once.');
    }
  },
);

test('saves long screenshot names atomically', async () => {
  document.body.innerHTML =
    '<button style="background: rgb(20, 80, 180); color: white">Long name</button>';
  await expect(
    page.getByRole('button', { name: 'Long name' }),
  ).toMatchScreenshot('界'.repeat(80));
}, 30_000);

test('uses distinct references for duplicate test titles', async () => {
  document.body.innerHTML =
    '<button style="background: rgb(180, 40, 20); color: white">Save</button>';
  await expect(page.getByRole('button', { name: 'Save' })).toMatchScreenshot();
}, 30_000);

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
