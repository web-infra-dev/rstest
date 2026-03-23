import { defineConfig } from '@rslib/core';
import { rsdoctorCIPlugin } from '../../scripts/rsdoctorPlugin.ts';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      dts: {
        tsgo: true,
        bundle: true,
      },
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
