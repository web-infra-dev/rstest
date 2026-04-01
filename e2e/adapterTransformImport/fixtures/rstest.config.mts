import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['tests/**/*.test.ts'],
  resolve: {
    alias: {
      'demo-lib': './demo-lib',
    },
  },
  source: {
    transformImport: [
      {
        libraryName: 'demo-lib',
        libraryDirectory: '.',
        camelToDashComponentName: false,
      },
    ],
  },
});
