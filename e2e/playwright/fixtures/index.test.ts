import { createRsbuild } from '@rsbuild/core';
import { expect, test } from '@rstest/playwright';

test(
  'opens an Rsbuild page with Playwright',
  async ({ page, serve }) => {
    const rsbuild = await createRsbuild({ cwd: import.meta.dirname });
    await rsbuild.build();

    const { url } = await serve('./dist/index.html', {
      keepAliveOnDebug: false,
    });

    await page.goto(url);

    await expect(page).toHaveTitle('Rstest Playwright E2E');
    await expect(page.locator('h1')).toHaveText('Rstest Playwright E2E');
    await expect(page.locator('.message')).toContainText('Rsbuild page loaded');
    console.log('RSTEST_PLAYWRIGHT_E2E_OK');
  },
  { timeout: 30_000 },
);
