import { defineConfig } from '@rslib/core';
import { rsdoctorCIPlugin } from '../../scripts/rsdoctorPlugin';

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
          // React 17 entry uses legacy ReactDOMTestUtils.act.
          'react-dom/test-utils': 'react-dom/test-utils',
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
      'index.react17': './src/index.react17.ts',
      'pure.react17': './src/pure.react17.tsx',
    },
  },
  tools: {
    rspack: {
      plugins: [rsdoctorCIPlugin()].filter(Boolean),
    },
  },
});
