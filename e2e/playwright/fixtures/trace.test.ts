import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, expect, test as base } from '@rstest/playwright';
import type {
  PlaywrightOptions,
  PlaywrightTraceMode,
} from '@rstest/playwright';

const outputDir = join(import.meta.dirname, '.rstest test traces');

const getPlaywrightOptions = (mode: PlaywrightTraceMode) =>
  ({
    browserName: 'chromium',
    launchOptions: process.env.CI ? { channel: 'chrome' } : undefined,
    trace: {
      mode,
      outputDir,
      print: false,
    },
  }) satisfies PlaywrightOptions;

const test = base.extend({
  playwright: getPlaywrightOptions('on'),
});

const firstRetryTraceTest = base.extend({
  playwright: getPlaywrightOptions('on-first-retry'),
});

const allRetriesTraceTest = base.extend({
  playwright: getPlaywrightOptions('on-all-retries'),
});

afterAll(async () => {
  await rm(outputDir, { recursive: true, force: true });
}, 10_000);

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
  expect(
    summary.command.showTrace.startsWith(
      `npx playwright show-trace ${process.platform === 'win32' ? '"' : "'"}`,
    ),
  ).toBe(true);

  const debug = await readFile(debugPath, 'utf-8');
  expect(debug).toContain('Playwright Trace Debug Report');
  expect(debug).toContain('playwright show-trace');
  console.log('RSTEST_PLAYWRIGHT_TRACE_OK');
});

test.sequential(
  'keeps the browser alive during slow trace cleanup',
  async ({ browser, context, page }) => {
    const stopTracing = context.tracing.stop.bind(context.tracing);
    context.tracing.stop = async (options) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      expect(browser.isConnected()).toBe(true);
      await stopTracing(options);
    };

    await page.setContent('<h1>Slow trace cleanup</h1>');
    await expect(page.locator('h1')).toHaveText('Slow trace cleanup');
  },
);

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

firstRetryTraceTest.sequential(
  'does not trace a passing initial attempt',
  async ({ page, task }) => {
    expect(task.retryCount).toBe(0);
    await page.setContent('<h1>Initial attempt</h1>');
  },
);

test.sequential(
  'verifies a passing initial attempt was not traced',
  async () => {
    const traceEntries = (await readdir(outputDir)).filter((entry) =>
      entry.startsWith('does-not-trace-a-passing-initial-attempt-'),
    );

    expect(traceEntries).toEqual([]);
  },
);

let firstRetryTraceAttempts = 0;

firstRetryTraceTest.sequential(
  'traces only the first retry',
  { retry: 2 },
  async ({ page, task }) => {
    expect(task.retryCount).toBe(firstRetryTraceAttempts);
    firstRetryTraceAttempts++;
    await page.setContent('<h1>First retry trace</h1>');
    expect(firstRetryTraceAttempts).toBe(3);
  },
);

test.sequential('verifies only the first retry was traced', async () => {
  const traceEntries = (await readdir(outputDir)).filter((entry) =>
    entry.startsWith('traces-only-the-first-retry-'),
  );

  expect(traceEntries).toHaveLength(1);
  expect(
    (await stat(join(outputDir, traceEntries[0]!, 'trace.zip'))).size,
  ).toBeGreaterThan(0);
  console.log('RSTEST_PLAYWRIGHT_TRACE_FIRST_RETRY_OK');
});

let allRetriesTraceAttempts = 0;

allRetriesTraceTest.sequential(
  'traces all retries',
  { retry: 2 },
  async ({ page, task }) => {
    expect(task.retryCount).toBe(allRetriesTraceAttempts);
    allRetriesTraceAttempts++;
    await page.setContent('<h1>All retries trace</h1>');
    expect(allRetriesTraceAttempts).toBe(3);
  },
);

test.sequential('verifies all retries were traced', async () => {
  const traceEntries = (await readdir(outputDir)).filter((entry) =>
    entry.startsWith('traces-all-retries-'),
  );

  expect(traceEntries).toHaveLength(2);
  for (const traceEntry of traceEntries) {
    expect(
      (await stat(join(outputDir, traceEntry, 'trace.zip'))).size,
    ).toBeGreaterThan(0);
  }
  console.log('RSTEST_PLAYWRIGHT_TRACE_ALL_RETRIES_OK');
});
