import { expect, test as base } from '@rstest/playwright';
import type { PlaywrightOptions } from '@rstest/playwright';

const test = base.extend({
  playwright: {
    browserName: 'chromium',
    launchOptions: process.env.CI ? { channel: 'chrome' } : undefined,
  } satisfies PlaywrightOptions,
});

test('opens the built Rsbuild page', async ({ onTestFailed, page, serve }) => {
  onTestFailed(async ({ task }) => {
    await page.screenshot({
      fullPage: true,
      path: `${task.id}-failed.png`,
    });
  });

  const { url } = await serve('./dist/index.html');

  await page.goto(url);

  await expect(page).toHaveTitle('Rstest Playwright Example');
  await expect(page.locator('h1')).toHaveText('Rstest Playwright Example');
  await expect(page.locator('.message')).toContainText('Built by Rsbuild');
});
