import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      dts: true,
      bundle: true,
      syntax: ['node 18.12.0'],
      experiments: {
        advancedEsm: true,
      },
    },
  ],
});
