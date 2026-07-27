import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test as base } from '@rstest/playwright';
import type { PlaywrightOptions } from '@rstest/playwright';

const outputDir = join(import.meta.dirname, '.rstest-on-finished-traces');

const test = base.extend({
  playwright: {
    browserName: 'chromium',
    launchOptions: process.env.CI ? { channel: 'chrome' } : undefined,
    trace: {
      mode: 'retain-on-failure',
      outputDir,
      print: false,
    },
  } satisfies PlaywrightOptions,
});

test.sequential(
  'retains trace when onTestFinished fails',
  async ({ onTestFinished, page }) => {
    await rm(outputDir, { recursive: true, force: true });
    await mkdir(outputDir, { recursive: true });

    onTestFinished(() => {
      throw new Error('onTestFinished trace failure');
    });

    await page.setContent('<h1>Finished failure trace</h1>');
    await expect(page.locator('h1')).toHaveText('Finished failure trace');
  },
);

test.sequential('verifies onTestFinished failure trace status', async () => {
  const [traceEntry] = (await readdir(outputDir)).filter((entry) =>
    entry.startsWith('retains-trace-when-onTestFinished-fails-'),
  );
  expect(traceEntry).toBeTruthy();

  const traceDir = join(outputDir, traceEntry!);
  expect((await stat(join(traceDir, 'trace.zip'))).size).toBeGreaterThan(0);

  const summary = JSON.parse(
    await readFile(join(traceDir, 'trace-summary.json'), 'utf-8'),
  );
  expect(summary.test.status).toBe('fail');
  expect(summary.error.message).toContain('onTestFinished trace failure');

  await rm(outputDir, { recursive: true, force: true });
  console.log('RSTEST_PLAYWRIGHT_TRACE_ON_FINISHED_FAIL_OK');
});
