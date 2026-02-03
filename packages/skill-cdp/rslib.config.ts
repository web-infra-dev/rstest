import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'cjs',
      dts: false,
      bundle: true,
      syntax: ['node 18.12.0'],
      output: {
        filename: {
          js: '[name].cjs',
        },
      },
      source: {
        define: {
          // `ws` optionally loads native addons (`bufferutil`, `utf-8-validate`).
          // We don't ship them in the bundled script, so disable those code paths.
          'process.env.WS_NO_BUFFER_UTIL': JSON.stringify('1'),
          'process.env.WS_NO_UTF_8_VALIDATE': JSON.stringify('1'),
        },
        entry: {
          'rstest-cdp': './src/cli.ts',
        },
      },
    },
  ],
});
