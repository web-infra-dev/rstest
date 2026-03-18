import { withRspackConfig } from '@rstest/adapter-rspack';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  extends: withRspackConfig(),
  browser: {
    enabled: true,
    provider: 'playwright',
  },
  include: ['tests/**/*.test.tsx'],
});
