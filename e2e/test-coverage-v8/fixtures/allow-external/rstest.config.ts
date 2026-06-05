import { defineConfig } from '@rstest/core';

export default defineConfig({
  coverage: {
    enabled: true,
    provider: 'v8',
    reporters: ['text'],
    clean: false,
    include: ['src/**/*.ts', '../external-module/**/*.ts'],
    allowExternal: false,
  },
});
