import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, expect, test as base } from '@rstest/playwright';
import type { PlaywrightOptions } from '@rstest/playwright';

const outputDir = join(import.meta.dirname, '.rstest-test-traces');

const test = base.extend({
  playwright: {
    browserName: 'chromium',
    launchOptions: process.env.CI ? { channel: 'chrome' } : undefined,
    trace: {
      mode: 'on',
      outputDir,
      print: false,
    },
  } satisfies PlaywrightOptions,
});

afterAll(async () => {
  await rm(outputDir, { recursive: true, force: true });
});

test.sequential('writes Playwright trace debug artifacts', async ({ page }) => {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  await page.setContent('<h1>Trace target</h1>');
  await expect(page.locator('h1')).toHaveText('Trace target');
});

test.sequential('verifies Playwright trace debug artifacts', async () => {
  const [traceEntry] = (await readdir(outputDir)).filter((entry) =>
    entry.startsWith('writes-Playwright-trace-debug-artifacts-'),
  );
  expect(traceEntry).toBeTruthy();

  const traceDir = join(outputDir, traceEntry!);
  const traceZip = join(traceDir, 'trace.zip');
  const summaryPath = join(traceDir, 'trace-summary.json');
  const debugPath = join(traceDir, 'debug.md');

  expect((await stat(traceZip)).size).toBeGreaterThan(0);

  const summary = JSON.parse(await readFile(summaryPath, 'utf-8'));
  expect(summary.test.name).toBe('writes Playwright trace debug artifacts');
  expect(summary.test.status).toBe('pass');
  expect(summary.command.showTrace).toContain('playwright show-trace');

  const debug = await readFile(debugPath, 'utf-8');
  expect(debug).toContain('Playwright Trace Debug Report');
  expect(debug).toContain('playwright show-trace');
  console.log('RSTEST_PLAYWRIGHT_TRACE_OK');
});

let retryAttempts = 0;

test.sequential(
  'keeps retry trace attempts separate',
  { retry: 1 },
  async ({ page }) => {
    retryAttempts++;

    await page.setContent('<h1>Retry trace target</h1>');
    await expect(page.locator('h1')).toHaveText('Retry trace target');
    expect(retryAttempts).toBe(2);
  },
);

test.sequential('verifies retry traces are not overwritten', async () => {
  const traceEntries = (await readdir(outputDir)).filter((entry) =>
    entry.startsWith('keeps-retry-trace-attempts-separate-'),
  );

  expect(traceEntries.length).toBe(2);

  for (const traceEntry of traceEntries) {
    expect(
      (await stat(join(outputDir, traceEntry, 'trace.zip'))).size,
    ).toBeGreaterThan(0);
  }

  console.log('RSTEST_PLAYWRIGHT_TRACE_RETRY_OK');
});
