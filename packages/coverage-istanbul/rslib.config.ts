import { defineConfig } from '@rslib/core';
import { publishCheckPlugins } from '../../scripts/publishCheckPlugins';
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
      plugins: [rsdoctorCIPlugin()].filter(Boolean),
    },
  },
});
