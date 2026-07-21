import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, expect, test as base } from '@rstest/playwright';
import type { PlaywrightOptions } from '@rstest/playwright';

const outputDir = join(import.meta.dirname, '.rstest-env-priority-traces');

const test = base.extend({
  playwright: {
    browserName: 'chromium',
    launchOptions: process.env.CI ? { channel: 'chrome' } : undefined,
    trace: 'off',
  } satisfies PlaywrightOptions,
});

afterAll(async () => {
  await rm(outputDir, { recursive: true, force: true });
});

test.sequential('keeps fixture trace off when env is on', async ({ page }) => {
  await rm(outputDir, { recursive: true, force: true });

  await page.setContent('<h1>Fixture trace priority</h1>');
  await expect(page.locator('h1')).toHaveText('Fixture trace priority');
});

test.sequential('verifies fixture trace overrides env', async () => {
  const entries = await readdir(outputDir).catch(() => []);

  expect(entries).toEqual([]);
  console.log('RSTEST_PLAYWRIGHT_TRACE_PRIORITY_OK');
});
