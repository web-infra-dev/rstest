import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      dts: true,
      bundle: false,
    },
    {
      format: 'cjs',
      dts: false,
      bundle: false,
    },
  ],
});
