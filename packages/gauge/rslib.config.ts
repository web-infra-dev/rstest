import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      dts: true,
      bundle: true,
      syntax: 'es2023',
    },
    {
      id: 'cli',
      format: 'esm',
      bundle: true,
      syntax: 'es2023',
      source: {
        entry: { cli: 'src/cli.ts' },
      },
      output: {
        banner: { js: '#!/usr/bin/env node' },
      },
    },
  ],
});
