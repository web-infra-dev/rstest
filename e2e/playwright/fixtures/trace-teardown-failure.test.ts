import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, expect, test as base } from '@rstest/playwright';
import type { PlaywrightOptions } from '@rstest/playwright';

const outputDir = join(import.meta.dirname, '.rstest-teardown-failure-traces');

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
  'retains trace when later fixture teardown fails',
  async ({ page, serve }) => {
    await rm(outputDir, { recursive: true, force: true });
    await mkdir(outputDir, { recursive: true });

    const entryPath = join(outputDir, 'index.html');
    await writeFile(entryPath, '<h1>Teardown failure trace</h1>');

    const server = await serve(entryPath, { keepAliveOnDebug: false });
    server.close = () => {
      throw new Error('serve cleanup trace failure');
    };

    await page.setContent('<h1>Teardown failure trace</h1>');
    await expect(page.locator('h1')).toHaveText('Teardown failure trace');
  },
);

test.sequential('verifies teardown failure trace is retained', async () => {
  const traceEntries = (await readdir(outputDir)).filter((entry) =>
    entry.startsWith('retains-trace-when-later-fixture-teardown-fails-'),
  );

  expect(traceEntries.length).toBe(1);

  const traceDir = join(outputDir, traceEntries[0]!);
  expect((await stat(join(traceDir, 'trace.zip'))).size).toBeGreaterThan(0);

  const summary = JSON.parse(
    await readFile(join(traceDir, 'trace-summary.json'), 'utf-8'),
  );
  expect(summary.test.status).toBe('fail');
  expect(summary.error.message).toContain('serve cleanup trace failure');
  console.log('RSTEST_PLAYWRIGHT_TRACE_TEARDOWN_FAIL_OK');
});
