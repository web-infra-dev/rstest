import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      syntax: ['chrome 100'],
      dts: true,
      source: {
        entry: {
          index: './src/index.ts',
          agent: './src/agent.ts',
        },
      },
      output: {
        sourceMap: process.env.SOURCEMAP === 'true',
      },
    },
  ],
});
