import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, expect, test as base } from '@rstest/playwright';
import type { PlaywrightOptions } from '@rstest/playwright';

const outputPath = join(import.meta.dirname, '.rstest-retain-pass-output');
await writeFile(
  outputPath,
  'trace output must not be created for passing tests',
);

const test = base.extend({
  playwright: {
    browserName: 'chromium',
    launchOptions: process.env.CI ? { channel: 'chrome' } : undefined,
    trace: {
      mode: 'retain-on-failure',
      outputDir: outputPath,
    },
  } satisfies PlaywrightOptions,
});

afterAll(async () => {
  await rm(outputPath, { force: true });
});

test('does not write a trace for a passing test', async ({ page }) => {
  await page.setContent('<h1>Passing test</h1>');
  await expect(page.locator('h1')).toHaveText('Passing test');
  console.log('RSTEST_PLAYWRIGHT_RETAIN_PASS_OK');
});
