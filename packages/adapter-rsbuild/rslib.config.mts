import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      dts: {
        tsgo: true,
        bundle: true
      },
      bundle: true,
      syntax: 'es2023',
      experiments: {
        advancedEsm: true,
      },
    },
  ],
});
