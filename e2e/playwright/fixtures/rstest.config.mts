import { defineConfig } from '@rstest/core';
import { definePlaywrightConfig } from '@rstest/playwright/config';

export default defineConfig({
  extends: definePlaywrightConfig({
    expect: process.env.RSTEST_E2E_EXPECT_TIMEOUT
      ? { timeout: Number(process.env.RSTEST_E2E_EXPECT_TIMEOUT) }
      : undefined,
    contextOptions: {
      viewport: { width: 777, height: 555 },
    },
  }),
  ...(process.env.RSTEST_E2E_POLL_TIMEOUT
    ? {
        expect: {
          poll: { timeout: Number(process.env.RSTEST_E2E_POLL_TIMEOUT) },
        },
      }
    : {}),
  include: ['./*.test.ts'],
  isolate: false,
  testEnvironment: 'node',
});
