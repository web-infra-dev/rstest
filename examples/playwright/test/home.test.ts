import { mkdir } from 'node:fs/promises';
import { expect, test } from '@rstest/playwright';

test('opens the built Rsbuild page', async ({ onTestFailed, page, serve }) => {
  onTestFailed(async ({ task }) => {
    await mkdir('.rstest-playwright/screenshots', { recursive: true });
    await page.screenshot({
      fullPage: true,
      path: `.rstest-playwright/screenshots/${task.id}.png`,
    });
  });

  const { url } = await serve('./dist/index.html');

  await page.goto(url);

  await expect(page).toHaveTitle('Rstest Playwright Example');
  await expect(page.locator('h1')).toHaveText('Rstest Playwright Example');
  await expect(page.locator('.message')).toContainText('Built by Rsbuild');
});
