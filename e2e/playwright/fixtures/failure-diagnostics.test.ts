import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, expect, test as base } from '@rstest/playwright';
import type { PlaywrightOptions } from '@rstest/playwright';

const outputDir = join(import.meta.dirname, '.rstest-failure-diagnostics');
const entryPath = join(outputDir, 'index.html');
const screenshotPath = join(outputDir, 'failure.png');
const serverCheckPath = join(outputDir, 'server-check.txt');

const test = base.extend({
  playwright: {
    browserName: 'chromium',
    launchOptions: process.env.CI ? { channel: 'chrome' } : undefined,
  } satisfies PlaywrightOptions,
});

afterAll(async () => {
  await rm(outputDir, { recursive: true, force: true });
});

test.sequential(
  'keeps Playwright resources alive for failure diagnostics',
  async ({ onTestFailed, page, serve }) => {
    await rm(outputDir, { recursive: true, force: true });
    await mkdir(outputDir, { recursive: true });
    await writeFile(entryPath, '<h1>Failure diagnostics</h1>');

    const { url } = await serve(entryPath, { keepAliveOnDebug: false });
    await page.goto(url);

    onTestFailed(async () => {
      await page.screenshot({ path: screenshotPath });
      const response = await fetch(url);
      await writeFile(serverCheckPath, await response.text());
    });

    throw new Error('expected failure');
  },
);

test.sequential('verifies failure diagnostics completed', async () => {
  expect((await stat(screenshotPath)).size).toBeGreaterThan(0);
  expect(await readFile(serverCheckPath, 'utf-8')).toContain(
    'Failure diagnostics',
  );
  console.log('RSTEST_PLAYWRIGHT_FAILURE_DIAGNOSTICS_OK');
});
