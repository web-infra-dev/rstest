import { defineConfig } from '@rslib/core';
import { rsdoctorCIPlugin } from '../../scripts/rsdoctorPlugin';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      syntax: 'es2021',
      dts: {
        isolated: true,
      },
    },
  ],
  tools: {
    rspack: {
      plugins: [rsdoctorCIPlugin()].filter(Boolean),
    },
  },
});
