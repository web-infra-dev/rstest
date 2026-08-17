import { registerWorkerCleanup } from '@rstest/core';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@rstest/playwright';
import { rememberBrowser } from './browser-reuse-state';

test('starts a browser for the worker', ({ browser }) => {
  const previousBrowser = rememberBrowser(browser);
  if (previousBrowser) {
    expect(browser).toBe(previousBrowser);
    console.log('RSTEST_PLAYWRIGHT_CROSS_FILE_REUSE_OK');
    return;
  }

  registerWorkerCleanup(() => {
    expect(browser.isConnected()).toBe(false);
    return writeFile(
      join(import.meta.dirname, 'browser-reuse-cleanup.txt'),
      'RSTEST_PLAYWRIGHT_CROSS_FILE_CLEANUP_OK',
    );
  });
  console.log('RSTEST_PLAYWRIGHT_CROSS_FILE_FIRST_OK');
});
