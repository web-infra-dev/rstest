import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      dts: true,
      bundle: true,
      syntax: 'es2023',
      experiments: {
        advancedEsm: true,
      },
    },
  ],
});
