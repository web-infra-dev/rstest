import { join } from 'node:path';
import { expect, test as base } from '@rstest/playwright';
import type { APIRequestContext } from 'playwright';

let request: APIRequestContext;
let url: string;

const cleanupFailureTest = base.extend<{ userCleanup: undefined }>({
  userCleanup: async (_, use) => {
    await use(undefined);
    throw new Error('user cleanup failed');
  },
});

cleanupFailureTest.sequential(
  'uses request and serve before cleanup failure',
  async ({ request: currentRequest, serve, userCleanup }) => {
    expect(userCleanup).toBeUndefined();
    request = currentRequest;
    url = (await serve(join(import.meta.dirname, 'package.json'))).url;

    const response = await request.get(url);
    expect(response.ok()).toBe(true);
  },
);

base.sequential('verifies request and serve cleanup', async () => {
  await expect(request.get(url)).rejects.toThrow(
    'Target page, context or browser has been closed',
  );
  await expect(fetch(url)).rejects.toThrow();
  console.log('RSTEST_PLAYWRIGHT_CLEANUP_OK');
});
