import { defineConfig } from '@rslib/core';
import { publishCheckPlugins } from '../../scripts/publishCheckPlugins';
import { rslibRspackConfig } from '../../scripts/rslibConfig';
import { rsdoctorCIPlugin } from '../../scripts/rsdoctorPlugin';

export default defineConfig({
  plugins: publishCheckPlugins(),
  lib: [
    {
      syntax: 'es2023',
      dts: true,
      output: {
        sourceMap: process.env.SOURCEMAP === 'true',
        externals: {
          '@rstest/core': '@rstest/core',
          playwright: 'playwright',
        },
      },
    },
  ],
  source: {
    entry: {
      index: './src/index.ts',
      config: './src/config.ts',
    },
  },
  tools: {
    rspack: {
      ...rslibRspackConfig,
      plugins: [rsdoctorCIPlugin()].filter(Boolean),
    },
  },
});
