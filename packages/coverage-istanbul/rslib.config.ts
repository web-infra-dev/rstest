import { defineConfig } from '@rslib/core';
import { publishCheckPlugins } from '../../scripts/publishCheckPlugins';
import { rslibRspackConfig } from '../../scripts/rslibConfig';
import { rsdoctorCIPlugin } from '../../scripts/rsdoctorPlugin';

export default defineConfig({
  plugins: publishCheckPlugins(),
  lib: [
    {
      syntax: 'es2023',
      dts: {
        isolated: true,
      },
      output: {
        sourceMap: process.env.SOURCEMAP === 'true',
      },
    },
  ],
  tools: {
    rspack: {
      ...rslibRspackConfig,
      plugins: [rsdoctorCIPlugin()].filter(Boolean),
    },
  },
});
