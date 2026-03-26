import { defineConfig } from '@rstest/core';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'invalid' as unknown as 'playwright',
    headless: true,
  },
  include: ['tests/**/*.test.ts'],
});
