import { defineConfig } from '@rstest/core';

export default defineConfig({
  passWithNoTests: true,
  setupFiles: [
    './rstest.setup.ts',
    './sequence-first.ts',
    './sequence-second.ts',
  ],
  sequence: {
    setupFiles:
      process.env.SETUP_SEQUENCE === 'parallel'
        ? 'parallel'
        : process.env.SETUP_SEQUENCE === 'list'
          ? 'list'
          : undefined,
  },
  federation: process.env.SETUP_FEDERATION === 'true',
  exclude: ['**/node_modules/**', '**/dist/**'],
});
