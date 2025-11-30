import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      syntax: ['node 18'],
      dts: true,
      output: {
        sourceMap: process.env.SOURCE_MAP === 'true',
      },
    },
  ],
});
