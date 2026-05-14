import { defineConfig } from '@rslib/core';
import { publishCheckPlugins } from '../../scripts/publishCheckPlugins';
import { rsdoctorCIPlugin } from '../../scripts/rsdoctorPlugin';

export default defineConfig({
  plugins: publishCheckPlugins(),
  lib: [
    {
      format: 'esm',
      dts: true,
      bundle: true,
      syntax: 'es2023',
      experiments: {
        advancedEsm: true,
      },
    },
  ],
  tools: {
    rspack: {
      plugins: [rsdoctorCIPlugin()].filter(Boolean),
    },
  },
});
