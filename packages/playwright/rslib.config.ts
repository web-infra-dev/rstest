import { defineConfig } from '@rslib/core';
import { publishCheckPlugins } from '../../scripts/publishCheckPlugins';
import { rsdoctorCIPlugin } from '../../scripts/rsdoctorPlugin';

export default defineConfig({
  plugins: publishCheckPlugins(),
  lib: [
    {
      format: 'esm',
      syntax: 'es2023',
      dts: true,
      redirect: {
        dts: { extension: true },
      },
      output: {
        sourceMap: process.env.SOURCEMAP === 'true',
        externals: {
          '@rstest/core': '@rstest/core',
          playwright: 'playwright',
        },
      },
    },
  ],
  tools: {
    rspack: {
      plugins: [rsdoctorCIPlugin()].filter(Boolean),
    },
  },
});
