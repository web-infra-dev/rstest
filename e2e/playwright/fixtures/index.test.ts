import { join } from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { expect, test } from '@rstest/playwright';

const cwd = import.meta.dirname;
const distPath = 'dist-index';
const entry = join(cwd, distPath, 'index.html');

test(
  'opens an Rsbuild page with Playwright',
  { timeout: 30_000 },
  async ({ page, serve }) => {
    const rsbuild = await createRsbuild({
      cwd,
      rsbuildConfig: {
        html: {
          title: 'Rstest Playwright E2E',
        },
        output: {
          distPath: {
            root: distPath,
          },
        },
        source: {
          entry: {
            index: './src/index.ts',
          },
        },
      },
    });
    await rsbuild.build();

    const { url } = await serve(entry, {
      keepAliveOnDebug: false,
    });

    await page.goto(url);

    await expect(page).toHaveTitle('Rstest Playwright E2E');
    await expect(page.locator('h1')).toHaveText('Rstest Playwright E2E');
    await expect(page.locator('.message')).toContainText('Rsbuild page loaded');
    console.log('RSTEST_PLAYWRIGHT_E2E_OK');
  },
);
