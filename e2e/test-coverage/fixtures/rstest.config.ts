import { defineConfig } from '@rstest/core';

export default defineConfig({
  setupFiles: ['./rstest.setup.ts'],
  coverage: {
    reporters: ['text'],
  },
});
