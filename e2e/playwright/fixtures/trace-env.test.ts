import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, expect, test as base } from '@rstest/playwright';
import type { PlaywrightOptions } from '@rstest/playwright';

const outputDir = join(import.meta.dirname, '.rstest-env-traces');

const test = base.extend({
  playwright: {
    browserName: 'chromium',
    launchOptions: process.env.CI ? { channel: 'chrome' } : undefined,
  } satisfies PlaywrightOptions,
});

afterAll(async () => {
  await rm(outputDir, { recursive: true, force: true });
});

test.sequential('writes Playwright trace from env', async ({ page }) => {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  await page.setContent('<h1>Env trace target</h1>');
  await expect(page.locator('h1')).toHaveText('Env trace target');
});

test.sequential('verifies Playwright trace from env', async () => {
  const [traceEntry] = (await readdir(outputDir)).filter((entry) =>
    entry.startsWith('writes-Playwright-trace-from-env-'),
  );
  expect(traceEntry).toBeTruthy();

  const traceDir = join(outputDir, traceEntry!);
  expect((await stat(join(traceDir, 'trace.zip'))).size).toBeGreaterThan(0);

  const summary = JSON.parse(
    await readFile(join(traceDir, 'trace-summary.json'), 'utf-8'),
  );
  expect(summary.test.name).toBe('writes Playwright trace from env');
  expect(summary.test.status).toBe('pass');
  console.log('RSTEST_PLAYWRIGHT_TRACE_ENV_OK');
});
