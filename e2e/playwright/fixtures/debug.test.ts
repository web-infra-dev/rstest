import { join } from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { expect, test } from '@rstest/playwright';

const debugEnabled = process.env.RSTEST_PLAYWRIGHT_DEBUG === 'true';
const cwd = import.meta.dirname;
const distPath = 'dist-debug';
const entry = join(cwd, distPath, 'index.html');

const buildApp = async () => {
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
};

test(
  'can enable headed debug mode from env',
  async ({ page, serve }) => {
    await buildApp();

    const { url } = await serve(entry, {
      keepAliveOnDebug: false,
    });

    await page.goto(url);
    await expect(page.locator('h1')).toHaveText('Rstest Playwright E2E');
    console.log(
      debugEnabled
        ? 'RSTEST_PLAYWRIGHT_DEBUG_ON'
        : 'RSTEST_PLAYWRIGHT_DEBUG_OFF',
    );
  },
  { timeout: 30_000 },
);

test.skip(
  'can pause during headed debugging',
  async ({ page, serve }) => {
    await buildApp();

    const { url } = await serve(entry);

    await page.goto(url);
    await page.pause();
  },
  { timeout: 0 },
);
