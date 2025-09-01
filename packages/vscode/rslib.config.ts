import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      syntax: ['node 20'],
      bundle: false,
      format: 'cjs',
      output: {
        distPath: {
          root: 'out',
        },
        sourceMap: true,
      },
    },
  ],
});
