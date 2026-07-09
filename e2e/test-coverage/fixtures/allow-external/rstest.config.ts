import { defineConfig } from '@rstest/core';

export default defineConfig({
  coverage: {
    enabled: true,
    provider: 'istanbul',
    reporters: ['text'],
    clean: false,
    allowExternal: false,
  },
});
