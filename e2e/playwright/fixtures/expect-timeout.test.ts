import { expect, test as base } from '@rstest/playwright';
import type { PlaywrightOptions } from '@rstest/playwright';

const test = base.extend({
  playwright: {
    browserName: 'chromium',
    launchOptions: process.env.CI ? { channel: 'chrome' } : undefined,
  } satisfies PlaywrightOptions,
});

test('preserves the locator assertion error after timeout', async ({
  page,
}) => {
  await page.setContent('<h1>Visible heading</h1>');

  await expect(
    page.locator('h1').filter({ hasText: 'Missing heading' }),
  ).toBeVisible({ timeout: 1000 });
});
