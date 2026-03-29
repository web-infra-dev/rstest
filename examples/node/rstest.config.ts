import { defineConfig } from '@rstest/core';

export default defineConfig({
  root: __dirname,
  coverage: {
    enabled: true,
    provider: 'v8',
  },
});
