import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, expect, test as base } from '@rstest/playwright';
import type { PlaywrightOptions } from '@rstest/playwright';

const outputDir = join(import.meta.dirname, '.rstest-context-close-traces');

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

afterAll(async () => {
  await rm(outputDir, { recursive: true, force: true });
});

test.sequential(
  'finalizes trace when context close fails',
  async ({ context, page }) => {
    await rm(outputDir, { recursive: true, force: true });
    await mkdir(outputDir, { recursive: true });

    const closeContext = context.close.bind(context);
    context.close = async () => {
      await closeContext();
      throw new Error('context close trace failure');
    };

    await page.setContent('<h1>Context close failure trace</h1>');
    await expect(page.locator('h1')).toHaveText('Context close failure trace');
  },
);

test.sequential('verifies context close failure trace metadata', async () => {
  const [traceEntry] = (await readdir(outputDir)).filter((entry) =>
    entry.startsWith('finalizes-trace-when-context-close-fails-'),
  );
  expect(traceEntry).toBeTruthy();

  const traceDir = join(outputDir, traceEntry!);
  expect((await stat(join(traceDir, 'trace.zip'))).size).toBeGreaterThan(0);

  const summary = JSON.parse(
    await readFile(join(traceDir, 'trace-summary.json'), 'utf-8'),
  );
  expect(summary.test.status).toBe('fail');
  expect(summary.error.message).toContain('context close trace failure');
  expect((await stat(join(traceDir, 'debug.md'))).size).toBeGreaterThan(0);
  console.log('RSTEST_PLAYWRIGHT_TRACE_CONTEXT_CLOSE_FAIL_OK');
});
