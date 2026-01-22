import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      syntax: ['chrome 100'],
      dts: true,
      output: {
        target: 'web',
        sourceMap: process.env.SOURCEMAP === 'true',
        externals: {
          // Keep react and react-dom as external (provided by user's project)
          react: 'react',
          'react-dom': 'react-dom',
          'react-dom/client': 'react-dom/client',
          'react/jsx-runtime': 'react/jsx-runtime',
          'react/jsx-dev-runtime': 'react/jsx-dev-runtime',
          // Keep @rstest/core as external
          '@rstest/core': '@rstest/core',
        },
      },
    },
  ],
  source: {
    entry: {
      index: './src/index.ts',
      pure: './src/pure.tsx',
    },
  },
});
