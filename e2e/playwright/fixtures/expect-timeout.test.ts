import { beforeAll, describe, expect, test as base } from '@rstest/playwright';
import type { PlaywrightOptions } from '@rstest/playwright';

const test = base.extend({
  playwright: {
    browserName: 'chromium',
    launchOptions: process.env.CI ? { channel: 'chrome' } : undefined,
  } satisfies PlaywrightOptions,
});

base('keeps assertion settings out of fixture options', ({ playwright }) => {
  expect(playwright).not.toHaveProperty('expect');
});

describe('E2E defaults', () => {
  test('allows tests longer than five seconds', async () => {
    await new Promise((resolve) => setTimeout(resolve, 5100));
    console.log('RSTEST_PLAYWRIGHT_TEST_DEFAULT_OK');
  });

  test('allows polling longer than one second', async () => {
    const start = performance.now();
    await expect.poll(() => performance.now() - start).toBeGreaterThan(1200);
    console.log('RSTEST_PLAYWRIGHT_POLL_DEFAULT_OK');
  });

  describe('hook timeout', () => {
    beforeAll(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10_100));
    });

    test('allows hooks longer than ten seconds', () => {
      console.log('RSTEST_PLAYWRIGHT_HOOK_DEFAULT_OK');
    });
  });
});

test('preserves the locator assertion error after timeout', async ({
  page,
}) => {
  await page.setContent('<h1>Visible heading</h1>');

  await expect(
    page.locator('h1').filter({ hasText: 'Missing heading' }),
  ).toBeVisible({ timeout: 1000 });
});

test('uses configurable assertion timeouts and matcher overrides', async ({
  page,
}) => {
  await page.setContent('<div class="message">Pending</div>');
  await page.evaluate(() => {
    setTimeout(() => {
      document.querySelector('.message')!.textContent = 'Saved';
    }, 500);
  });

  const assertion = expect(page.locator('.message')).toContainText('Saved');
  if (process.env.RSTEST_E2E_POLL_TIMEOUT) {
    await expect(assertion).rejects.toThrow('to contain text');
  } else {
    await assertion;
  }

  await expect(page.locator('.message')).toContainText('Saved', {
    timeout: 2000,
  });

  await page.evaluate(() => {
    setTimeout(() => {
      document.title = 'Saved';
    }, 500);
  });
  const titleAssertion = expect(page).toHaveTitle('Saved');
  if (process.env.RSTEST_E2E_POLL_TIMEOUT) {
    await expect(titleAssertion).rejects.toThrow('to have title');
  } else {
    await titleAssertion;
  }
  await expect(page).toHaveTitle('Saved', { timeout: 2000 });
  console.log('RSTEST_PLAYWRIGHT_EXPECT_TIMEOUT_OK');
});
